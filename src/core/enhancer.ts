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
  }

  /**
   * Clear every bit of selection/quote state. Runs on every popup close path, including the
   * internal hides triggered by popup.reposition(), so a stale quote can never be written.
   */
  function resetQuoteState(): void {
    cancelPendingFrame();
    cancelPendingQuote();
    state.snapshot = null;
    state.composer = null;
  }

  function hidePopup(): void {
    resetQuoteState();
    popup.hide();
  }

  function maybeShowPopup(): void {
    // A selection event immediately supersedes any quote still waiting on the old selection.
    // This must happen before the delayed read below: the pending lookup may have already
    // queued a frame ahead of the preview and would otherwise win the race.
    cancelPendingQuote();
    // Read on the next frame after the selection event to avoid stale values
    cancelPendingFrame();
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      const result = validateSelection(window.getSelection());
      const composer = findComposer();
      if (!result.ok || !composer) {
        hidePopup();
        if (!result.ok && result.reason === "too-long" && composer) {
          popup.showTransientMessage(composer, `Up to ${MAX_SELECTION_LENGTH} characters can be quoted`);
        }
        return;
      }
      state.snapshot = result.snapshot;
      state.composer = composer;
      popup.show(composer, result.snapshot.text, describeMessageContext(result.snapshot.context));
    });
  }

  async function handleQuote(): Promise<void> {
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
      // The prompt was closed (Escape, click-away, page hide) while looking the composer up.
      if (controller.signal.aborted) return;
      // A newer selection replaced this one in the meantime; drop the stale quote.
      if (state.snapshot !== snapshot) return;
      // Re-confirm right before writing: it may have been removed or disabled in the meantime.
      if (!composer || !isComposerEditable(composer)) {
        hidePopup();
        return;
      }
      const ok = insertIntoComposer(composer, quote);
      if (!ok) {
        popup.showTransientMessage(composer, "Insert failed, please try again");
        state.snapshot = null;
        state.composer = null;
        return;
      }
      hidePopup();
    } finally {
      if (quoteController === controller) {
        quoteController = null;
        quoting = false;
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
      if (popup.visible) hidePopup();
      return;
    }
    if (e.shiftKey || e.key.startsWith("Arrow") || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a")) {
      maybeShowPopup();
    }
  }

  function onPointerDown(e: PointerEvent): void {
    // Clicking elsewhere on the page hides it (capture phase, skip the popup itself)
    if (popup.isInside(e.target as Node)) return;
    cancelPendingFrame();
    if (popup.visible) hidePopup();
  }

  function onScroll(): void {
    // Keep the prompt attached above the composer when its position changes.
    popup.reposition();
  }

  function onResize(): void {
    popup.reposition();
  }

  function onPageHide(): void {
    hidePopup();
  }

  function onVisibilityChange(): void {
    if (document.hidden) hidePopup();
  }

  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("pointerdown", onPointerDown, { capture: true });
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  window.addEventListener("resize", onResize, { passive: true });
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibilityChange);

  teardown = () => {
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
