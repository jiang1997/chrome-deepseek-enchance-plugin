import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHistory } from "../src/tree/model";
import { flushAsync, installAnimationFrameStub, stubRect, type RafStub } from "./helpers/dom";

const history = vi.hoisted(() => ({ get: vi.fn(), syncConversation: vi.fn() }));
vi.mock("../src/tree/history-service", () => ({ conversationHistory: history }));
vi.mock("../src/tree/deepseek", async (original) => ({
  ...(await original<typeof import("../src/tree/deepseek")>()),
  jumpToMessage: vi.fn().mockResolvedValue(true),
}));
import { jumpToMessage } from "../src/tree/deepseek";
import { TreePanel } from "../src/tree/panel";

const messages = [
  { message_id: 99, parent_id: 0, role: "USER", content: "Question" },
  { message_id: 7, parent_id: 99, role: "ASSISTANT", content: "Needle active answer" },
  { message_id: 31, parent_id: 7, role: "USER", content: "Needle follow-up" },
  { message_id: 2, parent_id: 99, role: "ASSISTANT", content: "Needle alternative answer" },
];
const tree = (items = messages) =>
  parseHistory({
    data: { biz_data: { chat_messages: items, chat_session: { current_message_id: 31 } } },
  });
const originalScrollBy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollBy");
let panel: TreePanel;
let shadow: ShadowRoot;
let raf: RafStub;
const el = <T extends Element = HTMLElement>(selector: string) => shadow.querySelector<T>(selector)!;
function query(text: string) {
  el<HTMLInputElement>("input").value = text;
  el("input").dispatchEvent(new Event("input", { bubbles: true }));
}
async function refresh() {
  el<HTMLButtonElement>(".refresh").click();
  await flushAsync();
}

beforeEach(async () => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/a/chat/s/abcdef-1234");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  raf = installAnimationFrameStub();
  Object.defineProperty(HTMLElement.prototype, "scrollBy", { configurable: true, value: vi.fn() });
  history.get.mockResolvedValue(tree());
  panel = new TreePanel();
  shadow = document.querySelector("[data-dse-tree]")!.shadowRoot!;
  el<HTMLButtonElement>(".toggle").click();
  await flushAsync();
});

afterEach(() => {
  panel?.destroy();
  document.body.replaceChildren();
  window.history.replaceState({}, "", "/");
  if (originalScrollBy) Object.defineProperty(HTMLElement.prototype, "scrollBy", originalScrollBy);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollBy");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("tree search navigation", () => {
  it("previews and cycles across branches without moving the chat or stealing search focus", () => {
    query("needle");
    expect(el(".search-count").textContent).toBe("1 / 3");
    expect(el(".current-match").getAttribute("data-id")).toBe("7");
    expect(shadow.activeElement).toBe(el("input"));
    el<HTMLButtonElement>(".previous-match").click();
    expect(el(".search-count").textContent).toBe("3 / 3");
    expect(el(".preview-text").textContent).toBe("Needle alternative answer");
    expect(el(".preview-label").textContent).toContain("Other branches");
    expect(el(".current-match").getAttribute("aria-current")).toBe("true");
    el<HTMLButtonElement>(".next-match").click();
    expect(el(".current-match").getAttribute("data-id")).toBe("7");
    expect(jumpToMessage).not.toHaveBeenCalled();
  });

  it("supports Enter and Shift+Enter, while ignoring IME composition", () => {
    query("needle");
    const input = el("input");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }));
    expect(el(".search-count").textContent).toBe("1 / 3");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(el(".search-count").textContent).toBe("2 / 3");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    expect(el(".search-count").textContent).toBe("1 / 3");
  });

  it("disables navigation for no matches and clears the cursor for an empty query", () => {
    query("needle");
    query("missing");
    expect(el(".search-count").textContent).toBe("0 / 0");
    expect(el<HTMLButtonElement>(".previous-match").disabled).toBe(true);
    expect(el<HTMLButtonElement>(".next-match").disabled).toBe(true);
    expect(shadow.querySelector(".current-match")).toBeNull();
    expect(el(".preview").hidden).toBe(true);
    query("");
    expect(el(".search-navigation").hidden).toBe(true);
    expect(shadow.querySelector(".match")).toBeNull();
  });

  it("preserves the matched message on refresh and recovers when that message disappears", async () => {
    query("needle");
    el<HTMLButtonElement>(".next-match").click();
    const viewport = el(".viewport");
    viewport.scrollTop = 250;
    viewport.scrollLeft = 30;
    history.get.mockResolvedValue(
      tree([...messages, { message_id: 4, parent_id: 31, role: "ASSISTANT", content: "Needle new answer" }]),
    );
    await refresh();
    expect(el(".current-match").getAttribute("data-id")).toBe("31");
    expect(el(".search-count").textContent).toBe("2 / 4");
    expect(viewport.scrollTop).toBe(250);
    expect(viewport.scrollLeft).toBe(30);
    expect(shadow.activeElement).toBe(el("input"));
    history.get.mockResolvedValue(tree(messages.filter((message) => message.message_id !== 31)));
    await refresh();
    expect(el(".current-match").getAttribute("data-id")).toBe("7");
    expect(el(".search-count").textContent).toBe("1 / 2");
    expect(el(".preview-text").textContent).toBe("Needle active answer");
  });

  it("resets search state when the conversation changes", async () => {
    query("needle");
    window.history.pushState({}, "", "/a/chat/s/abcdef-5678");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await flushAsync();
    expect(el<HTMLInputElement>("input").value).toBe("");
    expect(el(".search-navigation").hidden).toBe(true);
    expect(shadow.querySelector(".current-match")).toBeNull();
  });
});

describe("tree reading position", () => {
  it("disables the button when no visible message can be associated with the tree", () => {
    expect(el<HTMLButtonElement>(".reading-position").disabled).toBe(true);
  });

  it("keeps reading and search markers separate and locates reading inside the tree only", () => {
    const message = document.createElement("div");
    message.setAttribute("data-virtual-list-item-key", "7");
    document.body.append(message);
    stubRect(message, { top: 200, bottom: 300, height: 100 });
    query("needle");
    expect(el(".viewing").getAttribute("data-id")).toBe("7");
    expect(el(".viewing.current-match").querySelector(".search-halo")).not.toBeNull();
    expect(el(".viewing.current-match").querySelector(".ring")).not.toBeNull();
    el<HTMLButtonElement>(".next-match").click();
    el<HTMLButtonElement>(".reading-position").click();
    expect(el(".preview-text").textContent).toBe("Needle active answer");
    expect(el(".search-count").textContent).toBe("2 / 3");
    expect(jumpToMessage).not.toHaveBeenCalled();
  });

  it("ignores virtual-list overscan rows clipped outside the scroll viewport", () => {
    const viewport = document.createElement("div");
    viewport.style.overflowY = "auto";
    Object.defineProperty(viewport, "clientHeight", { value: 200 });
    stubRect(viewport, { top: 100, bottom: 300, height: 200 });
    for (const [id, top] of [
      ["7", 200],
      ["31", 310],
    ] as const) {
      const message = document.createElement("div");
      message.setAttribute("data-virtual-list-item-key", id);
      stubRect(message, { top, bottom: top + 80, height: 80 });
      viewport.append(message);
    }
    document.body.append(viewport);
    window.dispatchEvent(new Event("scroll"));
    raf.flush();
    expect(el(".viewing").getAttribute("data-id")).toBe("7");
    expect(el<HTMLButtonElement>(".reading-position").disabled).toBe(false);
  });
});
