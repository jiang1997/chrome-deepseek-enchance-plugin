/** Content script 入口：串联选区 → 浮层 → 输入框适配器。 */
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
  // 幂等：避免重复注入导致双重监听
  if (window.__DSE_INITIALIZED__) return;
  window.__DSE_INITIALIZED__ = true;

  const state: PluginState = { snapshot: null, popupVisible: false };
  const popup = new QuotePopup({ onQuote: handleQuote });

  function hidePopup(): void {
    popup.hide();
    state.popupVisible = false;
  }

  function maybeShowPopup(): void {
    // 选区事件结束后下一帧读取，避免读到旧值
    requestAnimationFrame(() => {
      const snapshot = getSelectionSnapshot();
      if (!snapshot) {
        // 超长选区给出提示，其余静默隐藏
        const sel = window.getSelection();
        const len = sel ? sel.toString().trim().length : 0;
        if (len > MAX_SELECTION_LENGTH) {
          popup.showTransientMessage(`最多引用 ${MAX_SELECTION_LENGTH} 字`);
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
      popup.showTransientMessage("未找到消息输入框");
      return;
    }
    const ok = insertIntoComposer(composer, quote);
    if (!ok) {
      popup.showTransientMessage("插入失败，请重试");
      return;
    }
    hidePopup();
    state.snapshot = null;
  }

  document.addEventListener("pointerup", (e) => {
    if (popup.isInside(e.target as Node)) return;
    // 微任务延迟：pointerup 后选区可能尚未更新由 rAF 兜底
    maybeShowPopup();
  });

  document.addEventListener("keyup", (e) => {
    // 只响应可能改变选区的按键：Shift + 方向键 / 全选 / Escape 单独处理
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

  // 点击页面其他区域隐藏（捕获阶段，避开浮层自身）
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (popup.isInside(e.target as Node)) return;
      if (state.popupVisible) {
        hidePopup();
        // 不清除 snapshot？点击空白意味着放弃引用，直接清除更符合预期
        state.snapshot = null;
      }
    },
    { capture: true },
  );

  // 滚动 / 缩放 / 路由变化时隐藏，等待下一次有效选择
  window.addEventListener("scroll", () => hidePopup(), { passive: true, capture: true });
  window.addEventListener("resize", () => hidePopup(), { passive: true });
  window.addEventListener("pagehide", () => hidePopup());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hidePopup();
  });
}

init();
