import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDeferred,
  flushAsync,
  installAnimationFrameStub,
  selectText,
  stubRect,
  type RafStub,
} from "./helpers/dom";

const mocks = vi.hoisted(() => ({
  findComposer: vi.fn(),
  findComposerWithRetry: vi.fn(),
  insertIntoComposer: vi.fn(),
  isComposerEditable: vi.fn(),
}));

vi.mock("../src/adapters/deepseek-composer", () => ({
  findComposer: mocks.findComposer,
  findComposerWithRetry: mocks.findComposerWithRetry,
  insertIntoComposer: mocks.insertIntoComposer,
  isComposerEditable: mocks.isComposerEditable,
}));

type ContentModule = typeof import("../src/core/enhancer");

let content: ContentModule | undefined;
let raf: RafStub;

function isEditable(el: HTMLElement | null): boolean {
  if (el instanceof HTMLTextAreaElement) return el.isConnected && !el.disabled && !el.readOnly;
  return !!el && el.isConnected;
}

function mountComposer(draft = ""): HTMLTextAreaElement {
  const composer = document.createElement("textarea");
  composer.value = draft;
  document.body.appendChild(composer);
  stubRect(composer);
  return composer;
}

function mountSelection(text = "Selected sentence."): void {
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  document.body.appendChild(paragraph);
  selectText(paragraph);
}

function showPopup(): void {
  document.dispatchEvent(new Event("pointerup", { bubbles: true }));
  raf.flush();
}

function getPopup(): HTMLElement {
  return document.querySelector<HTMLElement>("[data-dse-popup]")!;
}

function getButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>("[data-dse-popup] .dse-popup-btn")!;
}

/** Show the prompt while findComposer resolves to the given element. */
function showPopupWith(composer: HTMLElement, text = "Selected sentence."): void {
  mocks.findComposer.mockReturnValue(composer);
  mountSelection(text);
  showPopup();
  expect(getPopup().style.display).toBe("flex");
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.findComposer.mockReturnValue(null);
  mocks.findComposerWithRetry.mockResolvedValue(null);
  mocks.insertIntoComposer.mockReturnValue(true);
  mocks.isComposerEditable.mockImplementation(isEditable);
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
  delete window.__DSE_INITIALIZED__;
  Object.defineProperty(window, "innerWidth", { value: 1280, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, writable: true, configurable: true });
  raf = installAnimationFrameStub();
  content = await import("../src/core/enhancer");
  content.init();
});

afterEach(() => {
  content?.destroy();
  content = undefined;
  vi.unstubAllGlobals();
});

describe("content script async state management", () => {
  it("cancels an in-flight composer lookup when the prompt closes", async () => {
    const cached = mountComposer();
    const deferred = createDeferred<HTMLElement | null>();
    mocks.findComposerWithRetry.mockReturnValue(deferred.promise);
    showPopupWith(cached);

    cached.remove(); // force the retry path
    getButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(mocks.findComposerWithRetry).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape" }));
    deferred.resolve(mountComposer());
    await flushAsync();

    expect(mocks.insertIntoComposer).not.toHaveBeenCalled();
  });

  it("writes only once when the quote button is clicked repeatedly", async () => {
    const cached = mountComposer();
    const deferred = createDeferred<HTMLElement | null>();
    mocks.findComposerWithRetry.mockReturnValue(deferred.promise);
    showPopupWith(cached);

    cached.remove(); // force the retry path
    const button = getButton();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(button.disabled).toBe(true);
    // Re-enable to simulate a second click racing the disabled state; it must still write only once.
    button.disabled = false;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    deferred.resolve(mountComposer());
    await flushAsync();

    expect(mocks.insertIntoComposer).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending quote when the popup hides itself after the composer is removed", async () => {
    const cached = mountComposer();
    const deferred = createDeferred<HTMLElement | null>();
    mocks.findComposerWithRetry.mockReturnValue(deferred.promise);
    showPopupWith(cached);

    cached.remove(); // force the retry path and disconnect the popup anchor
    getButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Scrolling repositions the prompt; the disconnected anchor makes it hide itself.
    window.dispatchEvent(new Event("scroll"));
    expect(getPopup().style.display).toBe("none");

    deferred.resolve(mountComposer());
    await flushAsync();

    expect(mocks.insertIntoComposer).not.toHaveBeenCalled();
  });

  it("cancels the old quote when a new selection replaces the preview", async () => {
    const cached = mountComposer();
    const deferred = createDeferred<HTMLElement | null>();
    mocks.findComposerWithRetry.mockReturnValue(deferred.promise);
    showPopupWith(cached, "First selection.");

    cached.remove(); // force the retry path for the first quote
    getButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // While the first lookup is pending, the user selects different text.
    const next = mountComposer();
    mocks.findComposer.mockReturnValue(next);
    mountSelection("Second selection.");
    showPopup();

    expect(getPopup().textContent).toContain("Second selection.");

    deferred.resolve(mountComposer());
    await flushAsync();

    expect(mocks.insertIntoComposer).not.toHaveBeenCalled();
    expect(getPopup().style.display).toBe("flex");
    expect(getPopup().textContent).toContain("Second selection.");
  });

  it("cancels the old quote when the selection changes before the new preview frame runs", async () => {
    const cached = mountComposer();
    const deferred = createDeferred<HTMLElement | null>();
    mocks.findComposerWithRetry.mockReturnValue(deferred.promise);
    showPopupWith(cached, "First selection.");

    cached.remove(); // force the retry path for the first quote
    getButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // The selection changes and schedules the new preview frame, but it has NOT run yet.
    const next = mountComposer();
    mocks.findComposer.mockReturnValue(next);
    mountSelection("Second selection.");
    document.dispatchEvent(new Event("pointerup", { bubbles: true }));
    expect(raf.pending()).toBe(1);

    // The old lookup settles ahead of the preview frame: the racy window.
    deferred.resolve(mountComposer());
    await flushAsync();

    expect(mocks.insertIntoComposer).not.toHaveBeenCalled();

    // The pending preview frame still runs and shows the new selection.
    raf.flush();
    expect(getPopup().style.display).toBe("flex");
    expect(getPopup().textContent).toContain("Second selection.");
  });

  it("does not write when the composer is disabled before the write", async () => {
    const cached = mountComposer();
    const deferred = createDeferred<HTMLElement | null>();
    mocks.findComposerWithRetry.mockReturnValue(deferred.promise);
    showPopupWith(cached);

    cached.remove(); // force the retry path
    getButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const disabled = mountComposer();
    disabled.disabled = true;
    deferred.resolve(disabled);
    await flushAsync();

    expect(mocks.insertIntoComposer).not.toHaveBeenCalled();
    expect(getPopup().style.display).toBe("none");
  });

  it("writes once the composer appears and is still editable", async () => {
    const cached = mountComposer();
    const deferred = createDeferred<HTMLElement | null>();
    mocks.findComposerWithRetry.mockReturnValue(deferred.promise);
    showPopupWith(cached);

    cached.remove(); // force the retry path
    getButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const late = mountComposer();
    deferred.resolve(late);
    await flushAsync();

    expect(mocks.insertIntoComposer).toHaveBeenCalledTimes(1);
    const [target, quote] = mocks.insertIntoComposer.mock.calls[0];
    expect(target).toBe(late);
    expect(quote).toBe("“Selected sentence.”\n\n");
  });
});
