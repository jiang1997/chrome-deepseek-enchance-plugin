/** Content script entry: wires selection → prompt above the composer → append quote. */
import { validateSelection, MAX_SELECTION_LENGTH, type SelectionSnapshot } from "./core/selection";
import { QuotePopup } from "./core/popup";
import { formatQuote } from "./core/quote";
import { describeMessageContext } from "./core/message-context";
import { findComposer, findComposerWithRetry, insertIntoComposer, type ComposerElement } from "./adapters/deepseek-composer";

declare global {
  interface Window {
    __DSE_INITIALIZED__?: boolean;
  }
}

type PluginState = {
  snapshot: SelectionSnapshot | null;
  composer: ComposerElement | null;
};

const RETRY_TIMEOUT_MS = 300;

function init(): void {
  // Idempotent: avoid double listeners when injected twice
  if (window.__DSE_INITIALIZED__) return;
  window.__DSE_INITIALIZED__ = true;

  const state: PluginState = { snapshot: null, composer: null };
  const popup = new QuotePopup({ onQuote: handleQuote });
  let pendingFrame: number | null = null;

  function hidePopup(): void {
    popup.hide();
    state.snapshot = null;
    state.composer = null;
  }

  function maybeShowPopup(): void {
    // Read on the next frame after the selection event to avoid stale values
    if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
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
    const snapshot = state.snapshot;
    if (!snapshot) {
      hidePopup();
      return;
    }
    const quote = formatQuote(snapshot.text, snapshot.context);
    const composer = state.composer?.isConnected ? state.composer : await findComposerWithRetry(RETRY_TIMEOUT_MS);
    if (!composer) {
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
  }

  document.addEventListener("pointerup", (e) => {
    if (popup.isInside(e.target as Node)) return;
    // Microtask delay: the selection may not be updated right after pointerup, rAF is the fallback
    maybeShowPopup();
  });

  document.addEventListener("keyup", (e) => {
    // Only respond to keys that can change the selection: Shift + arrows / select all / Escape handled separately
    if (e.key === "Escape") {
      if (popup.visible) hidePopup();
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
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
      if (popup.visible) hidePopup();
    },
    { capture: true },
  );

  // Keep the prompt attached above the composer when its position changes.
  window.addEventListener("scroll", () => popup.reposition(), { passive: true, capture: true });
  window.addEventListener("resize", () => popup.reposition(), { passive: true });
  window.addEventListener("pagehide", () => hidePopup());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hidePopup();
  });
}

init();
