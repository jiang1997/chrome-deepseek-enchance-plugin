import { describe, expect, it } from "vitest";
import { selectedWebUrl } from "../src/core/url";

describe("selectedWebUrl", () => {
  it.each([
    ["https://example.com/path?q=hello#part", "https://example.com/path?q=hello#part"],
    ["  http://example.com  ", "http://example.com/"],
    ["www.example.com/path", "https://www.example.com/path"],
    ["HTTPS://EXAMPLE.COM", "https://example.com/"],
    ["https://例子.中国/页面", new URL("https://例子.中国/页面").href],
  ])("recognizes %s", (text, expected) => {
    expect(selectedWebUrl(text)).toBe(expected);
  });

  it.each([
    "",
    "ordinary text",
    "See https://example.com",
    "https://example.com and more",
    "https://example.com\nhttps://other.com",
    "javascript:alert(1)",
    "data:text/html,hello",
    "ftp://example.com",
    "/relative/path",
    "https://",
    "https:/example.com",
    "https://example.com:invalid",
    "https://user:password@example.com",
    "https://example.com\\path",
    "<https://example.com>",
    "www.",
    "www.example",
  ])("rejects %s", (text) => {
    expect(selectedWebUrl(text)).toBeNull();
  });
});
