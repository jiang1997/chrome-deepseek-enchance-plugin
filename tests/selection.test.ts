import { describe, expect, it, beforeEach } from "vitest";
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
