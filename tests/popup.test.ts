import { describe, expect, it, beforeEach } from "vitest";
import { computePopupPosition } from "../src/core/popup";

const VP = { width: 1280, height: 800 };

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: VP.width, writable: true });
  Object.defineProperty(window, "innerHeight", { value: VP.height, writable: true });
});

describe("computePopupPosition", () => {
  it("directly above the composer, same width as the composer", () => {
    const r = computePopupPosition(
      { top: 600, left: 300, bottom: 700, right: 900, width: 600, height: 100, x: 300, y: 600 },
      44,
      VP,
    );
    expect(r).toEqual({ top: 548, left: 300, width: 600 });
  });

  it("does not place the prompt below the composer when it is near the top", () => {
    const r = computePopupPosition(
      { top: 30, left: 500, bottom: 90, right: 900, width: 400, height: 60, x: 500, y: 30 },
      44,
      VP,
    );
    expect(r.top).toBe(8);
  });

  it("clamps the prompt width and horizontal position when the composer exceeds the viewport", () => {
    const left = computePopupPosition(
      { top: 600, left: -20, bottom: 700, right: 1300, width: 1320, height: 100, x: -20, y: 600 },
      44,
      VP,
    );
    expect(left.left).toBe(8);
    expect(left.width).toBe(1264);
  });
});
