import { afterEach, describe, expect, it } from "vitest";
import { renderedTree } from "../src/tree/deepseek";

afterEach(() => document.body.replaceChildren());

function preview(markup: string): string | undefined {
  document.body.innerHTML = `<div data-virtual-list-item-key="42">${markup}</div>`;
  return renderedTree().nodes.get("42")?.content;
}

describe("rendered conversation previews", () => {
  it("prefers the answer over thinking and earlier Markdown blocks", () => {
    expect(
      preview(`
        <div class="ds-think-content"><div class="ds-markdown">Private reasoning</div></div>
        <div class="ds-markdown">Earlier auxiliary text</div>
        <div class="ds-assistant-message-main-content">Final answer</div>
      `),
    ).toBe("Final answer");
  });

  it("keeps a normal answer without a thinking block", () => {
    expect(preview('<div class="ds-assistant-message-main-content"><p>Final answer</p></div>')).toBe("Final answer");
  });

  it("falls back to all answer Markdown blocks outside thinking without duplicating nested blocks", () => {
    expect(
      preview(`
        <div class="ds-think-content"><div class="ds-markdown">Private reasoning</div></div>
        <div class="changed-answer-wrapper">
          <div class="ds-markdown">First <span class="ds-markdown">answer</span></div>
          <div class="ds-markdown">Second answer</div>
        </div>
      `),
    ).toBe("First answer\n\nSecond answer");
  });

  it.each([
    '<div class="ds-think-content"><div class="ds-markdown">Private reasoning</div></div>',
    '<div class="ds-think-content">Private reasoning</div><div class="ds-assistant-message-main-content"></div>',
  ])("explicitly marks thinking-only messages without presenting reasoning as an answer", (markup) => {
    expect(preview(markup)).toBe("Only thinking content is rendered.");
  });

  it.each(["ds-assistant-message-main-content", "ds-markdown"])(
    "removes message controls from %s while preserving code whitespace and legitimate content",
    (containerClass) => {
      expect(
        preview(
          `<div class="${containerClass}"><div class="ds-think-content">Reasoning</div><div class="rethinking-example">Answer</div><div role="button">Relevant content</div><div class="md-code-block"><div class="md-code-block-banner-wrap"><span>Python</span><button>Copy</button></div><pre><code>if ready:\n  run()</code></pre></div><div class="ds-icon-button">Retry</div><button>Download</button><style>.example { color: red; }</style><script>unrelated()</script></div>`,
        ),
      ).toBe("AnswerRelevant contentif ready:\n  run()");
    },
  );

  it("leaves an empty answer empty when no thinking block exists", () => {
    expect(preview('<div class="ds-assistant-message-main-content"><button>Retry</button></div>')).toBe("");
  });

  it("preserves user message text", () => {
    expect(preview('<div class="ds-collapsible-text">My original question</div>')).toBe("My original question");
  });

  it("does not change the live message DOM or the selected text", () => {
    document.body.innerHTML = `<div data-virtual-list-item-key="42"><div class="ds-think-content"><div class="ds-markdown">Reasoning</div></div><div class="ds-assistant-message-main-content">Answer<button>Copy</button></div></div>`;
    const before = document.body.innerHTML;
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(".ds-think-content .ds-markdown")!);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    try {
      expect(renderedTree().nodes.get("42")?.content).toBe("Answer");
      expect(document.body.innerHTML).toBe(before);
      expect(selection.toString()).toBe("Reasoning");
    } finally {
      selection.removeAllRanges();
    }
  });
});
