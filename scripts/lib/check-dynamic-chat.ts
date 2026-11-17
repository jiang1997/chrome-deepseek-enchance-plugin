import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import type { installMockDeepSeek, MockMessage } from "./mock-deepseek.ts";

type MockServer = Awaited<ReturnType<typeof installMockDeepSeek>>;

function history(messages: MockMessage[]) {
  return {
    data: {
      biz_data: {
        chat_messages: messages.map((message, index) => ({
          message_id: message.id,
          parent_id: messages[index - 1]?.id ?? 0,
          role: message.role.toUpperCase(),
          content: message.content ?? "",
        })),
        chat_session: { current_message_id: messages.at(-1)?.id },
      },
    },
  };
}

/** Read geometry, then let Chromium create the selection through real mouse events. */
async function dragSelect(page: Page, target: Locator) {
  // Smooth scrolling can still recycle the target after a jump reports success.
  // Re-resolve the locator until it is stable, as a user would wait before dragging.
  await expect(async () => {
    await target.scrollIntoViewIfNeeded();
    await expect(target).toBeInViewport();
  }).toPass({ timeout: 5000 });
  const points = await target.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
    const first = rects[0];
    const last = rects.at(-1);
    if (!first || !last) throw new Error("Selection target has no text geometry");
    return { x1: first.left + 1, y1: first.top + first.height / 2, x2: last.right - 1, y2: last.top + last.height / 2 };
  });
  await page.mouse.move(points.x1, points.y1);
  await page.mouse.down();
  await page.mouse.move(points.x2, points.y2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(await target.textContent());
}

