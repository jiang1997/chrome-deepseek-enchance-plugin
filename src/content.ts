/** Content script 入口：串联选区 → 输入框上方的提示 → 追加引用。 */
import { validateSelection, MAX_SELECTION_LENGTH, type SelectionSnapshot } from "./core/selection";
import { QuotePopup } from "./core/popup";
import { formatQuote } from "./core/quote";
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
  // 幂等：避免重复注入导致双重监听
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
    // 选区事件结束后下一帧读取，避免读到旧值
    if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      const result = validateSelection(window.getSelection());
      const composer = findComposer();
      if (!result.ok || !composer) {
        hidePopup();
        if (!result.ok && result.reason === "too-long" && composer) {
          popup.showTransientMessage(composer, `最多引用 ${MAX_SELECTION_LENGTH} 字`);
        }
        return;
      }
      state.snapshot = result.snapshot;
      state.composer = composer;
      popup.show(composer, result.snapshot.text);
    });
  }

  async function handleQuote(): Promise<void> {
    const snapshot = state.snapshot;
    if (!snapshot) {
      hidePopup();
      return;
    }
    const quote = formatQuote(snapshot.text);
    const composer = state.composer?.isConnected ? state.composer : await findComposerWithRetry(RETRY_TIMEOUT_MS);
    if (!composer) {
      hidePopup();
      return;
    }
    const ok = insertIntoComposer(composer, quote);
    if (!ok) {
      popup.showTransientMessage(composer, "插入失败，请重试");
      state.snapshot = null;
      state.composer = null;
      return;
    }
    hidePopup();
  }

  document.addEventListener("pointerup", (e) => {
    if (popup.isInside(e.target as Node)) return;
    // 微任务延迟：pointerup 后选区可能尚未更新由 rAF 兜底
    maybeShowPopup();
  });

  document.addEventListener("keyup", (e) => {
    // 只响应可能改变选区的按键：Shift + 方向键 / 全选 / Escape 单独处理
    if (e.key === "Escape") {
      if (popup.visible) hidePopup();
      return;
    }
    if (e.shiftKey || e.key.startsWith("Arrow") || (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      maybeShowPopup();
    }
  });

  // 点击页面其他区域隐藏（捕获阶段，避开浮层自身）
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

  // 输入框位置变化时，提示继续紧贴输入框上方。
  window.addEventListener("scroll", () => popup.reposition(), { passive: true, capture: true });
  window.addEventListener("resize", () => popup.reposition(), { passive: true });
  window.addEventListener("pagehide", () => hidePopup());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hidePopup();
  });
}

init();
