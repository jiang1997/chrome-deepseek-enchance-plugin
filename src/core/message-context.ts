/**
 * Resolve who wrote a selected message and its ordinal, from DeepSeek's conversation DOM.
 *
 * Signals used (verified against the live page):
 * - Every rendered message item carries `data-virtual-list-item-key` (a sequential,
 *   1-based position in the conversation). This is a data attribute from DeepSeek's
 *   virtual-list library, so it survives CSS-module hash churn.
 * - Assistant messages contain `.ds-assistant-message-main-content` (and, while
 *   thinking, `.ds-think-content` / `.ds-markdown`).
 * - User messages contain `.ds-collapsible-text`.
 *
 * All of these are semantic hooks; if DeepSeek changes them the resolver degrades to
 * `unknown` and the quote is left unlabelled rather than mislabelled.
 */

export type MessageRole = "assistant" | "user" | "unknown";

export type MessageContext = {
  role: MessageRole;
  /** 1-based ordinal among messages of the same role; null when it cannot be resolved. */
  index: number | null;
  /** 1-based absolute position in the conversation; null when unavailable. */
  position: number | null;
};

/** Data attribute the virtual list puts on every rendered message item. */
export const MESSAGE_ITEM_ATTR = "data-virtual-list-item-key";
/** Container that holds all rendered message items. */
export const MESSAGE_LIST_SELECTOR = ".ds-virtual-list-items";

const ASSISTANT_CONTENT_SELECTOR =
  ".ds-assistant-message-main-content, .ds-think-content, .ds-markdown";
const USER_CONTENT_SELECTOR = ".ds-collapsible-text";

function closestElement(node: Node | null): Element | null {
  if (!node) return null;
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  return (node as ChildNode).parentElement ?? null;
}

/** Nearest message item wrapping the node, or null when the node is not in a message. */
export function findMessageItem(node: Node | null): HTMLElement | null {
  const el = closestElement(node);
  if (!el) return null;
  return el.closest<HTMLElement>(`[${MESSAGE_ITEM_ATTR}]`);
}

/** Absolute 1-based position from the virtual-list key. */
export function readMessagePosition(item: Element): number | null {
  const raw = item.getAttribute(MESSAGE_ITEM_ATTR);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Classify a message item by the semantic class names of its content.
 * Assistant is tested first because its markers are the most specific.
 */
export function classifyMessageRole(item: Element): MessageRole {
  if (item.querySelector(ASSISTANT_CONTENT_SELECTOR)) return "assistant";
  if (item.querySelector(USER_CONTENT_SELECTOR)) return "user";
  return "unknown";
}

type RoleCount = { index: number; fromStart: boolean };

/**
 * Count same-role items at or before `position`.
 * `fromStart` reports whether the rendered window begins at the first message,
 * in which case the count is exact even for long conversations.
 */
function countRoleUpTo(item: Element, role: MessageRole, position: number): RoleCount {
  const list = item.closest(MESSAGE_LIST_SELECTOR);
  if (!list) return { index: 0, fromStart: false };
  let index = 0;
  let minPosition = Number.POSITIVE_INFINITY;
  for (const el of Array.from(list.querySelectorAll<HTMLElement>(`[${MESSAGE_ITEM_ATTR}]`))) {
    const pos = readMessagePosition(el);
    if (pos === null) continue;
    if (pos < minPosition) minPosition = pos;
    if (pos <= position && classifyMessageRole(el) === role) index += 1;
  }
  return { index, fromStart: minPosition <= 1 };
}

/** Short badge for UI, e.g. `AI #2` / `You #1`; empty when unknown. */
export function describeMessageContext(context?: MessageContext | null): string {
  if (!context || context.role === "unknown") return "";
  const who = context.role === "assistant" ? "AI" : "You";
  return context.index ? `${who} #${context.index}` : who;
}

/**
 * Resolve role + ordinal for the message containing `node`.
 * Never throws and never guesses a role: unknown nodes yield `unknown`.
 */
export function resolveMessageContext(node: Node | null): MessageContext {
  const item = findMessageItem(node);
  if (!item) return { role: "unknown", index: null, position: null };

  const role = classifyMessageRole(item);
  const position = readMessagePosition(item);
  if (role === "unknown" || position === null) {
    return { role, index: null, position };
  }

  const { index, fromStart } = countRoleUpTo(item, role, position);
  if (fromStart) return { role, index, position };

  // Long conversations virtualize the list, so earlier items may be unmounted.
  // Keys are sequential and DeepSeek turns alternate user/assistant starting with
  // the user, so derive the ordinal from the absolute position as a best effort.
  const derived = role === "user" ? Math.ceil(position / 2) : Math.floor(position / 2);
  return { role, index: derived || null, position };
}
