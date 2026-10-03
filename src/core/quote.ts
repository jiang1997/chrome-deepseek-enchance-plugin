/** Quote text formatting (pure functions). */
import { describeMessageContext, type MessageContext } from "./message-context";

export const MAX_QUOTE_LENGTH = 5000;

/** Human-readable provenance label, e.g. `[Quote · AI #2]`; empty when unknown. */
export function formatQuoteLabel(context?: MessageContext | null): string {
  const badge = describeMessageContext(context);
  return badge ? `[Quote · ${badge}]` : "";
}

export function formatQuote(rawText: string, context?: MessageContext | null): string {
  const text = rawText.replace(/\r\n?/g, "\n").trim();
  const label = formatQuoteLabel(context);
  const quoted = `“${text}”`;
  return label ? `${label}\n${quoted}\n\n` : `${quoted}\n\n`;
}

/** Append a quote to the end of the existing draft, adding a newline first if needed. */
export function appendQuote(value: string, quote: string): { value: string; insertion: string } {
  const insertion = (value.length > 0 && !value.endsWith("\n") ? "\n" : "") + quote;
  return { value: value + insertion, insertion };
}
