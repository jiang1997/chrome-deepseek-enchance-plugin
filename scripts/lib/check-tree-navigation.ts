import { expect, type BrowserContext, type Locator } from "@playwright/test";
import assert from "node:assert/strict";
import type { installMockDeepSeek, MockMessage } from "./mock-deepseek.ts";

/** Exercise navigation with the production extension, real scroll geometry and inactive branches. */
export async function checkTreeNavigation(
  context: BrowserContext,
  mock: Awaited<ReturnType<typeof installMockDeepSeek>>,
) {
  const messages: MockMessage[] = Array.from({ length: 120 }, (_, index) => ({
    id: String(((index * 37) % 1009) + 1),
    role: index % 2 ? "assistant" : "user",
    content: `${[5, 65, 105].includes(index) ? "Needle" : "Message"} at position ${index}.`,
  }));
  const at = (index: number) => {
    const message = messages[index];
    assert.ok(message);
    return message;
  };
  // Deliberately send the history out of order; the parent chain defines search order.
  const historyMessages = messages
    .map((message, index) => ({
      message_id: message.id,
      parent_id: messages[index - 1]?.id ?? 0,
      role: message.role.toUpperCase(),
      content: message.content,
    }))
    .reverse();
  const branch = {
    message_id: "alternative",
    parent_id: at(10).id,
    role: "ASSISTANT",
    content: "Needle on another branch.",
  };
  const payload = (items = [branch, ...historyMessages]) => ({
    data: { biz_data: { chat_messages: items, chat_session: { current_message_id: at(119).id } } },
  });
  mock.setHistory("abcdef-2001", { body: payload() });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("https://chat.deepseek.com/a/chat/s/abcdef-2001");
  await page.evaluate((items) => {
    localStorage.setItem("userToken", JSON.stringify({ value: "test-only-token" }));
    window.__mockDeepSeek.setVirtualMessages(items);
  }, messages);
  await page.getByRole("button", { name: "Conversation tree", exact: true }).click();
  await expect(page.locator(".node")).toHaveCount(121);
  const viewport = page.locator(".viewport");
  const chatViewport = page.locator("#message-viewport");
  const search = page.getByRole("searchbox", { name: "Search conversation messages" });
  const next = page.getByRole("button", { name: "Next search result", exact: true });
  const previous = page.getByRole("button", { name: "Previous search result", exact: true });
  const reading = page.getByRole("button", { name: "Locate current reading position", exact: true });
  const node = (id: string) => page.locator(`.node[data-id="${id}"]`);
  const centered = async (target: Locator) => {
    await expect
      .poll(() =>
        target.evaluate((element) => {
          const bounds = element.closest(".viewport")?.getBoundingClientRect();
          const rect = element.getBoundingClientRect();
          return (
            !!bounds &&
            rect.top >= bounds.top &&
            rect.bottom <= bounds.bottom &&
            rect.left >= bounds.left &&
            rect.right <= bounds.right
          );
        }),
      )
      .toBe(true);
  };
  await expect(reading).toBeEnabled();
  const firstReading = await page.locator(".node.viewing").getAttribute("data-id");
  assert.ok(firstReading);
  await centered(node(firstReading));
  const initialChatScroll = await chatViewport.evaluate((element) => element.scrollTop);
  const initialPageScroll = await page.evaluate(() => scrollY);

  await search.fill("needle");
  await expect(page.locator(".search-count")).toHaveText("1 / 4");
  await expect(node(at(5).id)).toHaveAttribute("aria-current", "true");
  await expect(search).toBeFocused();
  await previous.click();
  await expect(page.locator(".search-count")).toHaveText("4 / 4");
  await centered(node(at(105).id));
  await next.click();
  await expect(page.locator(".search-count")).toHaveText("1 / 4");
  await centered(node(at(5).id));
  await search.press("Enter");
  await expect(page.locator(".search-count")).toHaveText("2 / 4");
  await expect(node("alternative")).toHaveClass(/current-match/);
  await expect(page.locator(".preview-label")).toContainText("Other branches");
  await expect(page.locator(".preview-text")).toHaveText(branch.content);
  await search.press("Enter");
  await expect(page.locator(".search-count")).toHaveText("3 / 4");
  await centered(node(at(65).id));
  await search.press("Shift+Enter");
  await expect(node("alternative")).toHaveAttribute("aria-current", "true");
  await search.press("Enter");
  assert.equal(await chatViewport.evaluate((element) => element.scrollTop), initialChatScroll);
  assert.equal(await page.evaluate(() => scrollY), initialPageScroll);
  await expect(page.locator(`[data-virtual-list-item-key="${at(65).id}"]`)).toHaveCount(0);

  // Refresh preserves the current match's identity, input focus, and both viewport offsets.
  mock.setHistory("abcdef-2001", {
    body: payload([
      branch,
      ...historyMessages,
      { message_id: "new-match", parent_id: at(119).id, role: "ASSISTANT", content: "Needle added after refresh." },
    ]),
  });
  const beforeRefresh = await viewport.evaluate((element) => ({ top: element.scrollTop, left: element.scrollLeft }));
  await page.getByRole("button", { name: "Refresh conversation tree" }).dispatchEvent("click");
  await expect(page.locator(".node")).toHaveCount(122);
  await expect(page.locator(".search-count")).toHaveText("3 / 5");
  await expect(node(at(65).id)).toHaveAttribute("aria-current", "true");
  await expect(search).toBeFocused();
  assert.deepEqual(
    await viewport.evaluate((element) => ({ top: element.scrollTop, left: element.scrollLeft })),
    beforeRefresh,
  );

  // Reading follows real chat scrolling, but the tree stays put until the user asks to locate it.
  await chatViewport.hover();
  await page.mouse.wheel(0, 6300);
  await expect.poll(() => chatViewport.evaluate((element) => element.scrollTop)).toBe(6300);
  await expect(node(at(65).id)).toHaveClass(/viewing/);
  assert.deepEqual(
    await viewport.evaluate((element) => ({ top: element.scrollTop, left: element.scrollLeft })),
    beforeRefresh,
  );
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
  });
  await reading.click();
  await centered(node(at(65).id));
  await expect(page.locator(".preview-text")).toHaveText(at(65).content ?? "");
  await expect(page.locator(".search-count")).toHaveText("3 / 5");
  const markerStyles = await node(at(65).id).evaluate((element) => {
    const ring = element.querySelector(".ring");
    const halo = element.querySelector(".search-halo");
    if (!ring || !halo) throw new Error("Missing reading or search marker");
    return { reading: getComputedStyle(ring).stroke, search: getComputedStyle(halo).stroke };
  });
  assert.notEqual(markerStyles.reading, "rgba(0, 0, 0, 0)");
  assert.notEqual(markerStyles.search, "rgba(0, 0, 0, 0)");
  assert.notEqual(markerStyles.reading, markerStyles.search);
  assert.equal(await chatViewport.evaluate((element) => element.scrollTop), 6300);
  await page.screenshot({ path: "artifacts/tree-check/tree-navigation.png" });

  await search.fill("no such message");
  await expect(page.locator(".search-count")).toHaveText("0 / 0");
  await expect(next).toBeDisabled();
  await expect(previous).toBeDisabled();
  await search.fill("");
  await expect(page.locator(".search-navigation")).toBeHidden();
  await expect(page.locator(".current-match")).toHaveCount(0);
  await page.getByRole("button", { name: "Close conversation tree" }).click();
  await chatViewport.hover();
  await page.mouse.wheel(0, -1300);
  await expect.poll(() => chatViewport.evaluate((element) => element.scrollTop)).toBe(5000);
  await page.getByRole("button", { name: "Conversation tree", exact: true }).click();
  await expect(node(at(52).id)).toHaveClass(/viewing/);
  await centered(node(at(52).id));

  // Changing conversations clears the cursor and disables reading when no tree message is visible.
  await search.fill("needle");
  mock.setHistory("abcdef-2002", { body: { data: { biz_data: { chat_messages: [], chat_session: {} } } } });
  await page.evaluate(() => window.__mockDeepSeek.switchConversation("abcdef-2002", []));
  await expect(search).toHaveValue("");
  await expect(page.locator(".node")).toHaveCount(0);
  await expect(page.locator(".search-navigation")).toBeHidden();
  await expect(reading).toBeDisabled();
  await page.close();
  assert.deepEqual(errors, [], "Tree navigation page errors");
  await mock.assertClean();
  console.log(
    "Tree navigation check passed: search cycling, branches, keyboard, reading position, markers and refresh state.",
  );
}
