import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";
import {
  findComposer,
  findComposerWithRetry,
  insertIntoComposer,
  insertIntoContentEditable,
  insertIntoTextarea,
  isComposerEditable,
  scoreCandidate,
} from "../src/adapters/deepseek-composer";

afterEach(() => {
  vi.unstubAllGlobals();
});

function rectStub(el: Element, rect: Partial<DOMRect>) {
  el.getBoundingClientRect = () =>
    ({
      top: 600, left: 100, bottom: 700, right: 900, width: 800, height: 100, x: 100, y: 600,
      ...rect,
    }) as DOMRect;
}

beforeEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(window, "innerWidth", { value: 1280, writable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, writable: true });
});

describe("findComposer", () => {
  it("excludes hidden elements and the sidebar search box, selects the main composer", () => {
    document.body.innerHTML = `
      <aside><input id="search" role="textbox" value="Search" /></aside>
      <main><div id="msg">Answer</div></main>
      <textarea id="hidden" style="display:none"></textarea>
      <textarea id="composer" aria-label="Send message" placeholder="Type a message"></textarea>
    `;
    const composer = document.getElementById("composer") as HTMLTextAreaElement;
    const hidden = document.getElementById("hidden")!;
    const search = document.getElementById("search")!;
    rectStub(composer, {});
    rectStub(hidden, {});
    rectStub(search, { top: 10, bottom: 40, y: 10, height: 30 });
    expect(findComposer()).toBe(composer);
  });

  it("returns null when there is no reliable candidate", () => {
    document.body.innerHTML = `<div>plain text</div>`;
    expect(findComposer()).toBeNull();
  });

  it("big bonus when focused", () => {
    document.body.innerHTML = `<textarea id="a"></textarea><textarea id="b"></textarea>`;
    const a = document.getElementById("a")!;
    const b = document.getElementById("b")!;
    rectStub(a, {});
    rectStub(b, {});
    const vp = { width: 1280, height: 800 };
    expect(scoreCandidate(b, vp, b)).toBeGreaterThan(scoreCandidate(a, vp, null));
  });

  it("does not treat a plain role=textbox input as contenteditable", () => {
    document.body.innerHTML = `<input role="textbox" id="search" />`;
    rectStub(document.getElementById("search")!, {});
    expect(findComposer()).toBeNull();
  });
});

describe("insertIntoTextarea", () => {
  it("inserts into empty content, dispatches an input event, cursor at the end", () => {
    document.body.innerHTML = `<textarea id="c"></textarea>`;
    const ta = document.getElementById("c") as HTMLTextAreaElement;
    rectStub(ta, {});
    let fired = 0;
    ta.addEventListener("input", () => fired++);
    const quote = "“quote”\n\n";
    expect(insertIntoTextarea(ta, quote)).toBe(true);
    expect(ta.value).toBe(quote);
    expect(fired).toBeGreaterThanOrEqual(1);
    expect(ta.selectionStart).toBe(quote.length);
  });

  it("keeps the existing draft and appends to the end even when the cursor is in the middle", () => {
    document.body.innerHTML = `<textarea id="c">abcd</textarea>`;
    const ta = document.getElementById("c") as HTMLTextAreaElement;
    ta.setSelectionRange(2, 2);
    const quote = "“X”\n\n";
    insertIntoTextarea(ta, quote);
    expect(ta.value).toBe(`abcd\n${quote}`);
    expect(ta.selectionStart).toBe(ta.value.length);
  });

  it("does not replace a selected draft inside the composer", () => {
    document.body.innerHTML = `<textarea id="c">hello world</textarea>`;
    const ta = document.getElementById("c") as HTMLTextAreaElement;
    ta.setSelectionRange(6, 11);
    insertIntoTextarea(ta, "“Q”\n\n");
    expect(ta.value).toBe("hello world\n“Q”\n\n");
  });
});

describe("insertIntoContentEditable", () => {
  it("keeps existing content and appends to the end of the editor", () => {
    document.body.innerHTML = `<div id="e" contenteditable="true">draft</div>`;
    const ed = document.getElementById("e") as HTMLElement;
    rectStub(ed, {});
    const quote = "“quote”\n\n";
    expect(insertIntoContentEditable(ed, quote)).toBe(true);
    expect(ed.textContent).toBe(`draft\n${quote}`);
  });
});

describe("insertIntoComposer", () => {
  it("dispatches to the textarea branch automatically", () => {
    document.body.innerHTML = `<textarea id="c"></textarea>`;
    const ta = document.getElementById("c") as HTMLTextAreaElement;
    expect(insertIntoComposer(ta, "“A”\n\n")).toBe(true);
    expect(ta.value).toBe("“A”\n\n");
  });
});

describe("isComposerEditable", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <textarea id="ta"></textarea>
      <div id="on" contenteditable="true"></div>
      <div id="off" contenteditable="false"></div>
      <div id="aria" contenteditable="true" aria-disabled="true"></div>
    `;
  });

  it("accepts a connected, enabled textarea", () => {
    expect(isComposerEditable(document.getElementById("ta"))).toBe(true);
  });

  it("rejects disabled and read-only textareas", () => {
    const disabled = document.getElementById("ta") as HTMLTextAreaElement;
    disabled.disabled = true;
    const readOnly = document.createElement("textarea");
    readOnly.readOnly = true;
    document.body.appendChild(readOnly);
    expect(isComposerEditable(disabled)).toBe(false);
    expect(isComposerEditable(readOnly)).toBe(false);
  });

  it("rejects detached elements and null", () => {
    const ta = document.getElementById("ta") as HTMLTextAreaElement;
    ta.remove();
    expect(isComposerEditable(ta)).toBe(false);
    expect(isComposerEditable(null)).toBe(false);
  });

  it("accepts contenteditable and rejects contenteditable=false / aria-disabled", () => {
    expect(isComposerEditable(document.getElementById("on"))).toBe(true);
    expect(isComposerEditable(document.getElementById("off"))).toBe(false);
    expect(isComposerEditable(document.getElementById("aria"))).toBe(false);
  });
});

describe("findComposerWithRetry", () => {
  it("resolves null immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);

    await expect(findComposerWithRetry(300, controller.signal)).resolves.toBeNull();
    expect(raf).not.toHaveBeenCalled();
  });

  it("stops waiting as soon as the signal aborts", async () => {
    document.body.innerHTML = `<div>plain text</div>`;
    const controller = new AbortController();
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const pending = findComposerWithRetry(1000, controller.signal);
    controller.abort();

    await expect(pending).resolves.toBeNull();
  });

  it("finds the composer without waiting when it is already present", async () => {
    document.body.innerHTML = `<textarea id="c" aria-label="Send" placeholder="Type"></textarea>`;
    const ta = document.getElementById("c") as HTMLTextAreaElement;
    rectStub(ta, {});
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);

    await expect(findComposerWithRetry(300)).resolves.toBe(ta);
    expect(raf).not.toHaveBeenCalled();
  });
});
