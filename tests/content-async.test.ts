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
function showPopupWith(composer: HTMLElement): void {
  mocks.findComposer.mockReturnValue(composer);
  mountSelection();
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
