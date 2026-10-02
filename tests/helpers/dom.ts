/** Shared DOM helpers for content-script tests. */
import { vi } from "vitest";

export type RafStub = {
  /** Run every callback scheduled so far, in registration order. */
  flush: () => void;
  /** Number of callbacks still queued. */
  pending: () => number;
};

/** Deterministic requestAnimationFrame: callbacks only run when flush() is called. */
export function installAnimationFrameStub(): RafStub {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    nextId += 1;
    callbacks.set(nextId, cb);
    return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    callbacks.delete(id);
  });
  return {
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const cb of pending) cb(performance.now());
    },
    pending() {
      return callbacks.size;
    },
  };
}

/** Give an element a visible layout box (jsdom always reports 0). */
export function stubRect(el: Element, rect: Partial<DOMRect> = {}): void {
  el.getBoundingClientRect = () =>
    ({
      top: 600,
      left: 100,
      bottom: 700,
      right: 900,
      width: 800,
      height: 100,
      x: 100,
      y: 600,
      toJSON: () => ({}),
      ...rect,
    }) as DOMRect;
}

/** Select the contents of an element with a visible bounding rect. */
export function selectText(element: Element, rect: Partial<DOMRect> = {}): Selection {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.getBoundingClientRect = () =>
    ({
      top: 100,
      left: 100,
      bottom: 120,
      right: 300,
      width: 200,
      height: 20,
      x: 100,
      y: 100,
      toJSON: () => ({}),
      ...rect,
    }) as DOMRect;
  const selection = window.getSelection();
  if (!selection) throw new Error("no selection available");
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

export function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let pending microtasks and timers settle. */
export async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
