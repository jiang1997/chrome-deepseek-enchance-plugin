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
  it("排除隐藏元素与侧栏搜索框，选择主输入框", () => {
    document.body.innerHTML = `
      <aside><input id="search" role="textbox" value="搜索" /></aside>
      <main><div id="msg">回答</div></main>
      <textarea id="hidden" style="display:none"></textarea>
      <textarea id="composer" aria-label="发送消息" placeholder="输入消息"></textarea>
    `;
    const composer = document.getElementById("composer") as HTMLTextAreaElement;
    const hidden = document.getElementById("hidden")!;
    const search = document.getElementById("search")!;
    rectStub(composer, {});
    rectStub(hidden, {});
    rectStub(search, { top: 10, bottom: 40, y: 10, height: 30 });
    expect(findComposer()).toBe(composer);
  });

  it("无可靠候选时返回 null", () => {
    document.body.innerHTML = `<div>纯文本</div>`;
    expect(findComposer()).toBeNull();
  });

  it("已聚焦大幅加分", () => {
    document.body.innerHTML = `<textarea id="a"></textarea><textarea id="b"></textarea>`;
    const a = document.getElementById("a")!;
    const b = document.getElementById("b")!;
    rectStub(a, {});
    rectStub(b, {});
    const vp = { width: 1280, height: 800 };
    expect(scoreCandidate(b, vp, b)).toBeGreaterThan(scoreCandidate(a, vp, null));
  });

  it("不把普通 role=textbox 的 input 当作 contenteditable", () => {
    document.body.innerHTML = `<input role="textbox" id="search" />`;
    rectStub(document.getElementById("search")!, {});
    expect(findComposer()).toBeNull();
  });
});

describe("insertIntoTextarea", () => {
  it("空内容插入并派发 input 事件、光标在末尾", () => {
    document.body.innerHTML = `<textarea id="c"></textarea>`;
    const ta = document.getElementById("c") as HTMLTextAreaElement;
    rectStub(ta, {});
    let fired = 0;
    ta.addEventListener("input", () => fired++);
    const quote = "“引用”\n\n";
    expect(insertIntoTextarea(ta, quote)).toBe(true);
    expect(ta.value).toBe(quote);
    expect(fired).toBeGreaterThanOrEqual(1);
    expect(ta.selectionStart).toBe(quote.length);
  });

  it("已有草稿不丢失，即使光标在中间也追加到末尾", () => {
    document.body.innerHTML = `<textarea id="c">abcd</textarea>`;
    const ta = document.getElementById("c") as HTMLTextAreaElement;
    ta.setSelectionRange(2, 2);
    const quote = "“X”\n\n";
    insertIntoTextarea(ta, quote);
    expect(ta.value).toBe(`abcd\n${quote}`);
    expect(ta.selectionStart).toBe(ta.value.length);
  });

  it("不会替换输入框内已选中的草稿", () => {
    document.body.innerHTML = `<textarea id="c">hello world</textarea>`;
    const ta = document.getElementById("c") as HTMLTextAreaElement;
    ta.setSelectionRange(6, 11);
    insertIntoTextarea(ta, "“Q”\n\n");
    expect(ta.value).toBe("hello world\n“Q”\n\n");
  });
});

describe("insertIntoContentEditable", () => {
  it("保留已有内容并追加到编辑器末尾", () => {
    document.body.innerHTML = `<div id="e" contenteditable="true">draft</div>`;
    const ed = document.getElementById("e") as HTMLElement;
    rectStub(ed, {});
    const quote = "“引用”\n\n";
    expect(insertIntoContentEditable(ed, quote)).toBe(true);
    expect(ed.textContent).toBe(`draft\n${quote}`);
  });
});

describe("insertIntoComposer", () => {
  it("自动分发 textarea 分支", () => {
    document.body.innerHTML = `<textarea id="c"></textarea>`;
    const ta = document.getElementById("c") as HTMLTextAreaElement;
    expect(insertIntoComposer(ta, "“A”\n\n")).toBe(true);
    expect(ta.value).toBe("“A”\n\n");
  });
});
