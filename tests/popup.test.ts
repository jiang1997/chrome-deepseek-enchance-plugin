import { describe, expect, it, beforeEach } from "vitest";
import { computePopupPosition } from "../src/core/popup";

const VP = { width: 1280, height: 800 };

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: VP.width, writable: true });
  Object.defineProperty(window, "innerHeight", { value: VP.height, writable: true });
});

describe("computePopupPosition", () => {
  it("紧靠输入框上方并与输入框等宽", () => {
    const r = computePopupPosition(
      { top: 600, left: 300, bottom: 700, right: 900, width: 600, height: 100, x: 300, y: 600 },
      44,
      VP,
    );
    expect(r).toEqual({ top: 548, left: 300, width: 600 });
  });

  it("输入框靠近顶部时不把提示放到输入框下方", () => {
    const r = computePopupPosition(
      { top: 30, left: 500, bottom: 90, right: 900, width: 400, height: 60, x: 500, y: 30 },
      44,
      VP,
    );
    expect(r.top).toBe(8);
  });

  it("输入框超出视口时限制提示宽度和横向位置", () => {
    const left = computePopupPosition(
      { top: 600, left: -20, bottom: 700, right: 1300, width: 1320, height: 100, x: -20, y: 600 },
      44,
      VP,
    );
    expect(left.left).toBe(8);
    expect(left.width).toBe(1264);
  });
});
