import { describe, expect, it, beforeEach } from "vitest";
import { computePopupPosition } from "../src/core/popup";

const VP = { width: 1280, height: 800 };

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: VP.width, writable: true });
  Object.defineProperty(window, "innerHeight", { value: VP.height, writable: true });
});

describe("computePopupPosition", () => {
  it("默认放选区上方居中", () => {
    const r = computePopupPosition(
      { top: 300, left: 500, bottom: 320, right: 700, width: 200, height: 20, x: 500, y: 300 },
      { width: 80, height: 32 },
      VP,
    );
    expect(r.placement).toBe("above");
    expect(r.top).toBe(300 - 32 - 8);
    expect(r.left).toBe(Math.round(500 + 100 - 40));
  });

  it("上方空间不足时翻转到下方", () => {
    const r = computePopupPosition(
      { top: 5, left: 500, bottom: 25, right: 700, width: 200, height: 20, x: 500, y: 5 },
      { width: 80, height: 32 },
      VP,
    );
    expect(r.placement).toBe("below");
    expect(r.top).toBe(25 + 8);
  });

  it("左右边界钳制", () => {
    const left = computePopupPosition(
      { top: 300, left: 0, bottom: 320, right: 50, width: 50, height: 20, x: 0, y: 300 },
      { width: 80, height: 32 },
      VP,
    );
    expect(left.left).toBeGreaterThanOrEqual(8);

    const right = computePopupPosition(
      { top: 300, left: 1250, bottom: 320, right: 1280, width: 30, height: 20, x: 1250, y: 300 },
      { width: 80, height: 32 },
      VP,
    );
    expect(right.left + 80).toBeLessThanOrEqual(VP.width - 8);
  });
});
