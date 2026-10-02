import { describe, expect, it } from "vitest";
import { appendQuote, formatQuote, formatQuoteLabel } from "../src/core/quote";

describe("formatQuote", () => {
  it("wraps in smart quotes and appends a blank line", () => {
    expect(formatQuote("A closure keeps the lexical environment.")).toBe("“A closure keeps the lexical environment.”\n\n");
  });

  it("adds a provenance label for assistant replies", () => {
    expect(formatQuote("Use 16:10.", { role: "assistant", index: 1, position: 2 })).toBe(
      "[Quote · AI #1]\n“Use 16:10.”\n\n",
    );
  });

  it("adds a provenance label for the user's own messages", () => {
    expect(formatQuote("1280*800?", { role: "user", index: 2, position: 3 })).toBe(
      "[Quote · You #2]\n“1280*800?”\n\n",
    );
  });

  it("omits the label when the message role is unknown", () => {
    expect(formatQuote("text", { role: "unknown", index: null, position: null })).toBe("“text”\n\n");
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

describe("formatQuoteLabel", () => {
  it("is empty for missing or unknown context", () => {
    expect(formatQuoteLabel()).toBe("");
    expect(formatQuoteLabel({ role: "unknown", index: null, position: null })).toBe("");
  });

  it("falls back to a role-only label when the ordinal is unknown", () => {
    expect(formatQuoteLabel({ role: "assistant", index: null, position: null })).toBe("[Quote · AI]");
  });
});

describe("appendQuote", () => {
  const q = "“quote”\n\n";

  it("inserts directly into an empty composer", () => {
    expect(appendQuote("", q)).toEqual({ value: q, insertion: q });
  });

  it("prepends a newline when the draft does not end with one", () => {
    const r = appendQuote("existing draft", q);
    expect(r.value).toBe(`existing draft\n${q}`);
    expect(r.insertion).toBe(`\n${q}`);
  });

  it("does not prepend a newline when the draft already ends with one", () => {
    const r = appendQuote("draft\n", q);
    expect(r.value).toBe(`draft\n${q}`);
  });

  it("appending does not depend on the current cursor in the draft", () => {
    expect(appendQuote("abcd", q).value).toBe(`abcd\n${q}`);
  });
});
