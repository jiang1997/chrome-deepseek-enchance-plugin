import { describe, expect, it, beforeEach } from "vitest";
import {
  classifyMessageRole,
  describeMessageContext,
  findMessageItem,
  resolveMessageContext,
} from "../src/core/message-context";

/** Build a conversation matching the live DeepSeek message-list structure. */
function renderConversation(
  items: Array<{ key: number | string; role: "user" | "assistant" }>,
  windowOffset: string | null = "0px",
): HTMLElement {
  document.body.innerHTML = `
    <div class="ds-virtual-list-items">
    <div class="ds-virtual-list-visible-items" id="list" ${windowOffset === null ? "" : `style="--dsl-virtual-list-transform-y: ${windowOffset}"`}>
      ${items
        .map(({ key, role }) => {
          const body =
            role === "assistant"
              ? `<div class="ds-markdown ds-assistant-message-main-content"><p>AI body ${key}</p></div>`
              : `<div class="fbb737a4"><div class="ds-collapsible-text"><div><span>User body ${key}</span></div></div></div>`;
          return `<div class="_msg" data-virtual-list-item-key="${key}"><div class="ds-message">${body}</div></div>`;
        })
        .join("")}
    </div>
    </div>
  `;
  return document.getElementById("list")!;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("classifyMessageRole", () => {
  it("recognizes assistant and user message items", () => {
    const list = renderConversation([
      { key: 1, role: "user" },
      { key: 2, role: "assistant" },
    ]);
    const [userItem, assistantItem] = Array.from(list.children) as HTMLElement[];
    expect(classifyMessageRole(userItem)).toBe("user");
    expect(classifyMessageRole(assistantItem)).toBe("assistant");
  });

  it("returns unknown for unrelated nodes", () => {
    document.body.innerHTML = `<p id="p">plain</p>`;
    expect(classifyMessageRole(document.getElementById("p")!)).toBe("unknown");
  });
});

describe("findMessageItem", () => {
  it("finds the wrapping item from a deep text node", () => {
    const list = renderConversation([{ key: 5, role: "assistant" }]);
    const span = list.querySelector("p")!.firstChild!;
    const item = findMessageItem(span);
    expect(item).not.toBeNull();
    expect(item!.getAttribute("data-virtual-list-item-key")).toBe("5");
  });

  it("returns null outside any message", () => {
    document.body.innerHTML = `<main><span id="x">loose</span></main>`;
    expect(findMessageItem(document.getElementById("x"))).toBeNull();
  });
});

describe("describeMessageContext", () => {
  it("formats assistant and user badges", () => {
    expect(describeMessageContext({ role: "assistant", index: 2, position: 4 })).toBe("AI #2");
    expect(describeMessageContext({ role: "user", index: 3, position: 5 })).toBe("You #3");
  });

  it("falls back to a role-only badge when the ordinal is unknown", () => {
    expect(describeMessageContext({ role: "assistant", index: null, position: null })).toBe("AI");
  });

  it("is empty for unknown context", () => {
    expect(describeMessageContext(null)).toBe("");
    expect(describeMessageContext({ role: "unknown", index: null, position: null })).toBe("");
  });
});

describe("resolveMessageContext", () => {
  it("resolves the assistant ordinal when the whole list is rendered", () => {
    const list = renderConversation([
      { key: 1, role: "user" },
      { key: 2, role: "assistant" },
      { key: 3, role: "user" },
      { key: 4, role: "assistant" },
    ]);
    const secondAssistant = list.children[3].querySelector("p")!.firstChild!;
    expect(resolveMessageContext(secondAssistant)).toEqual({
      role: "assistant",
      index: 2,
      position: 4,
    });
  });

  it("resolves the user ordinal independently from the assistant ordinal", () => {
    const list = renderConversation([
      { key: 1, role: "user" },
      { key: 2, role: "assistant" },
      { key: 3, role: "user" },
    ]);
    const secondUser = list.children[2].querySelector("span")!.firstChild!;
    expect(resolveMessageContext(secondUser)).toEqual({ role: "user", index: 2, position: 3 });
  });

  it("omits the ordinal when the virtual list has unmounted earlier items", () => {
    const list = renderConversation([
      { key: 21, role: "user" },
      { key: 22, role: "assistant" },
      { key: 23, role: "user" },
      { key: 24, role: "assistant" },
    ], "1200px");
    const assistant = list.children[3].querySelector("p")!.firstChild!;
    expect(resolveMessageContext(assistant)).toEqual({
      role: "assistant",
      index: null,
      position: null,
    });
  });

  it("counts from the top even when the first message ID is not 1", () => {
    const list = renderConversation([
      { key: 9, role: "user" },
      { key: 10, role: "assistant" },
    ]);
    expect(resolveMessageContext(list.children[0])).toEqual({ role: "user", index: 1, position: 1 });
    expect(resolveMessageContext(list.children[1])).toEqual({ role: "assistant", index: 1, position: 2 });
  });

  it("uses DOM order for noncontiguous, reordered, and temporary message IDs", () => {
    const list = renderConversation([
      { key: 9, role: "user" },
      { key: 14, role: "assistant" },
      { key: 11, role: "user" },
      { key: -2, role: "assistant" },
    ]);
    expect(resolveMessageContext(list.children[3])).toEqual({ role: "assistant", index: 2, position: 4 });
  });

  it("drops the ordinal rather than inventing a new one after prefix unmounting", () => {
    const list = renderConversation([
      { key: 1, role: "user" },
      { key: 4, role: "assistant" },
      { key: 5, role: "user" },
      { key: 6, role: "assistant" },
    ]);
    const target = list.children[3];
    expect(describeMessageContext(resolveMessageContext(target))).toBe("AI #2");
    list.children[0].remove();
    list.children[0].remove();
    list.style.setProperty("--dsl-virtual-list-transform-y", "800px");
    expect(resolveMessageContext(target)).toEqual({ role: "assistant", index: null, position: null });
    expect(describeMessageContext(resolveMessageContext(target))).toBe("AI");
  });

  it("does not infer a start from message ID 1 when window metadata is missing", () => {
    const list = renderConversation([{ key: 1, role: "user" }], null);
    expect(resolveMessageContext(list.children[0])).toEqual({ role: "user", index: null, position: null });
  });

  it("omits ordinals when an earlier message role cannot be classified", () => {
    const list = renderConversation([
      { key: 1, role: "user" },
      { key: 2, role: "assistant" },
      { key: 3, role: "user" },
      { key: 4, role: "assistant" },
    ]);
    list.children[1].innerHTML = "Unknown content";
    expect(resolveMessageContext(list.children[3])).toEqual({ role: "assistant", index: null, position: null });
  });

  it("returns unknown when the node is not inside a message", () => {
    document.body.innerHTML = `<main><span id="x">loose</span></main>`;
    expect(resolveMessageContext(document.getElementById("x"))).toEqual({
      role: "unknown",
      index: null,
      position: null,
    });
  });
});
