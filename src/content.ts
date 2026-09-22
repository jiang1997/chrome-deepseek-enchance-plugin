/** Content script entry: wires selection → popup → composer adapter. */
import { getSelectionSnapshot, MAX_SELECTION_LENGTH, type SelectionSnapshot } from "./core/selection";
import { QuotePopup } from "./core/popup";
import { formatQuote } from "./core/quote";
import { findComposerWithRetry, insertIntoComposer } from "./adapters/deepseek-composer";

declare global {
  interface Window {
    __DSE_INITIALIZED__?: boolean;
  }
}

type PluginState = {
  snapshot: SelectionSnapshot | null;
  popupVisible: boolean;
};

const RETRY_TIMEOUT_MS = 300;

function init(): void {
  // Idempotent: avoid double listeners when injected twice
  if (window.__DSE_INITIALIZED__) return;
  window.__DSE_INITIALIZED__ = true;

  const state: PluginState = { snapshot: null, popupVisible: false };
  const popup = new QuotePopup({ onQuote: handleQuote });

  function hidePopup(): void {
    popup.hide();
    state.popupVisible = false;
  }

  function maybeShowPopup(): void {
    // Read on the next frame after the selection event to avoid stale values
    requestAnimationFrame(() => {
      const snapshot = getSelectionSnapshot();
      if (!snapshot) {
        // Give a hint for over-long selections; hide silently otherwise
        const sel = window.getSelection();
        const len = sel ? sel.toString().trim().length : 0;
        if (len > MAX_SELECTION_LENGTH) {
          popup.showTransientMessage(`Up to ${MAX_SELECTION_LENGTH} characters can be quoted`);
          state.popupVisible = true;
          state.snapshot = null;
          return;
        }
        if (state.popupVisible) hidePopup();
        state.snapshot = null;
        return;
      }
      state.snapshot = snapshot;
      popup.show(snapshot.rect);
      state.popupVisible = true;
    });
  }

  async function handleQuote(): Promise<void> {
    const snapshot = state.snapshot;
    if (!snapshot) {
      hidePopup();
      return;
    }
    const quote = formatQuote(snapshot.text);
    const composer = await findComposerWithRetry(RETRY_TIMEOUT_MS);
    if (!composer) {
      popup.showTransientMessage("Message composer not found");
      return;
    }
    const ok = insertIntoComposer(composer, quote);
    if (!ok) {
      popup.showTransientMessage("Insert failed, please try again");
      return;
    }
    hidePopup();
    state.snapshot = null;
  }

  document.addEventListener("pointerup", (e) => {
    if (popup.isInside(e.target as Node)) return;
    // Microtask delay: the selection may not be updated right after pointerup, rAF is the fallback
    maybeShowPopup();
  });

  document.addEventListener("keyup", (e) => {
    // Only respond to keys that can change the selection: Shift + arrows / select all / Escape handled separately
    if (e.key === "Escape") {
      if (state.popupVisible) {
        hidePopup();
        state.snapshot = null;
      }
      return;
    }
    if (e.shiftKey || e.key.startsWith("Arrow") || (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      maybeShowPopup();
    }
  });

  // Clicking elsewhere on the page hides it (capture phase, skip the popup itself)
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (popup.isInside(e.target as Node)) return;
      if (state.popupVisible) {
        hidePopup();
        // Not clearing the snapshot? Clicking blank space means abandoning the quote, clearing is more expected
        state.snapshot = null;
      }
    },
    { capture: true },
  );

  // Hide on scroll / zoom / route change, wait for the next valid selection
  window.addEventListener("scroll", () => hidePopup(), { passive: true, capture: true });
  window.addEventListener("resize", () => hidePopup(), { passive: true });
  window.addEventListener("pagehide", () => hidePopup());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hidePopup();
  });
}

init();
