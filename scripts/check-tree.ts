import { chromium, type BrowserContext } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { installMockDeepSeek } from "./lib/mock-deepseek.ts";
import { checkDynamicChat } from "./lib/check-dynamic-chat.ts";

// Exercise the production extension in both execution worlds on a mocked DeepSeek origin.
// No real credentials or conversations are used.
const extension = path.resolve("dist");
const artifacts = path.resolve("artifacts/tree-check");
await mkdir(artifacts, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "dse-tree-"));
let context: BrowserContext | undefined;
let mock: Awaited<ReturnType<typeof installMockDeepSeek>> | undefined;
const errors: string[] = [];
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const fixture = (await readFile("fixtures/mock-chat.html", "utf8")).replace(
    /<script type="module">[\s\S]*?<\/script>/,
    "",
  );
  const message = (id: number, parent: number, role: "USER" | "ASSISTANT", content: string) => ({
    message_id: id,
    parent_id: parent,
    role,
    fragments: [{ type: role === "USER" ? "REQUEST" : "RESPONSE", content }],
  });
  const data = {
    data: {
      biz_data: {
        chat_messages: [
          message(1, 0, "USER", "What is a closure?"),
          message(2, 1, "ASSISTANT", "A JavaScript closure keeps the lexical environment."),
          message(5, 1, "ASSISTANT", "Alternative answer <script>window.bad = true</script>"),
          message(3, 2, "USER", "Show me an example."),
          message(4, 3, "ASSISTANT", "function outer() { const x = 1; return () => x; }"),
        ],
        chat_session: { current_message_id: 4 },
      },
    },
  };
  mock = await installMockDeepSeek(context, fixture);
  mock.setHistory("abcdef-1234", { body: data });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("https://chat.deepseek.com/a/chat/s/abcdef-1234");
  await page.evaluate(() => localStorage.setItem("userToken", JSON.stringify({ value: "test-only-token" })));
  // Quote from a partial virtual window before opening the tree: history supplies #2.
  await page.evaluate(() => {
    window.__mockDeepSeek.showRenderedWindow(["3", "4"], 500);
    const answer = document.querySelector('[data-virtual-list-item-key="4"] .ds-markdown');
    const selection = window.getSelection();
    if (!answer || !selection) throw new Error("Invalid quote fixture");
    const range = document.createRange();
    range.selectNodeContents(answer);
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.locator(".dse-popup-preview").filter({ hasText: "Selected assistant #2:" }).waitFor();
  assert.equal(mock.requests.length, 1);
  await page.getByRole("button", { name: "Quote", exact: true }).click();
  await page.waitForFunction(() => {
    const composer = document.querySelector("#composer");
    return composer instanceof HTMLTextAreaElement && composer.value.includes("[Quote · assistant #2]");
  });
  await page.evaluate(() => {
    const composer = document.querySelector("textarea#composer");
    if (!(composer instanceof HTMLTextAreaElement)) throw new Error("Invalid composer fixture");
    window.getSelection()?.removeAllRanges();
    window.__mockDeepSeek.resetMessages();
    composer.value = "";
  });
  await page.getByRole("button", { name: "Conversation tree", exact: true }).click();
  await page.locator("[data-dse-tree] .node").nth(4).waitFor();
  assert.equal(await page.locator("[data-dse-tree] .node").count(), 5);
  assert.equal(await page.locator("[data-dse-tree] .node.active").count(), 4);
  assert.equal(mock.requests.length, 1);
  // A scheduled refresh replaces SVG nodes while preserving keyboard focus.
  const keyboardNode = page.locator('[data-dse-tree] .node[data-id="3"]');
  await keyboardNode.focus();
  const beforeRefresh = await keyboardNode.elementHandle();
  assert.ok(beforeRefresh);
  await page.waitForFunction((node) => !node.isConnected, beforeRefresh, { timeout: 20000 });
  assert.equal(
    await keyboardNode.evaluate((node) => {
      const root = node.getRootNode();
      return root instanceof ShadowRoot && root.activeElement === node;
    }),
    true,
  );
  await page.keyboard.press("Enter");
  await page.getByText("Message located", { exact: true }).waitFor();
  // A remembered node must not steal focus from the search box or the page.
  const search = page.getByRole("searchbox", { name: "Search conversation messages" });
  for (const target of [search, page.locator("#composer")]) {
    await target.focus();
    const previous = await keyboardNode.elementHandle();
    assert.ok(previous);
    // Dispatch without moving focus to the refresh button.
    await page.getByRole("button", { name: "Refresh conversation tree" }).dispatchEvent("click");
    await page.waitForFunction((node) => !node.isConnected, previous);
    assert.equal(
      await target.evaluate((element) => {
        const root = element.getRootNode();
        return (root instanceof ShadowRoot ? root.activeElement : document.activeElement) === element;
      }),
      true,
    );
    await previous.dispose();
  }
  await beforeRefresh.dispose();
  await page.locator('[data-dse-tree] .node[data-id="5"]').click();
  assert.match((await page.locator("[data-dse-tree] .preview-text").textContent()) ?? "", /<script>/);
  assert.equal(await page.evaluate(() => ("bad" in window ? window.bad : undefined)), undefined);
  assert.match((await page.locator("[data-dse-tree] .preview-label").textContent()) ?? "", /Other branches/);
  await page.getByRole("searchbox", { name: "Search conversation messages" }).fill("closure");
  assert.equal(await page.locator("[data-dse-tree] .node.match").count(), 2);
  await page.getByRole("searchbox", { name: "Search conversation messages" }).fill("");
  await page.locator('[data-dse-tree] .node[data-id="3"]').click();
  await page.getByText("Message located", { exact: true }).waitFor();
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.waitForFunction(() => document.querySelector("[data-dse-tree]")?.getAttribute("data-theme") === "dark");
  await page.screenshot({ path: path.join(artifacts, "tree-dark.png") });
  await page.evaluate(() => document.documentElement.classList.replace("dark", "light"));
  await page.waitForFunction(() => document.querySelector("[data-dse-tree]")?.getAttribute("data-theme") === "light");
  await page.locator('[data-dse-tree] .node[data-id="1"]').hover();
  await page.screenshot({ path: path.join(artifacts, "tree-light.png") });
  mock.setHistory("abcdef-1234", { status: 503, body: {} });
  mock.setHistory("abcdef-5678", { status: 503, body: {} });
  await page.getByRole("button", { name: "Refresh conversation tree" }).click();
  await page.getByText("Refresh failed. Showing the previously loaded tree.").waitFor();
  assert.equal(await page.locator("[data-dse-tree] .node").count(), 5);
  // Same-document navigation clears history and rejects stale responses.
  await page.evaluate(() => {
    window.__mockDeepSeek.switchConversation("abcdef-5678", [
      { id: "1", role: "user", content: "What is a closure?" },
      { id: "2", role: "assistant", content: "A closure keeps the lexical environment." },
      { id: "3", role: "user", content: "Show me an example." },
      { id: "4", role: "assistant", content: "function outer() {}" },
    ]);
  });
  await page.getByText("Could not load full history. Showing rendered messages; try refreshing.").waitFor();
  assert.equal(await page.locator("[data-dse-tree] .node").count(), 4);
  assert.equal(await page.locator("[data-dse-tree] .edge").count(), 0);
  await page.getByRole("button", { name: "Close conversation tree" }).click();
  assert.equal(await page.getByRole("button", { name: "Conversation tree", exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "Conversation tree", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search conversation messages" }).press("Escape");
  assert.equal(await page.getByRole("button", { name: "Conversation tree", exact: true }).isVisible(), true);
  await page.close();
  await checkDynamicChat(context, mock);
  assert.deepEqual(errors, []);
  console.log(
    "Production extension check passed: history bridge, quote ordinals, shared cache, branches, search, preview, navigation, fallback, themes, keyboard and message jump.",
  );
} catch (error) {
  const diagnostics: Promise<unknown>[] = [
    writeFile(path.join(artifacts, "requests.json"), JSON.stringify(mock?.requests ?? [], null, 2)),
    writeFile(
      path.join(artifacts, "failure.txt"),
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n\nPage errors:\n${errors.join("\n")}\n`,
    ),
  ];
  if (context) {
    diagnostics.push(context.tracing.stop({ path: path.join(artifacts, "trace.zip") }));
    for (const [index, page] of context.pages().entries()) {
      diagnostics.push(page.screenshot({ path: path.join(artifacts, `failure-${index}.png`), timeout: 5000 }));
    }
  }
  for (const result of await Promise.allSettled(diagnostics)) {
    if (result.status === "rejected") console.error("Could not save browser check diagnostic:", result.reason);
  }
  throw error;
} finally {
  try {
    await context?.close();
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}
