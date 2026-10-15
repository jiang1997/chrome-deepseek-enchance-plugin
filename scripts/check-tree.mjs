import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Exercise the production extension in both execution worlds on a mocked DeepSeek origin.
// No real credentials or conversations are used.
const extension = path.resolve("dist");
const artifacts = path.resolve("artifacts/tree-check");
await mkdir(artifacts, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "dse-tree-"));
/** @type {import('@playwright/test').BrowserContext | undefined} */
let context;
/** @type {string[]} */
const errors = [];
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
  /** @param {number} id @param {number} parent @param {'USER' | 'ASSISTANT'} role @param {string} content */
  const message = (id, parent, role, content) => ({
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
  let fail = false;
  let requests = 0;
  await context.route("https://chat.deepseek.com/**", async (route) => {
    if (route.request().url().includes("/api/v0/chat/history_messages")) {
      requests++;
      assert.equal(route.request().headers().authorization, "Bearer test-only-token");
      await route.fulfill({ status: fail ? 503 : 200, contentType: "application/json", body: JSON.stringify(data) });
    } else await route.fulfill({ contentType: "text/html", body: fixture });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("https://chat.deepseek.com/a/chat/s/abcdef-1234");
  await page.evaluate(() => localStorage.setItem("userToken", JSON.stringify({ value: "test-only-token" })));
  // Quote from a partial virtual window before opening the tree: history supplies #2.
  const originalMessages = await page.locator(".ds-virtual-list-visible-items").innerHTML();
  await page.evaluate(() => {
    for (const id of ["1", "2"]) {
      const item = document.querySelector(`[data-virtual-list-item-key="${id}"]`);
      if (!item) throw new Error(`Fixture is missing message ${id}`);
      item.remove();
    }
    const items = document.querySelector(".ds-virtual-list-visible-items");
    const answer = document.querySelector('[data-virtual-list-item-key="4"] .ds-markdown');
    const selection = window.getSelection();
    if (!(items instanceof HTMLElement) || !answer || !selection) throw new Error("Invalid quote fixture");
    items.style.setProperty("--dsl-virtual-list-transform-y", "500px");
    const range = document.createRange();
    range.selectNodeContents(answer);
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.locator(".dse-popup-preview").filter({ hasText: "Selected assistant #2:" }).waitFor();
  assert.equal(requests, 1);
  await page.getByRole("button", { name: "Quote", exact: true }).click();
  await page.waitForFunction(() => {
    const composer = document.querySelector("#composer");
    return composer instanceof HTMLTextAreaElement && composer.value.includes("[Quote · assistant #2]");
  });
  await page.evaluate((html) => {
    const selection = window.getSelection();
    const items = document.querySelector(".ds-virtual-list-visible-items");
    const composer = document.querySelector("textarea#composer");
    if (!selection || !(items instanceof HTMLElement) || !(composer instanceof HTMLTextAreaElement)) {
      throw new Error("Invalid composer fixture");
    }
    selection.removeAllRanges();
    items.innerHTML = html;
    items.style.setProperty("--dsl-virtual-list-transform-y", "0px");
    composer.value = "";
  }, originalMessages);
  await page.getByRole("button", { name: "Conversation tree", exact: true }).click();
  await page.locator("[data-dse-tree] .node").nth(4).waitFor();
  assert.equal(await page.locator("[data-dse-tree] .node").count(), 5);
  assert.equal(await page.locator("[data-dse-tree] .node.active").count(), 4);
  assert.equal(requests, 1);
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
  fail = true;
  await page.getByRole("button", { name: "Refresh conversation tree" }).click();
  await page.getByText("Refresh failed. Showing the previously loaded tree.").waitFor();
  assert.equal(await page.locator("[data-dse-tree] .node").count(), 5);
  // Same-document navigation clears history and rejects stale responses.
  await page.evaluate(() => {
    history.pushState({}, "", "/a/chat/s/abcdef-5678");
    const main = document.querySelector("main");
    if (!main) throw new Error("Fixture is missing main");
    main.append(document.createElement("div"));
  });
  await page.getByText("Could not load full history. Showing rendered messages; try refreshing.").waitFor();
  assert.equal(await page.locator("[data-dse-tree] .node").count(), 4);
  assert.equal(await page.locator("[data-dse-tree] .edge").count(), 0);
  await page.getByRole("button", { name: "Close conversation tree" }).click();
  assert.equal(await page.getByRole("button", { name: "Conversation tree", exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "Conversation tree", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search conversation messages" }).press("Escape");
  assert.equal(await page.getByRole("button", { name: "Conversation tree", exact: true }).isVisible(), true);
  assert.deepEqual(errors, []);
  console.log(
    "Production extension check passed: history bridge, quote ordinals, shared cache, branches, search, preview, navigation, fallback, themes, keyboard and message jump.",
  );
} catch (error) {
  /** @type {Promise<unknown>[]} */
  const diagnostics = [
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
