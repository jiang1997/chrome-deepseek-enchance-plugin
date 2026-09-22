/** 选区验证与快照（纯逻辑 + 薄 DOM 适配）。 */

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
  // 完全在视口外视为不可见
  if (rect.right < 0 || rect.left > vw || rect.bottom < 0 || rect.top > vh) return false;
  return true;
}

function closestElement(node: Node | null): Element | null {
  if (!node) return null;
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  return (node as ChildNode).parentElement ?? null;
}

/** 是否位于可编辑元素内（输入框选区不应弹出引用按钮）。 */
export function isInEditable(node: Node | null): boolean {
  const el = closestElement(node);
  if (!el) return false;
  return !!el.closest('textarea, input, [contenteditable="true"], [role="textbox"]');
}

/** 是否位于插件自身浮层内。 */
export function isInPopup(node: Node | null): boolean {
  const el = closestElement(node);
  if (!el) return false;
  return !!el.closest(`[${POPUP_ATTR}]`);
}

/** 是否位于侧栏 / 搜索 / 对话框等应排除的 UI 内。 */
export function isInExcludedUI(node: Node | null): boolean {
  const el = closestElement(node);
  if (!el) return false;
  return !!el.closest("aside, nav, header, [role='search'], [role='dialog'], [role='menu']");
}

export type ValidateResult =
  | { ok: true; snapshot: SelectionSnapshot }
  | { ok: false; reason: SelectionRejectReason };

/**
 * 验证当前 Selection，成功时返回不可变快照（文本 + 视口 rect）。
 * 注意：调用方应在 rAF / 事件稳定后调用，避免读到旧选区。
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

  return { ok: true, snapshot: { text, rect } };
}

/** 读取当前 window 选区并验证，失败返回 null。 */
export function getSelectionSnapshot(): SelectionSnapshot | null {
  const res = validateSelection(window.getSelection());
  return res.ok ? res.snapshot : null;
}
