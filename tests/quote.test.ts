import { describe, expect, it } from "vitest";
import { formatQuote, spliceQuote } from "../src/core/quote";

describe("formatQuote", () => {
  it("wraps in smart quotes and appends a blank line", () => {
    expect(formatQuote("A closure keeps the lexical environment.")).toBe("“A closure keeps the lexical environment.”\n\n");
  });

  it("trims surrounding whitespace and keeps inner newlines", () => {
    expect(formatQuote("  first line\nsecond line\n\n")).toBe("“first line\nsecond line”\n\n");
  });

  it("normalizes CRLF / CR to LF", () => {
    expect(formatQuote("a\r\nb\rc")).toBe("“a\nb\nc”\n\n");
  });

  it("keeps English and code characters as-is", () => {
    expect(formatQuote("const x = `a${1}`;")).toBe("“const x = `a${1}`;”\n\n");
  });
});

describe("spliceQuote", () => {
  const q = "“quote”\n\n";

  it("inserts directly into an empty composer", () => {
    expect(spliceQuote("", 0, 0, q)).toEqual({ value: q, cursor: q.length });
  });

  it("prepends a newline when text before the cursor has no newline", () => {
    const r = spliceQuote("existing draft", 14, 14, q);
    expect(r.value).toBe(`existing draft\n${q}`);
    expect(r.cursor).toBe(r.value.length);
  });

  it("does not prepend a newline when one already exists", () => {
    const r = spliceQuote("hi\n", 3, 3, q);
    expect(r.value).toBe(`hi\n${q}`);
  });

  it("inserting in the middle does not destroy the following text", () => {
    const r = spliceQuote("abcd", 2, 2, q);
    expect(r.value).toBe(`ab\n${q}cd`);
    expect(r.cursor).toBe(`ab\n${q}`.length);
  });

  it("replaces selected content (prepends a newline when before does not end in one)", () => {
    const r = spliceQuote("hello world", 6, 11, q);
    expect(r.value).toBe(`hello \n${q}`);
  });
});
