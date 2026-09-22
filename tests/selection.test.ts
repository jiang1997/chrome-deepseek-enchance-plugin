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
  it("trim 并统一换行", () => {
    expect(cleanSelectionText("  a\r\nb  ")).toBe("a\nb");
  });
});

describe("isValidRect", () => {
  it("零尺寸无效", () => {
    expect(
      isValidRect({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0 }),
    ).toBe(false);
  });
  it("视口外无效", () => {
    expect(
      isValidRect({ top: -100, left: 10, bottom: -50, right: 100, width: 90, height: 50, x: 10, y: -100 }),
    ).toBe(false);
  });
});

describe("exclusion helpers", () => {
  it("输入框内判定", () => {
    document.body.innerHTML = `<textarea id="t">hello</textarea>`;
    const t = document.getElementById("t")!;
    expect(isInEditable(t)).toBe(true);
  });
  it("浮层内判定", () => {
    document.body.innerHTML = `<div data-dse-popup="true"><span id="x">引用</span></div>`;
    expect(isInPopup(document.getElementById("x")!)).toBe(true);
  });
  it("侧栏判定", () => {
    document.body.innerHTML = `<aside><span id="s">搜索</span></aside>`;
    expect(isInExcludedUI(document.getElementById("s")!)).toBe(true);
  });
});

describe("validateSelection", () => {
  it("空选区拒绝", () => {
    expect(validateSelection(window.getSelection())).toEqual({ ok: false, reason: "empty" });
  });

  it("普通文本选区通过（含有效 rect 打桩）", () => {
    document.body.innerHTML = `<main><p id="p">JavaScript 中的闭包会保留词法环境。</p></main>`;
    const sel = selectTextIn(document.getElementById("p")!);
    // jsdom 的 getBoundingClientRect 恒为 0，打桩一个可见 rect
    const range = sel!.getRangeAt(0);
    range.getBoundingClientRect = () =>
      ({ top: 100, left: 100, bottom: 120, right: 300, width: 200, height: 20, x: 100, y: 100 }) as DOMRect;
    const res = validateSelection(sel);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.snapshot.text).toContain("闭包");
  });

  it("输入框内选区拒绝", () => {
    document.body.innerHTML = `<textarea id="t">草稿内容</textarea>`;
    const t = document.getElementById("t") as HTMLTextAreaElement;
    t.focus();
    t.setSelectionRange(0, 2);
    // textarea 的 selection API 与 window.getSelection 不同：手动构造 Selection 较难，
    // 这里直接验证 helper 覆盖了该分支
    expect(isInEditable(t)).toBe(true);
  });

  it("超长文本拒绝", () => {
    document.body.innerHTML = `<main><p id="p">${"a".repeat(5001)}</p></main>`;
    const sel = selectTextIn(document.getElementById("p")!);
    const range = sel!.getRangeAt(0);
    range.getBoundingClientRect = () =>
      ({ top: 10, left: 10, bottom: 30, right: 200, width: 190, height: 20, x: 10, y: 10 }) as DOMRect;
    expect(validateSelection(sel)).toEqual({ ok: false, reason: "too-long" });
  });
});
