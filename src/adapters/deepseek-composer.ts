/** DeepSeek composer adapter: discover candidates + insert into textarea/contenteditable. */
import { spliceQuote } from "../core/quote";

export type ComposerElement = HTMLTextAreaElement | HTMLElement;

const MIN_CONFIDENCE = 3;
const POPUP_ATTR = "data-dse-popup";

function isVisible(el: Element): boolean {
  const htmlEl = el as HTMLElement;
  if (htmlEl.hidden) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return true;
}

function isInPopup(el: Element): boolean {
  return !!el.closest(`[${POPUP_ATTR}]`);
}

function isExcludedChrome(el: Element): boolean {
  // textboxes inside search boxes / sidebars / dialogs should not be treated as the composer
  return !!el.closest("aside, nav, header, [role='search'], [role='dialog'], [role='menu']");
}

function isDisabledOrReadonly(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return el.disabled || el.readOnly;
  }
  const htmlEl = el as HTMLElement;
  if (htmlEl.isContentEditable) return false;
  if (el.getAttribute("aria-disabled") === "true") return true;
  if (el.getAttribute("contenteditable") === "false") return true;
  return false;
}

export type ScoredCandidate = { el: ComposerElement; score: number };

/** Score a candidate (pure logic, testable). */
export function scoreCandidate(
  el: Element,
  viewport: { width: number; height: number },
  activeElement: Element | null,
): number {
  let score = 0;
  const rect = el.getBoundingClientRect();
  const centerY = rect.top + rect.height / 2;

  // In the lower half of the page
  if (centerY > viewport.height * 0.5) score += 2;
  // Wide and close to the main content area
  if (rect.width >= Math.min(400, viewport.width * 0.4)) score += 2;
  else if (rect.width >= 200) score += 1;
  // Input semantics
  if (el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby")) score += 1;
  if (el.hasAttribute("placeholder")) score += 1;
  if (el.getAttribute("role") === "textbox") score += 1;
  if (el.tagName.toLowerCase() === "textarea") score += 1;
  // Currently focused: big bonus
  if (activeElement && (el === activeElement || el.contains(activeElement))) score += 5;
  // Close to the bottom
  const distanceToBottom = viewport.height - rect.bottom;
  if (distanceToBottom >= 0 && distanceToBottom < viewport.height * 0.3) score += 2;

  return score;
}

function collectCandidates(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'));
}

/** Find the DeepSeek message composer; return null when confidence is low (better to write nothing than the wrong box). */
export function findComposer(root: ParentNode = document): ComposerElement | null {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const active = document.activeElement;
  const scored: ScoredCandidate[] = [];

  for (const el of collectCandidates(root)) {
    if (isInPopup(el)) continue;
    if (isExcludedChrome(el)) continue;
    if (isDisabledOrReadonly(el)) continue;
    if (!isVisible(el)) continue;
    const score = scoreCandidate(el, viewport, active);
    scored.push({ el: el as ComposerElement, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < MIN_CONFIDENCE) return null;
  return best.el;
}

function setNativeTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const proto = HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(textarea, value);
  else textarea.value = value;
}

function dispatchInput(el: Element, quote: string): void {
  el.dispatchEvent(
    new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: quote }),
  );
}

export function insertIntoTextarea(textarea: HTMLTextAreaElement, quote: string): boolean {
  try {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const { value, cursor } = spliceQuote(textarea.value, start, end, quote);
    setNativeTextareaValue(textarea, value);
    dispatchInput(textarea, quote);
    textarea.focus({ preventScroll: true });
    try {
      textarea.setSelectionRange(cursor, cursor);
    } catch {
      /* Ignore cursor restore failure */
    }
    return true;
  } catch {
    // Fallback: setRangeText
    try {
      textarea.focus({ preventScroll: true });
      textarea.setRangeText(quote, textarea.selectionStart ?? 0, textarea.selectionEnd ?? 0, "end");
      dispatchInput(textarea, quote);
      return true;
    } catch {
      return false;
    }
  }
}

export function insertIntoContentEditable(el: HTMLElement, quote: string): boolean {
  try {
    el.focus({ preventScroll: true });
    const sel = window.getSelection();
    if (!sel) return false;
    let range: Range;
    if (sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      range = sel.getRangeAt(0);
    } else {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    range.deleteContents();
    const node = document.createTextNode(quote);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: quote }));
    el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: quote }));
    return true;
  } catch {
    return false;
  }
}

/** Unified insert entry, automatically distinguishes textarea / contenteditable. */
export function insertIntoComposer(el: ComposerElement, quote: string): boolean {
  if (el instanceof HTMLTextAreaElement) return insertIntoTextarea(el, quote);
  return insertIntoContentEditable(el as HTMLElement, quote);
}

/** Retry finding shortly (composer not rendered yet), retries every frame for 300ms by default. */
export function findComposerWithRetry(timeoutMs = 300): Promise<ComposerElement | null> {
  return new Promise((resolve) => {
    const found = findComposer();
    if (found) {
      resolve(found);
      return;
    }
    const deadline = performance.now() + timeoutMs;
    const tick = () => {
      const el = findComposer();
      if (el) {
        resolve(el);
        return;
      }
      if (performance.now() >= deadline) {
        resolve(null);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
