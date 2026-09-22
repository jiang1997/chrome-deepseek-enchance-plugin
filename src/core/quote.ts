/** 引用文本格式化（纯函数）。 */

export const MAX_QUOTE_LENGTH = 5000;

export function formatQuote(rawText: string): string {
  const text = rawText.replace(/\r\n?/g, "\n").trim();
  return `“${text}”\n\n`;
}

/**
 * 将 quote 拼接到已有输入值中（处理空白拼接规则，见方案 5.4）。
 * - 输入框为空：直接插入 quote
 * - 光标前有文字且末尾不是换行：在引用前补一个换行
 * - 光标在中间：原地插入，不破坏其后文本
 * 返回拼接后的完整值与新的光标位置（位于引用后的空行）。
 */
export function spliceQuote(
  value: string,
  start: number,
  end: number,
  quote: string,
): { value: string; cursor: number } {
  const safeStart = Math.max(0, Math.min(start, value.length));
  const safeEnd = Math.max(safeStart, Math.min(end, value.length));
  const before = value.slice(0, safeStart);
  const after = value.slice(safeEnd);
  const needsLeadingNewline = before.length > 0 && !before.endsWith("\n");
  const insertion = (needsLeadingNewline ? "\n" : "") + quote;
  const nextValue = before + insertion + after;
  return { value: nextValue, cursor: before.length + insertion.length };
}