export async function checkDynamicChat(context: BrowserContext, mock: MockServer) {
  const errors: string[] = [];
  async function open(sessionId: string) {
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`https://chat.deepseek.com/a/chat/s/${sessionId}`);
    await page.evaluate(() => localStorage.setItem("userToken", JSON.stringify({ value: "test-only-token" })));
    await page.getByRole("button", { name: "Conversation tree", exact: true }).waitFor();
    return page;
  }

  // Native selection + a detached old composer + real input/caret behavior.
  const quoteMessages: MockMessage[] = [
    { id: "1", role: "user", content: "A question" },
    { id: "2", role: "assistant", content: "A short answer to quote." },
  ];
  mock.setHistory("abcdef-1001", { body: history(quoteMessages) });
  const quotePage = await open("abcdef-1001");
  await quotePage.evaluate((messages) => window.__mockDeepSeek.setMessages(messages), quoteMessages);
  await quotePage.locator("#composer").fill("Existing draft");
  await dragSelect(quotePage, quotePage.locator(".ds-assistant-message-main-content"));
  await expect(quotePage.locator(".dse-popup-preview")).toContainText("Selected assistant #1:");
  const oldComposer = await quotePage.locator("#composer").elementHandle();
  assert.ok(oldComposer);
  await quotePage.evaluate(() => window.__mockDeepSeek.replaceComposer());
  assert.equal(await oldComposer.evaluate((element) => element.isConnected), false);
  await oldComposer.dispose();
  await quotePage.locator("#composer").evaluate((element) => {
    element.addEventListener("input", () => {
      element.setAttribute("data-input-observed", "true");
    });
  });
  await quotePage.getByRole("button", { name: "Quote", exact: true }).click();
  const quotedDraft = "Existing draft\n[Quote · assistant #1]\n“A short answer to quote.”\n\n";
  await expect(quotePage.locator("#composer")).toHaveValue(quotedDraft);
  await expect(quotePage.locator("#composer")).toHaveAttribute("data-input-observed", "true");
  assert.equal(
    await quotePage
      .locator("#composer")
      .evaluate(
        (element: HTMLTextAreaElement) =>
          document.activeElement === element &&
          element.selectionStart === element.value.length &&
          element.selectionEnd === element.value.length,
      ),
    true,
  );
  await quotePage.keyboard.type(" Follow-up");
  await expect(quotePage.locator("#composer")).toHaveValue(`${quotedDraft} Follow-up`);
  await quotePage.close();
  console.log("Dynamic check passed: native selection, composer replacement, draft, input event and caret.");

  // Stream DOM changes while history is unavailable; refresh reads the actual new DOM.
  mock.setHistory("abcdef-1002", { status: 503, body: {} });
  const streamPage = await open("abcdef-1002");
  await streamPage.evaluate(() =>
    window.__mockDeepSeek.setMessages([
      { id: "2", role: "assistant", thinking: "Reasoning that must not become an answer" },
    ]),
  );
  await streamPage.getByRole("button", { name: "Conversation tree", exact: true }).click();
  await streamPage.locator('.node[data-id="2"]').hover();
  await expect(streamPage.locator(".preview-text")).toHaveText("Only thinking content is rendered.");
  await streamPage.evaluate(() => window.__mockDeepSeek.appendAnswer("2", "The answer "));
  await streamPage.evaluate(() => window.__mockDeepSeek.appendAnswer("2", "arrived in chunks."));
  await streamPage.getByRole("button", { name: "Refresh conversation tree" }).click();
  await expect(streamPage.locator(".preview-text")).toHaveText("The answer arrived in chunks.");
  await streamPage.evaluate(() =>
    window.__mockDeepSeek.addMessage({
      id: "4",
      role: "assistant",
      thinking: "More reasoning",
      content: "Fallback Markdown answer",
      answerClass: false,
    }),
  );
  await streamPage.getByRole("button", { name: "Refresh conversation tree" }).click();
  await streamPage.locator('.node[data-id="4"]').hover();
  await expect(streamPage.locator(".preview-text")).toHaveText("Fallback Markdown answer");
  await expect(streamPage.locator(".edge")).toHaveCount(0);
  await streamPage.close();
  console.log("Dynamic check passed: thinking-only preview, streamed answer and Markdown fallback.");

  // Actual scroll geometry and node recycling, with deliberately unordered IDs.
  const messages: MockMessage[] = Array.from({ length: 40 }, (_, index) => ({
    id: String(((index * 37) % 101) + 1),
    role: index % 2 === 0 ? "user" : "assistant",
    content: `Virtual message ${index + 1}.`,
  }));
  const target = messages[25];
  assert.ok(target);
  mock.setHistory("abcdef-1003", { body: history(messages) });
  const virtualPage = await open("abcdef-1003");
  await virtualPage.evaluate((items) => window.__mockDeepSeek.setVirtualMessages(items), messages);
  const viewport = virtualPage.locator("#message-viewport");
  const first = virtualPage.locator('[data-virtual-list-item-key="1"]');
  const oldFirst = await first.elementHandle();
  assert.ok(oldFirst);
  await viewport.hover();
  await virtualPage.mouse.wheel(0, 500);
  await expect(first).toHaveCount(0);
  assert.equal(await oldFirst.evaluate((element) => element.isConnected), false);
  await oldFirst.dispose();
  const targetMessage = virtualPage.locator(`[data-virtual-list-item-key="${target.id}"]`);
  await expect(targetMessage).toHaveCount(0);
  await virtualPage.getByRole("button", { name: "Conversation tree", exact: true }).click();
  await expect(virtualPage.locator(".node")).toHaveCount(40);
  await virtualPage.locator(`.node[data-id="${target.id}"]`).click();
  await virtualPage.getByText("Message located", { exact: true }).waitFor();
  await expect(targetMessage).toBeVisible();
  await expect(first).toHaveCount(0);
  assert.ok((await virtualPage.locator("[data-virtual-list-item-key]").count()) <= 4);
  await virtualPage.getByRole("button", { name: "Close conversation tree" }).click();
  await dragSelect(virtualPage, targetMessage.locator(".ds-assistant-message-main-content"));
  await expect(virtualPage.locator(".dse-popup-preview")).toContainText("Selected assistant #13:");
  await virtualPage.getByRole("button", { name: "Quote", exact: true }).click();
  await expect(virtualPage.locator("#composer")).toHaveValue(`[Quote · assistant #13]\n“${target.content}”\n\n`);
  await virtualPage.close();
  console.log("Dynamic check passed: scroll-driven virtual list, unordered IDs, offscreen jump and quote provenance.");

  // Hold a real history request while the user clicks Quote, then navigates away.
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const newMessages: MockMessage[] = [
    { id: "71", role: "user", content: "A new conversation" },
    { id: "9", role: "assistant", content: "Fresh answer from the new conversation." },
  ];
  mock.setHistory("abcdef-1004", { body: history(quoteMessages), gate });
  mock.setHistory("abcdef-1005", { body: history(newMessages), delayMs: 50 });
  const navigationPage = await open("abcdef-1004");
  try {
    await navigationPage.evaluate((items) => window.__mockDeepSeek.setMessages(items), quoteMessages);
    await dragSelect(navigationPage, navigationPage.locator(".ds-assistant-message-main-content"));
    // A real drag passes through intermediate selections, whose lookups are cancelled.
    const oldRequests = () => mock.requests.filter((request) => request.sessionId === "abcdef-1004");
    await expect.poll(() => oldRequests().filter((request) => !request.aborted).length).toBe(1);
    const beforeQuote = oldRequests().length;
    await navigationPage.getByRole("button", { name: "Quote", exact: true }).click();
    await expect(navigationPage.getByRole("button", { name: "Quote", exact: true })).toBeDisabled();
    assert.equal(oldRequests().length, beforeQuote, "Quote should reuse the pending lookup");
    await navigationPage.evaluate(
      (items) => window.__mockDeepSeek.switchConversation("abcdef-1005", items),
      newMessages,
    );
    await expect(navigationPage.locator("[data-dse-popup]")).toBeHidden();
    await navigationPage.locator("#composer").fill("New conversation draft");
    release();
    await expect.poll(() => oldRequests().every((request) => request.finished)).toBe(true);
    await expect.poll(() => oldRequests().every((request) => request.aborted)).toBe(true);
    await expect(navigationPage.locator("#composer")).toHaveValue("New conversation draft");
    await expect(navigationPage.locator("[data-dse-popup]")).toBeHidden();
    await dragSelect(navigationPage, navigationPage.locator(".ds-assistant-message-main-content"));
    await expect(navigationPage.locator(".dse-popup-preview")).toContainText("Selected assistant #1:");
    await expect
      .poll(() =>
        mock.requests.some((request) => request.sessionId === "abcdef-1005" && request.finished && !request.aborted),
      )
      .toBe(true);
    await navigationPage.getByRole("button", { name: "Quote", exact: true }).click();
    await expect(navigationPage.locator("#composer")).toHaveValue(
      "New conversation draft\n[Quote · assistant #1]\n“Fresh answer from the new conversation.”\n\n",
    );
  } finally {
    release();
  }
  await navigationPage.close();
  console.log("Dynamic check passed: navigation cancels pending history and quote; new chat loads fresh history.");

  // Both HTTP errors and incompatible successful responses must take the DOM fallback.
  for (const [sessionId, status, body] of [
    ["abcdef-1006", 429, { error: "rate limited" }],
    ["abcdef-1007", 200, { data: { biz_data: { chat_messages: "incompatible" } } }],
  ] as const) {
    mock.setHistory(sessionId, { status, body });
    const page = await open(sessionId);
    await page.evaluate((items) => window.__mockDeepSeek.setMessages(items), quoteMessages);
    await page.getByRole("button", { name: "Conversation tree", exact: true }).click();
    await expect(page.locator(".node")).toHaveCount(2);
    await expect(page.locator(".edge")).toHaveCount(0);
    await page.locator('.node[data-id="2"]').hover();
    await expect(page.locator(".preview-text")).toHaveText("A short answer to quote.");
    await page.close();
  }
  assert.deepEqual(errors, [], "Dynamic fixture page errors");
  await mock.assertClean();
  console.log("Dynamic check passed: rate limiting, incompatible history and strict network fixtures.");
}
