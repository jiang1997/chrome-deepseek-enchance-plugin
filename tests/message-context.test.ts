import { describe, expect, it, beforeEach } from "vitest";
import {
  classifyMessageRole,
  describeMessageContext,
  findMessageItem,
  readMessagePosition,
  resolveMessageContext,
} from "../src/core/message-context";

/** Build a conversation matching the live DeepSeek message-list structure. */
function renderConversation(
  items: Array<{ key: number; role: "user" | "assistant" }>,
  containerClass = "ds-virtual-list-items",
): HTMLElement {
  document.body.innerHTML = `
    <div class="${containerClass}" id="list">
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

describe("findMessageItem / readMessagePosition", () => {
  it("finds the wrapping item from a deep text node and reads its position", () => {
    const list = renderConversation([{ key: 5, role: "assistant" }]);
    const span = list.querySelector("p")!.firstChild!;
    const item = findMessageItem(span);
    expect(item).not.toBeNull();
    expect(readMessagePosition(item!)).toBe(5);
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

  it("derives the ordinal when the virtual list has unmounted earlier items", () => {
    const list = renderConversation([
      { key: 21, role: "user" },
      { key: 22, role: "assistant" },
      { key: 23, role: "user" },
      { key: 24, role: "assistant" },
    ]);
    const assistant = list.children[3].querySelector("p")!.firstChild!;
    expect(resolveMessageContext(assistant)).toEqual({
      role: "assistant",
      index: 12,
      position: 24,
    });
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
