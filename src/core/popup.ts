/** Quote prompt anchored to the message composer. */
import type { RectLike } from "./selection";

export const POPUP_ATTR = "data-dse-popup";
export const POPUP_GAP = 8;
export const POPUP_MARGIN = 8;
export const POPUP_Z_INDEX = 2147483000;

export function computePopupPosition(
  rect: RectLike,
  popupHeight: number,
  viewport: { width: number },
): { top: number; left: number; width: number } {
  const width = Math.max(0, Math.min(rect.width, viewport.width - POPUP_MARGIN * 2));
  const left = Math.max(POPUP_MARGIN, Math.min(rect.left, viewport.width - width - POPUP_MARGIN));
  const top = Math.max(POPUP_MARGIN, rect.top - popupHeight - POPUP_GAP);
  return { top: Math.round(top), left: Math.round(left), width: Math.round(width) };
}

export type PopupCallbacks = {
  onQuote: () => void;
  /** Fired whenever the popup closes, including internal hides (e.g. the anchor moved away). */
  onHide?: () => void;
};

export class QuotePopup {
  private root: HTMLDivElement | null = null;
  private preview: HTMLSpanElement | null = null;
  private button: HTMLButtonElement | null = null;
  private hintTimer: number | null = null;
  private anchor: HTMLElement | null = null;
  private anchorObserver: ResizeObserver | null = null;
  private originalLabel = "Quote";
  visible = false;

  constructor(private callbacks: PopupCallbacks) {}

  private ensureRoot(): HTMLDivElement {
    if (this.root && document.contains(this.root)) return this.root;
    const root = document.createElement("div");
    root.setAttribute(POPUP_ATTR, "true");
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", "DeepSeek quote prompt");
    root.className = "dse-popup";
    root.style.position = "fixed";
    root.style.zIndex = String(POPUP_Z_INDEX);
    root.style.display = "none";

    const preview = document.createElement("span");
    preview.className = "dse-popup-preview";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dse-popup-btn";
    btn.textContent = this.originalLabel;
    // pointerdown prevents default to avoid focus/selection changes; the actual action runs on click
    btn.addEventListener("pointerdown", (e) => e.preventDefault());
    btn.addEventListener("click", () => this.callbacks.onQuote());

    root.append(preview, btn);
    document.body.appendChild(root);
    this.root = root;
    this.preview = preview;
    this.button = btn;
    return root;
  }

  show(anchor: HTMLElement, text: string, badge = ""): void {
    const root = this.ensureRoot();
    if (this.hintTimer !== null) window.clearTimeout(this.hintTimer);
    this.hintTimer = null;
    this.restoreLabel();
    this.anchorObserver?.disconnect();
    this.anchor = anchor;
    if (this.preview) this.preview.textContent = badge ? `Selected ${badge}: ${text}` : `Selected: ${text}`;
    root.style.display = "flex";
    this.visible = true;
    this.reposition();
    if (typeof ResizeObserver !== "undefined") {
      this.anchorObserver = new ResizeObserver(() => this.reposition());
      this.anchorObserver.observe(anchor);
    }
  }

  reposition(): void {
    if (!this.root || !this.anchor || !this.visible) return;
    if (!this.anchor.isConnected) {
      this.hide();
      return;
    }
    const rect = this.anchor.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > window.innerHeight) {
      this.hide();
      return;
    }
    const position = computePopupPosition(rect, this.root.offsetHeight || 44, { width: window.innerWidth });
    this.root.style.top = `${position.top}px`;
    this.root.style.left = `${position.left}px`;
    this.root.style.width = `${position.width}px`;
  }

  hide(): void {
    if (this.root) this.root.style.display = "none";
    this.visible = false;
    this.anchor = null;
    this.anchorObserver?.disconnect();
    this.anchorObserver = null;
    if (this.hintTimer !== null) {
      window.clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
    this.restoreLabel();
    this.callbacks.onHide?.();
  }

  destroy(): void {
    if (this.hintTimer !== null) {
      window.clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
    this.root?.remove();
    this.root = null;
    this.preview = null;
    this.button = null;
    this.visible = false;
    this.anchor = null;
    this.anchorObserver?.disconnect();
    this.anchorObserver = null;
    this.callbacks.onHide?.();
  }

  /** Disable the action button while a quote is being written (also blocks duplicate clicks). */
  setBusy(busy: boolean): void {
    if (!this.button) return;
    this.button.disabled = busy;
  }

  isInside(node: Node | null): boolean {
    if (!node || !this.root) return false;
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node as ChildNode).parentElement;
    return !!el && !!el.closest(`[${POPUP_ATTR}]`);
  }

  /** Transient hint (e.g. "Message composer not found"), restores after 1.6s. */
  showTransientMessage(anchor: HTMLElement, msg: string, duration = 1600): void {
    this.show(anchor, msg);
    if (!this.button || !this.preview) return;
    this.preview.textContent = msg;
    this.button.disabled = true;
    this.hintTimer = window.setTimeout(() => {
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
