/** Quote text formatting (pure functions). */

export const MAX_QUOTE_LENGTH = 5000;

export function formatQuote(rawText: string): string {
  const text = rawText.replace(/\r\n?/g, "\n").trim();
  return `“${text}”\n\n`;
}

/**
 * Splice a quote into the existing composer value (blank-splicing rules, see plan 5.4).
 * - Empty composer: insert the quote directly
 * - Text before the cursor not ending in a newline: prepend a newline
 * - Cursor in the middle: insert in place, without destroying the text after it
 * Returns the full spliced value and the new cursor position (on the blank line after the quote).
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
