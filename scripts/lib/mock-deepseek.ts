import type { BrowserContext } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export type MockMessage = {
  id: string;
  role: "user" | "assistant";
  content?: string;
  thinking?: string;
  answerClass?: boolean;
};

/** The page controller only changes DOM; production extension code supplies all behavior under test. */
declare global {
  interface Window {
    __mockDeepSeek: {
      resetMessages(): void;
      setMessages(messages: MockMessage[]): void;
      showRenderedWindow(ids: string[], offset: number): void;
      addMessage(message: MockMessage): void;
      appendAnswer(id: string, text: string): void;
      replaceComposer(): void;
      setVirtualMessages(messages: MockMessage[], rowHeight?: number, height?: number): void;
      switchConversation(id: string, messages: MockMessage[]): void;
    };
  }
}

type HistoryReply = { body: unknown; status?: number; delayMs?: number; gate?: Promise<void> };

/** Strict local routing: page, controller, and history are separate resources. */
export async function installMockDeepSeek(context: BrowserContext, fixture: string) {
  const controller = await readFile("fixtures/mock-chat.js", "utf8");
  const replies = new Map<string, HistoryReply>();
  const requests: { sessionId: string; aborted: boolean; finished: boolean }[] = [];
  const unexpected: string[] = [];
  const failures: unknown[] = [];
  const pending = new Set<Promise<void>>();
  const requestsByRequest = new WeakMap<object, (typeof requests)[number]>();
  context.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname !== "/api/v0/chat/history_messages") return;
    const record = requestsByRequest.get(request);
    if (record) record.aborted = true;
  });

  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol !== "http:" && url.protocol !== "https:") return route.continue();
    if (url.origin === "https://chat.deepseek.com" && url.pathname === "/fixtures/mock-chat.js") {
      return route.fulfill({ contentType: "text/javascript", body: controller });
    }
    if (
      url.origin === "https://chat.deepseek.com" &&
      request.isNavigationRequest() &&
      /^\/a\/chat\/s\/[a-f0-9-]+$/i.test(url.pathname)
    ) {
      return route.fulfill({ contentType: "text/html", body: fixture });
    }
    if (url.origin !== "https://chat.deepseek.com" || url.pathname !== "/api/v0/chat/history_messages") {
      unexpected.push(`${request.method()} ${url.href}`);
      return route.abort();
    }
    const sessionId = url.searchParams.get("chat_session_id") ?? "";
    const record = { sessionId, aborted: false, finished: false };
    requestsByRequest.set(request, record);
    requests.push(record);
    const task = (async () => {
      try {
        assert.equal(request.method(), "GET");
        assert.equal(request.headers().authorization, "Bearer test-only-token");
        const reply = replies.get(sessionId);
        assert.ok(reply, `No history fixture for ${sessionId}`);
        if (reply.gate) await reply.gate;
        if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
        if (!record.aborted) {
          await route.fulfill({
            status: reply.status ?? 200,
            contentType: "application/json",
            body: JSON.stringify(reply.body),
          });
        }
      } catch (error) {
        if (!record.aborted) {
          failures.push(error);
          await route.abort().catch(() => {});
        }
      } finally {
        record.finished = true;
      }
    })();
    pending.add(task);
    await task;
    pending.delete(task);
  });

  return {
    requests,
    setHistory(sessionId: string, reply: HistoryReply) {
      replies.set(sessionId, reply);
    },
    async assertClean() {
      await Promise.all(pending);
      assert.deepEqual(unexpected, [], "Unexpected network requests");
      assert.deepEqual(failures, [], "Mock history route failures");
    },
  };
}
