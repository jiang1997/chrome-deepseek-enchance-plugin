/** Quote text formatting (pure function). */

export const MAX_QUOTE_LENGTH = 5000;

export function formatQuote(rawText: string): string {
  const text = rawText.replace(/\r\n?/g, "\n").trim();
  return `“${text}”\n\n`;
}

/** Append a quote to the end of the existing draft, adding a newline first if needed. */
export function appendQuote(value: string, quote: string): { value: string; insertion: string } {
  const insertion = (value.length > 0 && !value.endsWith("\n") ? "\n" : "") + quote;
  return { value: value + insertion, insertion };
}
