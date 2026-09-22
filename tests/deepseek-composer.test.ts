import { describe, expect, it, beforeEach } from "vitest";
import {
  findComposer,
  insertIntoComposer,
  insertIntoContentEditable,
  insertIntoTextarea,
  scoreCandidate,
} from "../src/adapters/deepseek-composer";

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

  it("keeps the existing draft and inserts at the cursor in the middle", () => {
    document.body.innerHTML = `<textarea id="c">abcd</textarea>`;
    const ta = document.getElementById("c") as HTMLTextAreaElement;
    ta.setSelectionRange(2, 2);
    const quote = "“X”\n\n";
    insertIntoTextarea(ta, quote);
    expect(ta.value).toBe(`ab\n${quote}cd`);
  });

  it("replaces selected content (prepends a newline when before does not end in one)", () => {
    document.body.innerHTML = `<textarea id="c">hello world</textarea>`;
    const ta = document.getElementById("c") as HTMLTextAreaElement;
    ta.setSelectionRange(6, 11);
    insertIntoTextarea(ta, "“Q”\n\n");
    expect(ta.value).toBe("hello \n“Q”\n\n");
  });
});

describe("insertIntoContentEditable", () => {
  it("appends to an empty editor", () => {
    document.body.innerHTML = `<div id="e" contenteditable="true"></div>`;
    const ed = document.getElementById("e") as HTMLElement;
    rectStub(ed, {});
    const quote = "“quote”\n\n";
    expect(insertIntoContentEditable(ed, quote)).toBe(true);
    expect(ed.textContent).toBe(quote);
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
