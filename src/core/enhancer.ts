/** Selection → prompt above the composer → append quote. Kept side-effect-free so it can be tested. */
import { validateSelection, MAX_SELECTION_LENGTH, type SelectionSnapshot } from "./selection";
import { QuotePopup } from "./popup";
import { formatQuote } from "./quote";
import { describeMessageContext } from "./message-context";
import {
  findComposer,
  findComposerWithRetry,
  insertIntoComposer,
  isComposerEditable,
  type ComposerElement,
} from "../adapters/deepseek-composer";

declare global {
  interface Window {
    __DSE_INITIALIZED__?: boolean;
  }
}

type SelectionIdentity = {
  text: string;
  startNode: Node;
  startOffset: number;
  endNode: Node;
  endOffset: number;
};

function selectionIdentity(sel: Selection | null): SelectionIdentity | null {
  if (!sel || sel.isCollapsed || sel.rangeCount !== 1) return null;
  const range = sel.getRangeAt(0);
  return {
    text: sel.toString(),
    startNode: range.startContainer,
    startOffset: range.startOffset,
    endNode: range.endContainer,
    endOffset: range.endOffset,
  };
}

function sameSelection(a: SelectionIdentity | null, b: SelectionIdentity | null): boolean {
  return !!a && !!b && a.text === b.text && a.startNode === b.startNode &&
    a.startOffset === b.startOffset && a.endNode === b.endNode && a.endOffset === b.endOffset;
}

type PluginState = {
  snapshot: SelectionSnapshot | null;
  composer: ComposerElement | null;
};

export const RETRY_TIMEOUT_MS = 300;

let teardown: (() => void) | null = null;

