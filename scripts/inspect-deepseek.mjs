import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Read-only diagnostic for the live DeepSeek page.
// It does NOT load the extension and asserts NO quote behavior.
// It only checks reachability, surveys composer candidates, and saves a screenshot.

const URL = "https://chat.deepseek.com/";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactsDir = path.join(root, "artifacts");
const screenshotPath = path.join(artifactsDir, "deepseek-page.png");

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
});

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });

  console.log("goto", URL);
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);

  console.log("title:", await page.title());
  console.log("url:", page.url());

  // Basic reachability
  const bodyText = (await page.textContent("body"))?.slice(0, 500);
  console.log("body-snippet:", JSON.stringify(bodyText));

  // Input candidate survey (same strategy as the extension's findComposer)
  const candidates = await page.evaluate(() => {
    const els = Array.from(
      document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'),
    );
    return els.slice(0, 20).map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role"),
        ariaLabel: el.getAttribute("aria-label"),
        placeholder: el.getAttribute("placeholder") || el.placeholder || null,
        contenteditable: el.getAttribute("contenteditable"),
        id: el.id || null,
        class: (el.className?.toString?.().slice(0, 120)) || null,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        visible: cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0,
        inAside: !!el.closest("aside,nav,header"),
        inDialog: !!el.closest('[role="dialog"]'),
      };
    });
  });
  console.log("candidates:", JSON.stringify(candidates, null, 2));

  await mkdir(artifactsDir, { recursive: true });
  await page.screenshot({ path: screenshotPath });
  console.log(`screenshot: ${path.relative(root, screenshotPath)}`);
} finally {
  await browser.close();
}
