import { describe, expect, it } from "vitest";
import { formatQuote, spliceQuote } from "../src/core/quote";

describe("formatQuote", () => {
  it("包裹中文引号并追加空行", () => {
    expect(formatQuote("闭包会保存创建它时的词法环境。")).toBe("“闭包会保存创建它时的词法环境。”\n\n");
  });

  it("去除首尾空白、保留段落内换行", () => {
    expect(formatQuote("  第一行\n第二行\n\n")).toBe("“第一行\n第二行”\n\n");
  });

  it("统一 CRLF / CR 为 LF", () => {
    expect(formatQuote("a\r\nb\rc")).toBe("“a\nb\nc”\n\n");
  });

  it("英文与代码字符原样保留", () => {
    expect(formatQuote("const x = `a${1}`;")).toBe("“const x = `a${1}`;”\n\n");
  });
});

describe("spliceQuote", () => {
  const q = "“引用”\n\n";

  it("空输入框直接插入", () => {
    expect(spliceQuote("", 0, 0, q)).toEqual({ value: q, cursor: q.length });
  });

  it("光标前有文字且无换行时补换行", () => {
    const r = spliceQuote("已有草稿", 4, 4, q);
    expect(r.value).toBe(`已有草稿\n${q}`);
    expect(r.cursor).toBe(r.value.length);
  });

  it("光标前已有换行时不补", () => {
    const r = spliceQuote("草稿\n", 3, 3, q);
    expect(r.value).toBe(`草稿\n${q}`);
  });

  it("光标在中间不破坏其后文本", () => {
    const r = spliceQuote("ab|cd".replace("|", ""), 2, 2, q);
    expect(r.value).toBe(`ab\n${q}cd`);
    expect(r.cursor).toBe(`ab\n${q}`.length);
  });

  it("替换选中内容（before 非换行结尾则补换行）", () => {
    const r = spliceQuote("hello world", 6, 11, q);
    expect(r.value).toBe(`hello \n${q}`);
  });
});