export function init(): void {
  // Idempotent: avoid double listeners when injected twice
  if (window.__DSE_INITIALIZED__) return;
  window.__DSE_INITIALIZED__ = true;

  const state: PluginState = { snapshot: null, composer: null };
  const popup = new QuotePopup({ onQuote: handleQuote, onHide: resetQuoteState });
  let pendingFrame: number | null = null;
  let layoutFrame: number | null = null;
  let lastSelection: SelectionIdentity | null = null;
  // DeepSeek's chat ID is in the path; in-page anchors must not discard a quote.
  let conversationPath = window.location.pathname;
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  let quoteController: AbortController | null = null;
  let quoting = false;

  function cancelPendingFrame(): void {
    if (pendingFrame !== null) {
      cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
    }
  }

  function cancelPendingQuote(): void {
    quoteController?.abort();
    quoteController = null;
    quoting = false;
    popup.setBusy(false);
  }

  /**
   * Discard pending content only on dismissal, success, or conversation/page navigation.
   * Keep the last observed selection so dismissal does not immediately reopen the prompt.
   */
  function resetQuoteState(): void {
    cancelPendingFrame();
    if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
    layoutFrame = null;
    cancelPendingQuote();
    state.snapshot = null;
    state.composer = null;
  }

  function hidePopup(): void {
    resetQuoteState();
    popup.hide();
  }

  function syncConversation(): boolean {
    const path = window.location.pathname;
    if (path === conversationPath) return false;
    conversationPath = path;
    lastSelection = selectionIdentity(window.getSelection());
    hidePopup();
    return true;
  }

  function refreshPopup(): void {
    if (syncConversation()) return;
    if (!state.snapshot) {
      popup.reposition();
      return;
    }
    if (document.hidden) {
      popup.suspend();
      return;
    }
    const composer = state.composer?.isConnected ? state.composer : findComposer();
    if (!composer) {
      popup.suspend();
      return;
    }
    state.composer = composer;
    if (popup.isOpen) popup.setAnchor(composer);
    else popup.show(composer, state.snapshot.text, describeMessageContext(state.snapshot.context));
  }

  function maybeShowPopup(): void {
    if (syncConversation() || document.hidden) return;
    const sel = window.getSelection();
    // Cancel a superseded quote immediately, before a lookup queued ahead of our frame settles.
    if (!sameSelection(selectionIdentity(sel), lastSelection) && validateSelection(sel).ok) {
      cancelPendingQuote();
    }
    cancelPendingFrame();
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      if (syncConversation() || document.hidden) return;
      const selection = window.getSelection();
      const identity = selectionIdentity(selection);
      const result = validateSelection(selection);
      if (!result.ok) {
        if (!identity) lastSelection = null;
        if (result.reason === "too-long") {
          const message = `Up to ${MAX_SELECTION_LENGTH} characters can be quoted`;
          if (state.snapshot) popup.showNotice(message);
          else {
            const composer = findComposer();
            if (composer) popup.showTransientMessage(composer, message);
          }
        }
        return;
      }
      if (sameSelection(identity, lastSelection)) return;
      lastSelection = identity;
      cancelPendingQuote();
      state.snapshot = result.snapshot;
      state.composer = findComposer();
      popup.show(state.composer, result.snapshot.text, describeMessageContext(result.snapshot.context));
    });
  }

  async function handleQuote(): Promise<void> {
    if (syncConversation() || document.hidden) return;
    // A click may land while a previous lookup is still running; ignore it.
    if (quoting) return;
    const snapshot = state.snapshot;
    if (!snapshot) {
      hidePopup();
      return;
    }

    quoting = true;
    const controller = new AbortController();
    quoteController = controller;
    popup.setBusy(true);

    const quote = formatQuote(snapshot.text, snapshot.context);
    try {
      let composer = state.composer;
      if (!composer || !isComposerEditable(composer)) {
        composer = await findComposerWithRetry(RETRY_TIMEOUT_MS, controller.signal);
      }
      // Navigation, manual dismissal, or tab suspension cancels pending writes.
      if (syncConversation() || controller.signal.aborted || document.hidden) return;
      // A newer selection replaced this one in the meantime; drop the stale quote.
      if (state.snapshot !== snapshot) return;
      // Re-confirm right before writing: it may have been removed or disabled in the meantime.
      if (!composer || !isComposerEditable(composer)) {
        refreshPopup();
        popup.showNotice("Composer unavailable, please try again");
        return;
      }
      state.composer = composer;
      popup.setAnchor(composer);
      const ok = insertIntoComposer(composer, quote);
      if (!ok) {
        popup.showNotice("Insert failed, please try again");
        return;
      }
      hidePopup();
    } finally {
      if (quoteController === controller) {
        quoteController = null;
        quoting = false;
        popup.setBusy(false);
      }
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (popup.isInside(e.target as Node)) return;
    // Microtask delay: the selection may not be updated right after pointerup, rAF is the fallback
    maybeShowPopup();
  }

  function onKeyUp(e: KeyboardEvent): void {
    // Only respond to keys that can change the selection: Shift + arrows / select all / Escape handled separately
    if (e.key === "Escape") {
      if (state.snapshot || popup.isOpen) hidePopup();
      return;
    }
    if (e.shiftKey || e.key.startsWith("Arrow") || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a")) {
      maybeShowPopup();
    }
  }

  function onPointerDown(e: PointerEvent): void {
    if (popup.isInside(e.target as Node)) return;
    syncConversation();
    cancelPendingFrame();
  }

  function onScroll(): void {
    refreshPopup();
  }

  function onResize(): void {
    refreshPopup();
  }

  function onLocationChange(): void {
    syncConversation();
  }

  // Also catch SPA navigation on older browsers and replacement composers in the same chat.
  const observer = new MutationObserver(() => {
    if (syncConversation() || !state.snapshot || layoutFrame !== null) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = null;
      refreshPopup();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  function onPageHide(): void {
    hidePopup();
  }

  function onVisibilityChange(): void {
    if (document.hidden) {
      cancelPendingQuote();
      popup.suspend();
    } else refreshPopup();
  }

  document.addEventListener("selectionchange", maybeShowPopup);
  navigation?.addEventListener("currententrychange", onLocationChange);
  window.addEventListener("popstate", onLocationChange);
  window.addEventListener("hashchange", onLocationChange);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("pointerdown", onPointerDown, { capture: true });
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  window.addEventListener("resize", onResize, { passive: true });
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibilityChange);

  teardown = () => {
    observer.disconnect();
    document.removeEventListener("selectionchange", maybeShowPopup);
    navigation?.removeEventListener("currententrychange", onLocationChange);
    window.removeEventListener("popstate", onLocationChange);
    window.removeEventListener("hashchange", onLocationChange);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("keyup", onKeyUp);
    document.removeEventListener("pointerdown", onPointerDown, { capture: true });
    window.removeEventListener("scroll", onScroll, { capture: true });
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    hidePopup();
    popup.destroy();
    window.__DSE_INITIALIZED__ = false;
  };
}

/** Remove every listener and the popup; primarily used by tests and hot-reload teardown. */
export function destroy(): void {
  teardown?.();
  teardown = null;
}
