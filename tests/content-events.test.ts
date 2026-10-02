import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installAnimationFrameStub, selectText, stubRect, type RafStub } from "./helpers/dom";

type ContentModule = typeof import("../src/core/enhancer");

let content: ContentModule | undefined;
let raf: RafStub;

function mountComposer(draft = ""): HTMLTextAreaElement {
  const composer = document.createElement("textarea");
  composer.setAttribute("aria-label", "Send message");
  composer.setAttribute("placeholder", "Type a message");
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

beforeEach(async () => {
  vi.resetModules();
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
  vi.restoreAllMocks();
});

describe("content script event flow", () => {
  it("shows the quote prompt after selecting response text", () => {
    mountComposer();
    mountSelection("Closures keep the lexical environment.");
    showPopup();

    const popup = getPopup();
    expect(popup).not.toBeNull();
    expect(popup.style.display).toBe("flex");
    expect(popup.textContent).toContain("Closures keep the lexical environment.");
  });

  it("appends the quote and preserves the existing draft", () => {
    const composer = mountComposer("existing draft");
    mountSelection("Selected sentence.");
    showPopup();

    getButton().click();

    expect(composer.value).toBe("existing draft\n“Selected sentence.”\n\n");
    expect(getPopup().style.display).toBe("none");
  });

  it("closes the prompt when Escape is pressed", () => {
    mountComposer();
    mountSelection();
    showPopup();
    expect(getPopup().style.display).toBe("flex");

    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape" }));

    expect(getPopup().style.display).toBe("none");
  });

  it("does not register duplicate listeners when initialized twice", () => {
    const addSpy = vi.spyOn(document, "addEventListener");

    content!.init(); // already initialized by the module import

    expect(addSpy).not.toHaveBeenCalled();
    expect(window.__DSE_INITIALIZED__).toBe(true);

    mountComposer();
    mountSelection();
    showPopup();
    expect(document.querySelectorAll("[data-dse-popup]").length).toBe(1);
  });

  it("hides the prompt when clicking elsewhere on the page", () => {
    mountComposer();
    mountSelection();
    showPopup();
    expect(getPopup().style.display).toBe("flex");

    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(getPopup().style.display).toBe("none");
  });
});
