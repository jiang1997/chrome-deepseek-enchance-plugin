/** 引用文本格式化（纯函数）。 */

export const MAX_QUOTE_LENGTH = 5000;

export function formatQuote(rawText: string): string {
  const text = rawText.replace(/\r\n?/g, "\n").trim();
  return `“${text}”\n\n`;
}

/** 在现有草稿末尾追加引用，必要时先换行。 */
export function appendQuote(value: string, quote: string): { value: string; insertion: string } {
  const insertion = (value.length > 0 && !value.endsWith("\n") ? "\n" : "") + quote;
  return { value: value + insertion, insertion };
}
