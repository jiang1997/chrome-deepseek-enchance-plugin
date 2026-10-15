import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDeferred,
  firstCall,
  flushAsync,
  installAnimationFrameStub,
  selectText,
  stubRect,
  type RafStub,
} from "./helpers/dom";
import { parseHistory, type ChatTree } from "../src/tree/model";
const history = vi.hoisted(() => ({ get: vi.fn(), syncConversation: vi.fn() }));
vi.mock("../src/tree/history-service", () => ({ conversationHistory: history }));
import { init, destroy } from "../src/core/enhancer";

let raf: RafStub;
let composer: HTMLTextAreaElement;
const fullTree = () =>
  parseHistory({
    data: {
      biz_data: {
        chat_messages: [
          { message_id: 1, parent_id: 0, role: "USER" },
          { message_id: 2, parent_id: 1, role: "ASSISTANT" },
          { message_id: 3, parent_id: 2, role: "USER" },
          { message_id: 4, parent_id: 3, role: "ASSISTANT" },
        ],
        chat_session: { current_message_id: 999 },
      },
    },
  });
const popup = () => document.querySelector<HTMLElement>("[data-dse-popup]")!;
const button = () => popup().querySelector<HTMLButtonElement>("button")!;
function select(id = "4"): void {
  selectText(document.querySelector(`[data-virtual-list-item-key="${id}"] p`)!);
  document.dispatchEvent(new Event("pointerup"));
  raf.flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/a/chat/s/abcdef-1234");
  document.body.innerHTML =
    '<div class="ds-virtual-list-items"><div class="ds-virtual-list-visible-items" style="--dsl-virtual-list-transform-y:500px"><div data-virtual-list-item-key="3"><div class="ds-collapsible-text"><p>User text</p></div></div><div data-virtual-list-item-key="4"><div class="ds-markdown"><p>Answer text</p></div></div></div></div><textarea placeholder="Message DeepSeek">draft</textarea>';
  composer = document.querySelector("textarea")!;
  stubRect(composer);
  window.getSelection()?.removeAllRanges();
  delete window.__DSE_INITIALIZED__;
  raf = installAnimationFrameStub();
  init();
});
afterEach(() => {
  destroy();
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});

describe("quote history integration", () => {
  it("updates the preview and waits for ancestry before inserting a quote", async () => {
    const pending = createDeferred<ChatTree>();
    history.get.mockReturnValue(pending.promise);
    select();
    expect(popup().textContent).toContain("Selected assistant:");
    button().click();
    expect(button().disabled).toBe(true);
    expect(composer.value).toBe("draft");
    pending.resolve(fullTree());
    await flushAsync();
    expect(composer.value).toContain("[Quote · assistant #2]");
    expect(composer.value).toContain("draft");
  });
  it("does not let an old history response relabel a replacement selection", async () => {
    const old = createDeferred<ChatTree>();
    const current = createDeferred<ChatTree>();
    history.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    select("4");
    const oldSignal = firstCall(history.get)[1] as AbortSignal;
    select("3");
    expect(oldSignal.aborted).toBe(true);
    old.resolve(fullTree());
    await flushAsync();
    expect(popup().textContent).toContain("Selected user:");
    current.resolve(fullTree());
    await flushAsync();
    expect(popup().textContent).toContain("Selected user #2:");
  });
  it("cancels a quote waiting for history when the user dismisses it", async () => {
    const pending = createDeferred<ChatTree>();
    history.get.mockReturnValue(pending.promise);
    select();
    button().click();
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape" }));
    expect((firstCall(history.get)[1] as AbortSignal).aborted).toBe(true);
    pending.resolve(fullTree());
    await flushAsync();
    expect(composer.value).toBe("draft");
    expect(popup().style.display).toBe("none");
  });
  it("does not insert after navigation during a history request", async () => {
    const pending = createDeferred<ChatTree>();
    history.get.mockReturnValue(pending.promise);
    select();
    button().click();
    window.history.pushState({}, "", "/a/chat/s/abcdef-5678");
    window.dispatchEvent(new PopStateEvent("popstate"));
    pending.resolve(fullTree());
    await flushAsync();
    expect(composer.value).toBe("draft");
    expect(history.syncConversation).toHaveBeenCalledWith("abcdef-5678");
  });
  it("falls back to a role-only quote when history fails and the DOM prefix is unmounted", async () => {
    history.get.mockRejectedValue(new Error("offline"));
    select();
    button().click();
    await flushAsync();
    expect(composer.value).toContain("[Quote · assistant]");
    expect(composer.value).not.toContain("#");
  });
  it("retains reliable DOM numbering when ancestry is incomplete", async () => {
    document
      .querySelector<HTMLElement>(".ds-virtual-list-visible-items")!
      .style.setProperty("--dsl-virtual-list-transform-y", "0px");
    history.get.mockResolvedValue(
      parseHistory({ data: { biz_data: { chat_messages: [{ message_id: 4, parent_id: 999, role: "ASSISTANT" }] } } }),
    );
    select();
    button().click();
    await flushAsync();
    expect(composer.value).toContain("[Quote · assistant #1]");
  });
});
