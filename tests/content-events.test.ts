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
  vi.useRealTimers();
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
    window.getSelection()!.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    raf.flush();
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

  it("retains the quote after clearing the selection and editing the draft", () => {
    const composer = mountComposer();
    mountSelection();
    showPopup();
    expect(getPopup().style.display).toBe("flex");

    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    window.getSelection()!.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    document.dispatchEvent(new Event("pointerup", { bubbles: true }));
    raf.flush();
    composer.focus();
    composer.value = "My follow-up";
    expect(getPopup().style.display).toBe("flex");
    expect(getPopup().textContent).toContain("Selected sentence.");
    getButton().click();
    expect(composer.value).toBe("My follow-up\n“Selected sentence.”\n\n");
  });

  it("dismisses with × without reopening the unchanged selection", () => {
    const composer = mountComposer("draft");
    mountSelection();
    showPopup();
    document.querySelector<HTMLButtonElement>(".dse-popup-close")!.click();
    expect(getPopup().style.display).toBe("none");
    document.dispatchEvent(new Event("selectionchange"));
    showPopup();
    expect(getPopup().style.display).toBe("none");
    expect(composer.value).toBe("draft");
    mountSelection("New selection.");
    showPopup();
    expect(getPopup().textContent).toContain("New selection.");
    expect(getPopup().style.display).toBe("flex");
  });

  it("ignores editable selections and retains the saved source", () => {
    const composer = mountComposer();
    mountSelection("Original response.");
    showPopup();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "Draft text";
    document.body.appendChild(editable);
    selectText(editable);
    showPopup();
    expect(getPopup().textContent).toContain("Original response.");
    getButton().click();
    expect(composer.value).toBe("“Original response.”\n\n");
  });

  it("reports an overlong selection without replacing the pending quote", () => {
    const composer = mountComposer();
    mountSelection("Original response.");
    showPopup();
    mountSelection("x".repeat(5001));
    showPopup();
    expect(getPopup().textContent).toContain("Original response.");
    expect(getPopup().textContent).toContain("Up to 5000 characters");
    expect(getButton().disabled).toBe(false);
    getButton().click();
    expect(composer.value).toBe("“Original response.”\n\n");
  });

  it("keeps the preview after temporary feedback expires", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mountComposer();
    mountSelection("Original response.");
    showPopup();
    mountSelection("x".repeat(5001));
    showPopup();
    vi.advanceTimersByTime(1600);
    expect(document.querySelector<HTMLElement>(".dse-popup-notice")!.hidden).toBe(true);
    expect(getPopup().style.display).toBe("flex");
    expect(getPopup().textContent).toContain("Original response.");
    expect(getButton().disabled).toBe(false);
  });

  it("dismisses immediately through the Navigation API and removes its listener on teardown", () => {
    content!.destroy();
    const navigation = new EventTarget();
    vi.stubGlobal("navigation", navigation);
    const remove = vi.spyOn(navigation, "removeEventListener");
    content!.init();
    mountComposer();
    mountSelection();
    showPopup();
    const previousUrl = window.location.href;
    try {
      window.history.pushState(null, "", "/a/chat/s/another-conversation");
      navigation.dispatchEvent(new Event("currententrychange"));
      expect(getPopup().style.display).toBe("none");
      content!.destroy();
      expect(remove).toHaveBeenCalledWith("currententrychange", expect.any(Function));
    } finally {
      window.history.replaceState(null, "", previousUrl);
    }
  });

  it("restores the popup after the composer returns to the viewport", () => {
    const composer = mountComposer();
    mountSelection();
    showPopup();
    stubRect(composer, { top: 900, bottom: 1000 });
    window.dispatchEvent(new Event("scroll"));
    expect(getPopup().style.display).toBe("none");
    window.getSelection()!.removeAllRanges();
    stubRect(composer);
    window.dispatchEvent(new Event("scroll"));
    expect(getPopup().style.display).toBe("flex");
    getButton().click();
    expect(composer.value).toBe("“Selected sentence.”\n\n");
  });

  it("allows Escape to discard a temporarily hidden quote", () => {
    const composer = mountComposer();
    mountSelection();
    showPopup();
    stubRect(composer, { top: 900, bottom: 1000 });
    window.dispatchEvent(new Event("scroll"));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape" }));
    stubRect(composer);
    window.dispatchEvent(new Event("scroll"));
    expect(getPopup().style.display).toBe("none");
  });

  it("retains pending content when switching tabs", () => {
    const composer = mountComposer();
    mountSelection();
    showPopup();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(getPopup().style.display).toBe("none");
    window.getSelection()!.removeAllRanges();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(getPopup().style.display).toBe("flex");
    getButton().click();
    expect(composer.value).toBe("“Selected sentence.”\n\n");
  });

  it("restores pending content when the composer is replaced in the same chat", async () => {
    const composer = mountComposer();
    mountSelection();
    showPopup();
    window.getSelection()!.removeAllRanges();
    composer.remove();
    window.dispatchEvent(new Event("scroll"));
    expect(getPopup().style.display).toBe("none");
    const replacement = mountComposer("new draft");
    await Promise.resolve();
    raf.flush();
    expect(getPopup().style.display).toBe("flex");
    getButton().click();
    expect(replacement.value).toBe("new draft\n“Selected sentence.”\n\n");
  });

  it("restores the new preview if selection changes while the composer is absent", async () => {
    const composer = mountComposer();
    mountSelection("First selection.");
    showPopup();
    composer.remove();
    window.dispatchEvent(new Event("scroll"));
    mountSelection("Second selection.");
    showPopup();
    expect(getPopup().style.display).toBe("none");
    const replacement = mountComposer();
    await Promise.resolve();
    raf.flush();
    expect(getPopup().style.display).toBe("flex");
    expect(getPopup().textContent).toContain("Second selection.");
    getButton().click();
    expect(replacement.value).toBe("“Second selection.”\n\n");
  });

  it("clears pending content on pagehide", () => {
    mountComposer();
    mountSelection();
    showPopup();
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("scroll"));
    expect(getPopup().style.display).toBe("none");
  });

  it("keeps pending content when an in-page anchor changes", () => {
    mountComposer();
    mountSelection();
    showPopup();
    const previousUrl = window.location.href;
    try {
      window.history.replaceState(null, "", `${window.location.pathname}#section`);
      window.dispatchEvent(new Event("hashchange"));
      expect(getPopup().style.display).toBe("flex");
      expect(getPopup().textContent).toContain("Selected sentence.");
    } finally {
      window.history.replaceState(null, "", previousUrl);
    }
  });

  it("clears pending content on SPA navigation even without a popstate event", async () => {
    mountComposer();
    mountSelection();
    showPopup();
    const previousUrl = window.location.href;
    try {
      window.history.pushState(null, "", "/a/chat/s/new-conversation");
      document.body.appendChild(document.createElement("div"));
      await Promise.resolve();
      raf.flush();
      expect(getPopup().style.display).toBe("none");
      showPopup();
      expect(getPopup().style.display).toBe("none");
    } finally {
      window.history.replaceState(null, "", previousUrl);
    }
  });
});
