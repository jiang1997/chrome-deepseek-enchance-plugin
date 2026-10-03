/**
 * Resolve who wrote a selected message and its ordinal, from DeepSeek's conversation DOM.
 *
 * Signals used (verified against the live page):
 * - Every rendered message item carries `data-virtual-list-item-key`, a message ID
 *   used for DOM identity. IDs are not positions and may skip or change order.
 * - The visible-items window exposes its offset via `--dsl-virtual-list-transform-y`.
 *   Only a zero offset establishes that counting starts at the first message.
 * - Assistant messages contain `.ds-assistant-message-main-content` (and, while
 *   thinking, `.ds-think-content` / `.ds-markdown`).
 * - User messages contain `.ds-collapsible-text`.
 *
 * Missing role hooks leave the quote unlabelled. Missing window metadata or an
 * unmounted prefix leaves only the role label, without guessing an ordinal.
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
const VISIBLE_ITEMS_SELECTOR = ".ds-virtual-list-visible-items";
const WINDOW_OFFSET_PROPERTY = "--dsl-virtual-list-transform-y";

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

/**
 * Classify a message item by the semantic class names of its content.
 * Assistant is tested first because its markers are the most specific.
 */
export function classifyMessageRole(item: Element): MessageRole {
  if (item.querySelector(ASSISTANT_CONTENT_SELECTOR)) return "assistant";
  if (item.querySelector(USER_CONTENT_SELECTOR)) return "user";
  return "unknown";
}

/**
 * Count in DOM order only when the virtual list explicitly renders from its start.
 * Message IDs cannot establish the starting point, order, or number of missing items.
 */
function countRoleFromStart(item: Element, role: MessageRole): Pick<MessageContext, "index" | "position"> {
  const unavailable = { index: null, position: null };
  const renderedWindow = item.closest<HTMLElement>(VISIBLE_ITEMS_SELECTOR);
  if (!renderedWindow?.closest(MESSAGE_LIST_SELECTOR)) return unavailable;
  if (renderedWindow.style.getPropertyValue(WINDOW_OFFSET_PROPERTY).trim() !== "0px") return unavailable;

  let index = 0;
  let position = 0;
  for (const el of Array.from(renderedWindow.children)) {
    if (!el.hasAttribute(MESSAGE_ITEM_ATTR)) return unavailable;
    const itemRole = classifyMessageRole(el);
    if (itemRole === "unknown") return unavailable;
    position += 1;
    if (itemRole === role) index += 1;
    if (el === item) return { index, position };
  }
  return unavailable;
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
  if (role === "unknown") return { role, index: null, position: null };
  return { role, ...countRoleFromStart(item, role) };
}
