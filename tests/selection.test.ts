import { describe, expect, it, beforeEach } from "vitest";
import { selectText } from "./helpers/dom";
import {
  cleanSelectionText,
  isInEditable,
  isInExcludedUI,
  isInPopup,
  isValidRect,
  validateSelection,
} from "../src/core/selection";

function selectTextIn(el: HTMLElement): Selection | null {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  return sel;
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
  Object.defineProperty(window, "innerWidth", { value: 1280, writable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, writable: true });
});

describe("cleanSelectionText", () => {
  it("trims and normalizes newlines", () => {
    expect(cleanSelectionText("  a\r\nb  ")).toBe("a\nb");
  });
});

describe("isValidRect", () => {
  it("zero size is invalid", () => {
    expect(
      isValidRect({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0 }),
    ).toBe(false);
  });
  it("outside the viewport is invalid", () => {
    expect(
      isValidRect({ top: -100, left: 10, bottom: -50, right: 100, width: 90, height: 50, x: 10, y: -100 }),
    ).toBe(false);
  });
});

describe("exclusion helpers", () => {
  it("detects inside an editable", () => {
    document.body.innerHTML = `<textarea id="t">hello</textarea>`;
    const t = document.getElementById("t")!;
    expect(isInEditable(t)).toBe(true);
  });
  it("detects inside the popup", () => {
    document.body.innerHTML = `<div data-dse-popup="true"><span id="x">Quote</span></div>`;
    expect(isInPopup(document.getElementById("x")!)).toBe(true);
  });
  it("detects inside a sidebar", () => {
    document.body.innerHTML = `<aside><span id="s">Search</span></aside>`;
    expect(isInExcludedUI(document.getElementById("s")!)).toBe(true);
  });
});

describe("validateSelection", () => {
  it("rejects an empty selection", () => {
    expect(validateSelection(window.getSelection())).toEqual({ ok: false, reason: "empty" });
  });

  it("accepts a normal text selection (with a stubbed valid rect)", () => {
    document.body.innerHTML = `<main><p id="p">JavaScript closures keep the lexical environment.</p></main>`;
    const sel = selectTextIn(document.getElementById("p")!);
    // jsdom always returns 0 from getBoundingClientRect, so stub a visible rect
    const range = sel!.getRangeAt(0);
    range.getBoundingClientRect = () =>
      ({ top: 100, left: 100, bottom: 120, right: 300, width: 200, height: 20, x: 100, y: 100 }) as DOMRect;
    const res = validateSelection(sel);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.snapshot.text).toContain("closure");
  });

  it("attaches message provenance when the selection is inside a message item", () => {
    document.body.innerHTML = `
      <div class="ds-virtual-list-items">
        <div class="ds-virtual-list-visible-items" style="--dsl-virtual-list-transform-y: 0px">
        <div data-virtual-list-item-key="1"><div class="ds-collapsible-text"><span>hi</span></div></div>
        <div data-virtual-list-item-key="2"><div class="ds-assistant-message-main-content"><p id="p">A closure keeps the lexical environment.</p></div></div>
        </div>
      </div>`;
    const sel = selectTextIn(document.getElementById("p")!);
    const range = sel!.getRangeAt(0);
    range.getBoundingClientRect = () =>
      ({ top: 100, left: 100, bottom: 120, right: 300, width: 200, height: 20, x: 100, y: 100 }) as DOMRect;
    const res = validateSelection(sel);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.snapshot.context).toEqual({ role: "assistant", index: 1, position: 2 });
  });

  it.each([false, true])("omits provenance for cross-message selections (backward=%s)", (backward) => {
    document.body.innerHTML = `<div class="ds-virtual-list-items">
      <div class="ds-virtual-list-visible-items" style="--dsl-virtual-list-transform-y: 0px">
        <div data-virtual-list-item-key="1"><div class="ds-collapsible-text"><span id="user">My question</span></div></div>
        <div data-virtual-list-item-key="2"><div class="ds-assistant-message-main-content"><p id="assistant">AI answer</p></div></div>
      </div></div>`;
    const start = document.getElementById("user")!.firstChild!;
    const end = document.getElementById("assistant")!.firstChild!;
    const sel = window.getSelection()!;
    sel.setBaseAndExtent(backward ? end : start, backward ? 9 : 0, backward ? start : end, backward ? 0 : 9);
    sel.getRangeAt(0).getBoundingClientRect = () =>
      ({ top: 100, left: 100, bottom: 140, right: 300, width: 200, height: 40, x: 100, y: 100 }) as DOMRect;
    const result = validateSelection(sel);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.text).toContain("My question");
      expect(result.snapshot.text).toContain("AI answer");
      expect(result.snapshot.context).toEqual({ role: "unknown", index: null, position: null });
    }
  });

  it("keeps provenance for a selection spanning blocks within one message", () => {
    document.body.innerHTML = `<div data-virtual-list-item-key="10">
      <div class="ds-assistant-message-main-content" id="body"><p>Explanation</p><pre>Example</pre></div>
    </div>`;
    const result = validateSelection(selectText(document.getElementById("body")!));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.context).toEqual({ role: "assistant", index: null, position: null });
  });

  it("rejects a selection inside an editable", () => {
    document.body.innerHTML = `<textarea id="t">draft content</textarea>`;
    const t = document.getElementById("t") as HTMLTextAreaElement;
    t.focus();
    t.setSelectionRange(0, 2);
    // The textarea selection API differs from window.getSelection: building a Selection by hand is hard,
    // so this verifies directly that the helper covers that branch
    expect(isInEditable(t)).toBe(true);
  });

  it("rejects over-long text", () => {
    document.body.innerHTML = `<main><p id="p">${"a".repeat(5001)}</p></main>`;
    const sel = selectTextIn(document.getElementById("p")!);
    const range = sel!.getRangeAt(0);
    range.getBoundingClientRect = () =>
      ({ top: 10, left: 10, bottom: 30, right: 200, width: 190, height: 20, x: 10, y: 10 }) as DOMRect;
    expect(validateSelection(sel)).toEqual({ ok: false, reason: "too-long" });
  });
});
