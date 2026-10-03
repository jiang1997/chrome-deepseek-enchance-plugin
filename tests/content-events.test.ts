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

  it.each(["user", "assistant"])("previews and inserts provenance for a %s message", (role) => {
    const composer = mountComposer("draft");
    const list = document.createElement("div");
    list.className = "ds-virtual-list-items";
    list.innerHTML = `<div class="ds-virtual-list-visible-items" style="--dsl-virtual-list-transform-y: 0px">
      <div data-virtual-list-item-key="9"><div class="ds-collapsible-text"><span>Question</span></div></div>
      <div data-virtual-list-item-key="14"><div class="ds-assistant-message-main-content"><p>Answer</p></div></div>
    </div>`;
    document.body.appendChild(list);
    selectText(list.querySelector(role === "user" ? "span" : "p")!);
    showPopup();
    const badge = role === "user" ? "You #1" : "AI #1";
    const text = role === "user" ? "Question" : "Answer";
    expect(getPopup().textContent).toContain(`Selected ${badge}: ${text}`);
    getButton().click();
    expect(composer.value).toBe(`draft\n[Quote · ${badge}]\n“${text}”\n\n`);
  });

  it("inserts only the role label when the message prefix is unmounted", () => {
    const composer = mountComposer();
    const list = document.createElement("div");
    list.className = "ds-virtual-list-items";
    list.innerHTML = `<div class="ds-virtual-list-visible-items" style="--dsl-virtual-list-transform-y: 800px">
      <div data-virtual-list-item-key="6"><div class="ds-assistant-message-main-content"><p>Answer</p></div></div>
    </div>`;
    document.body.appendChild(list);
    selectText(list.querySelector("p")!);
    showPopup();
    expect(getPopup().textContent).toContain("Selected AI: Answer");
    getButton().click();
    expect(composer.value).toBe("[Quote · AI]\n“Answer”\n\n");
  });

  it("inserts a plain quote for a selection spanning authors", () => {
    const composer = mountComposer();
    const list = document.createElement("div");
    list.innerHTML = `<div data-virtual-list-item-key="1"><div class="ds-collapsible-text">Question</div></div>
      <div data-virtual-list-item-key="2"><div class="ds-assistant-message-main-content">Answer</div></div>`;
    document.body.appendChild(list);
    const selection = selectText(list);
    const text = selection.toString().trim();
    showPopup();
    expect(getPopup().textContent).toContain(`Selected: ${text}`);
    getButton().click();
    expect(composer.value).toBe(`“${text}”\n\n`);
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
