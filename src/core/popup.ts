/** 单例浮动「引用」按钮：定位、展示、隐藏、短暂提示。 */
import type { RectLike } from "./selection";

export const POPUP_ATTR = "data-dse-popup";
export const POPUP_GAP = 8;
export const POPUP_MARGIN = 8;
export const POPUP_Z_INDEX = 2147483000;

export type PopupPlacement = "above" | "below";

export function computePopupPosition(
  rect: RectLike,
  popupSize: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number; placement: PopupPlacement } {
  const { width: pw, height: ph } = popupSize;
  const { width: vw } = viewport;
  const vh = viewport.height;

  let centerX = rect.left + rect.width / 2 - pw / 2;
  centerX = Math.max(POPUP_MARGIN, Math.min(centerX, vw - pw - POPUP_MARGIN));

  const aboveTop = rect.top - ph - POPUP_GAP;
  const belowTop = rect.bottom + POPUP_GAP;

  let top: number;
  let placement: PopupPlacement;
  if (aboveTop >= POPUP_MARGIN) {
    top = aboveTop;
    placement = "above";
  } else if (belowTop + ph <= vh - POPUP_MARGIN) {
    top = belowTop;
    placement = "below";
  } else {
    // 上下都放不下：钳制在视口内
    top = Math.max(POPUP_MARGIN, Math.min(belowTop, vh - ph - POPUP_MARGIN));
    placement = "below";
  }
  return { top: Math.round(top), left: Math.round(centerX), placement };
}

export type PopupCallbacks = {
  onQuote: () => void;
};

export class QuotePopup {
  private root: HTMLDivElement | null = null;
  private button: HTMLButtonElement | null = null;
  private hintTimer: number | null = null;
  private originalLabel = "引用";
  visible = false;

  constructor(private callbacks: PopupCallbacks) {}

  private ensureRoot(): HTMLDivElement {
    if (this.root && document.contains(this.root)) return this.root;
    const root = document.createElement("div");
    root.setAttribute(POPUP_ATTR, "true");
    root.setAttribute("role", "toolbar");
    root.setAttribute("aria-label", "DeepSeek 引用工具");
    root.className = "dse-popup";
    root.style.position = "fixed";
    root.style.zIndex = String(POPUP_Z_INDEX);
    root.style.display = "none";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dse-popup-btn";
    btn.textContent = this.originalLabel;
    // pointerdown 阻止默认，避免焦点/选区变化；实际动作走 click
    btn.addEventListener("pointerdown", (e) => e.preventDefault());
    btn.addEventListener("click", () => this.callbacks.onQuote());

    root.appendChild(btn);
    document.body.appendChild(root);
    this.root = root;
    this.button = btn;
    return root;
  }

  show(rect: RectLike): void {
    const root = this.ensureRoot();
    root.style.display = "block";
    this.visible = true;
    // 先显示再测量，否则 offsetWidth 为 0
    const pw = root.offsetWidth || 80;
    const ph = root.offsetHeight || 32;
    const { top, left } = computePopupPosition(
      rect,
      { width: pw, height: ph },
      { width: window.innerWidth, height: window.innerHeight },
    );
    root.style.top = `${top}px`;
    root.style.left = `${left}px`;
    this.button?.focus({ preventScroll: true });
  }

  hide(): void {
    if (this.root) this.root.style.display = "none";
    this.visible = false;
    if (this.hintTimer !== null) {
      window.clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
    this.restoreLabel();
  }

  destroy(): void {
    if (this.hintTimer !== null) {
      window.clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
    this.root?.remove();
    this.root = null;
    this.button = null;
    this.visible = false;
  }

  isInside(node: Node | null): boolean {
    if (!node || !this.root) return false;
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node as ChildNode).parentElement;
    return !!el && !!el.closest(`[${POPUP_ATTR}]`);
  }

  /** 短暂提示（如“未找到消息输入框”），1.6s 后恢复。 */
  showTransientMessage(msg: string, duration = 1600): void {
    const root = this.ensureRoot();
    if (!this.button) return;
    root.style.display = "block";
    this.visible = true;
    this.button.textContent = msg;
    this.button.disabled = true;
    if (this.hintTimer !== null) window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => {
      this.restoreLabel();
      this.hide();
    }, duration);
  }

  private restoreLabel(): void {
    if (this.button) {
      this.button.textContent = this.originalLabel;
      this.button.disabled = false;
    }
  }
}
