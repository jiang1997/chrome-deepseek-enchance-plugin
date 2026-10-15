import { classifyMessageRole, MESSAGE_ITEM_ATTR } from "../core/message-context";
import type { ChatTree } from "./model";
export const messageItems = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>(`[${MESSAGE_ITEM_ATTR}]`)].filter(
    (e) => !e.closest("nav, aside, [data-dse-tree]"),
  );
export const conversationId = (): string | null =>
  location.pathname.match(/^\/a\/chat\/s\/([a-f0-9-]+)\/?$/i)?.[1] ?? null;
export function renderedTree(): ChatTree {
  const nodes: ChatTree["nodes"] = new Map();
  // Unknown offscreen ancestors are intentionally not invented.
  for (const item of messageItems()) {
    const role = classifyMessageRole(item);
    if (role === "unknown") continue;
    const id = item.getAttribute(MESSAGE_ITEM_ATTR);
    if (id === null) continue;
    const content =
      item
        .querySelector(role === "user" ? ".ds-collapsible-text" : ".ds-assistant-message-main-content, .ds-markdown")
        ?.textContent?.trim() ?? "";
    nodes.set(id, { id, role, content, parentId: null, children: [] });
  }
  return { nodes, roots: [...nodes.keys()], currentId: null, complete: false };
}
export function requestHistory(id: string, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      window.postMessage({ type: "dse:history-cancel", requestId }, location.origin);
      reject(new Error("Cancelled"));
    };
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        event.data?.type !== "dse:history-response" ||
        event.data.requestId !== requestId ||
        event.data.conversationId !== id
      )
        return;
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.data);
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("History request timed out. Showing rendered messages."));
    }, 10000);
    window.addEventListener("message", receive);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    window.postMessage({ type: "dse:history-request", conversationId: id, requestId }, location.origin);
  });
}

export async function jumpToMessage(id: string, path: string[], signal: AbortSignal): Promise<boolean> {
  const find = () => messageItems().find((e) => e.getAttribute(MESSAGE_ITEM_ATTR) === id);
  const highlight = (item: HTMLElement) => {
    item.scrollIntoView({ block: "center", behavior: "smooth" });
    item.animate?.(
      [
        { outline: "3px solid #4d6bfe", outlineOffset: "6px" },
        { outline: "3px solid transparent", outlineOffset: "6px" },
      ],
      { duration: 1800 },
    );
  };
  const existing = find();
  if (existing) {
    highlight(existing);
    return true;
  }
  const target = path.indexOf(id);
  if (target < 0) return false;
  const scroller = messageItems()[0]?.closest<HTMLElement>(".ds-virtual-list");
  if (!scroller || scroller.scrollHeight <= scroller.clientHeight) return false;
  const original = scroller.scrollTop;
  let low = 0;
  let high = scroller.scrollHeight - scroller.clientHeight;
  for (let attempt = 0; attempt < 18 && !signal.aborted; attempt++) {
    scroller.scrollTop = (low + high) / 2;
    scroller.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    if (signal.aborted) return false;
    const item = find();
    if (item) {
      highlight(item);
      return true;
    }
    const indices = messageItems()
      .map((e) => e.getAttribute(MESSAGE_ITEM_ATTR))
      .filter((key): key is string => key !== null)
      .map((key) => path.indexOf(key))
      .filter((i) => i >= 0);
    if (!indices.length) break;
    if (target < Math.min(...indices)) high = scroller.scrollTop;
    else if (target > Math.max(...indices)) low = scroller.scrollTop;
    else break;
  }
  if (!signal.aborted) scroller.scrollTop = original;
  return false;
}
