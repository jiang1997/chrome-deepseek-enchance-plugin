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
  /** Fired when pending content is dismissed, not when temporarily suspended. */
  onHide?: () => void;
};

export class QuotePopup {
  private root: HTMLDivElement | null = null;
  private preview: HTMLSpanElement | null = null;
  private button: HTMLButtonElement | null = null;
  private notice: HTMLSpanElement | null = null;
  private hintTimer: number | null = null;
  private anchor: HTMLElement | null = null;
  private anchorObserver: ResizeObserver | null = null;
  private originalLabel = "Quote";
  private open = false;
  visible = false;

  get isOpen(): boolean {
    return this.open && !!this.root?.isConnected;
  }

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

    const close = document.createElement("button");
    close.type = "button";
    close.className = "dse-popup-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Dismiss quote");
    close.title = "Dismiss quote (Escape)";
    close.addEventListener("pointerdown", (e) => e.preventDefault());
    close.addEventListener("click", () => this.hide());

    const notice = document.createElement("span");
    notice.className = "dse-popup-notice";
    notice.setAttribute("role", "status");
    notice.hidden = true;
    root.append(preview, btn, close, notice);
    document.body.appendChild(root);
    this.root = root;
    this.preview = preview;
    this.button = btn;
    this.notice = notice;
    return root;
  }

  show(anchor: HTMLElement | null, text: string, badge = ""): void {
    this.ensureRoot();
    if (this.hintTimer !== null) window.clearTimeout(this.hintTimer);
    this.hintTimer = null;
    this.restoreLabel();
    if (this.notice) this.notice.hidden = true;
    this.anchorObserver?.disconnect();
    this.anchor = anchor;
    if (this.preview) this.preview.textContent = badge ? `Selected ${badge}: ${text}` : `Selected: ${text}`;
    this.open = true;
    if (anchor) this.reposition();
    else this.suspend();
    if (anchor && typeof ResizeObserver !== "undefined") {
      this.anchorObserver = new ResizeObserver(() => this.reposition());
      this.anchorObserver.observe(anchor);
    }
  }

  reposition(): void {
    if (!this.root || !this.anchor || !this.open) return;
    if (!this.anchor.isConnected) {
      this.suspend();
      return;
    }
    const rect = this.anchor.getBoundingClientRect();
    if (document.hidden || rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > window.innerHeight) {
      this.suspend();
      return;
    }
    this.root.style.display = "flex";
    this.visible = true;
    const position = computePopupPosition(rect, this.root.offsetHeight || 44, { width: window.innerWidth });
    this.root.style.top = `${position.top}px`;
    this.root.style.left = `${position.left}px`;
    this.root.style.width = `${position.width}px`;
  }

  /** Move to a replacement composer without resetting pending content or busy state. */
  setAnchor(anchor: HTMLElement): void {
    if (this.anchor !== anchor) {
      this.anchorObserver?.disconnect();
      this.anchor = anchor;
      if (typeof ResizeObserver !== "undefined") {
        this.anchorObserver = new ResizeObserver(() => this.reposition());
        this.anchorObserver.observe(anchor);
      }
    }
    this.reposition();
  }

  /** Hide temporarily while retaining content, the anchor, and resize observation. */
  suspend(): void {
    if (this.root) this.root.style.display = "none";
    this.visible = false;
  }

  hide(): void {
    if (this.root) this.root.style.display = "none";
    this.visible = false;
    this.open = false;
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
    this.notice = null;
    this.visible = false;
    this.open = false;
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

  /** Display feedback alongside the saved preview without discarding pending content. */
  showNotice(msg: string, duration = 1600): void {
    if (!this.notice) return;
    if (this.hintTimer !== null) window.clearTimeout(this.hintTimer);
    this.notice.textContent = msg;
    this.notice.hidden = false;
    this.reposition();
    this.hintTimer = window.setTimeout(() => {
      this.hintTimer = null;
      if (this.notice) this.notice.hidden = true;
      this.reposition();
    }, duration);
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
