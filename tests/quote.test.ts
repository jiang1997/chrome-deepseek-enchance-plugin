import { describe, expect, it } from "vitest";
import { appendQuote, formatQuote } from "../src/core/quote";

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

describe("appendQuote", () => {
  const q = "“引用”\n\n";

  it("空输入框直接插入", () => {
    expect(appendQuote("", q)).toEqual({ value: q, insertion: q });
  });

  it("草稿末尾无换行时补换行", () => {
    const r = appendQuote("已有草稿", q);
    expect(r.value).toBe(`已有草稿\n${q}`);
    expect(r.insertion).toBe(`\n${q}`);
  });

  it("草稿末尾已有换行时不补", () => {
    const r = appendQuote("草稿\n", q);
    expect(r.value).toBe(`草稿\n${q}`);
  });

  it("追加操作不依赖草稿当前光标", () => {
    expect(appendQuote("abcd", q).value).toBe(`abcd\n${q}`);
  });
});
