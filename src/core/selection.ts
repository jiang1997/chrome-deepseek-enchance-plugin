/** Selection validation and snapshot (pure logic + thin DOM adapter). */
import { resolveMessageContext, type MessageContext } from "./message-context";

export const MAX_SELECTION_LENGTH = 5000;

export type RectLike = {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
  x: number;
  y: number;
};

export type SelectionSnapshot = {
  text: string;
  rect: RectLike;
  /** Provenance of the message the selection lives in (role + ordinal). */
  context: MessageContext;
};

export type SelectionRejectReason =
  | "empty"
  | "collapsed"
  | "blank"
  | "too-long"
  | "in-editable"
  | "in-popup"
  | "in-excluded-ui"
  | "no-rect";

const POPUP_ATTR = "data-dse-popup";

function toRectLike(r: DOMRect | RectLike): RectLike {
  return {
    top: r.top,
    left: r.left,
    bottom: r.bottom,
    right: r.right,
    width: r.width,
    height: r.height,
    x: (r as DOMRect).x ?? r.left,
    y: (r as DOMRect).y ?? r.top,
  };
}

export function cleanSelectionText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").trim();
}

export function isValidRect(rect: RectLike): boolean {
  if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return false;
  if (rect.width <= 0 || rect.height <= 0) return false;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Fully outside the viewport counts as invisible
  if (rect.right < 0 || rect.left > vw || rect.bottom < 0 || rect.top > vh) return false;
  return true;
}

function closestElement(node: Node | null): Element | null {
  if (!node) return null;
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  return (node as ChildNode).parentElement ?? null;
}

/** Whether the node is inside an editable element (composer selections should not show the quote button). */
export function isInEditable(node: Node | null): boolean {
  const el = closestElement(node);
  if (!el) return false;
  return !!el.closest('textarea, input, [contenteditable="true"], [role="textbox"]');
}

/** Whether the node is inside the extension's own popup. */
export function isInPopup(node: Node | null): boolean {
  const el = closestElement(node);
  if (!el) return false;
  return !!el.closest(`[${POPUP_ATTR}]`);
}

/** Whether the node is inside UI that should be excluded (sidebar / search / dialog). */
export function isInExcludedUI(node: Node | null): boolean {
  const el = closestElement(node);
  if (!el) return false;
  return !!el.closest("aside, nav, header, [role='search'], [role='dialog'], [role='menu']");
}

export type ValidateResult =
  | { ok: true; snapshot: SelectionSnapshot }
  | { ok: false; reason: SelectionRejectReason };

/**
 * Validate the current Selection and return an immutable snapshot on success (text + viewport rect).
 * Note: callers should invoke this after rAF / event settling to avoid reading a stale selection.
 */
export function validateSelection(sel: Selection | null): ValidateResult {
  if (!sel || sel.rangeCount === 0) return { ok: false, reason: "empty" };
  const range = sel.getRangeAt(0);
  if (sel.isCollapsed || range.collapsed) return { ok: false, reason: "collapsed" };

  const rawText = sel.toString();
  const text = cleanSelectionText(rawText);
  if (!text) return { ok: false, reason: "blank" };
  if (text.length > MAX_SELECTION_LENGTH) return { ok: false, reason: "too-long" };

  const anchorNode = sel.anchorNode ?? range.commonAncestorContainer;
  if (isInPopup(anchorNode) || isInPopup(range.commonAncestorContainer)) {
    return { ok: false, reason: "in-popup" };
  }
  if (isInEditable(anchorNode) || isInEditable(range.commonAncestorContainer)) {
    return { ok: false, reason: "in-editable" };
  }
  if (isInExcludedUI(anchorNode) || isInExcludedUI(range.commonAncestorContainer)) {
    return { ok: false, reason: "in-excluded-ui" };
  }

  let rect: RectLike;
  try {
    rect = toRectLike(range.getBoundingClientRect());
  } catch {
    return { ok: false, reason: "no-rect" };
  }
  if (!isValidRect(rect)) return { ok: false, reason: "no-rect" };

  // Only label text contained in one message, independently of drag direction.
  // Multiple ranges or a common ancestor outside a message have no single source.
  const context = resolveMessageContext(sel.rangeCount === 1 ? range.commonAncestorContainer : null);
  return { ok: true, snapshot: { text, rect, context } };
}

/** Read and validate the current window selection; return null on failure. */
export function getSelectionSnapshot(): SelectionSnapshot | null {
  const res = validateSelection(window.getSelection());
  return res.ok ? res.snapshot : null;
}
