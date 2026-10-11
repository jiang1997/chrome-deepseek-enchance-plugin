import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Exercise the production extension in both execution worlds on a mocked DeepSeek origin.
// No real credentials or conversations are used.
const extension = path.resolve('dist');
const profile = await mkdtemp(path.join(tmpdir(), 'dse-tree-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const errors = [];
try {
  const fixture = (await readFile('fixtures/mock-chat.html', 'utf8')).replace(/<script type="module">[\s\S]*?<\/script>/, '');
  const message = (id, parent, role, content) => ({ message_id: id, parent_id: parent, role, fragments: [{ type: role === 'USER' ? 'REQUEST' : 'RESPONSE', content }] });
  const data = { data: { biz_data: { chat_messages: [message(1, 0, 'USER', 'What is a closure?'), message(2, 1, 'ASSISTANT', 'A JavaScript closure keeps the lexical environment.'), message(5, 1, 'ASSISTANT', 'Alternative answer <script>window.bad = true</script>'), message(3, 2, 'USER', 'Show me an example.'), message(4, 3, 'ASSISTANT', 'function outer() { const x = 1; return () => x; }')], chat_session: { current_message_id: 4 } } } };
  let fail = false;
  let requests = 0;
  await context.route('https://chat.deepseek.com/**', async route => {
    if (route.request().url().includes('/api/v0/chat/history_messages')) {
      requests++;
      assert.equal(route.request().headers().authorization, 'Bearer test-only-token');
      await route.fulfill({ status: fail ? 503 : 200, contentType: 'application/json', body: JSON.stringify(data) });
    } else await route.fulfill({ contentType: 'text/html', body: fixture });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://chat.deepseek.com/a/chat/s/abcdef-1234');
  await page.evaluate(() => localStorage.setItem('userToken', JSON.stringify({ value: 'test-only-token' })));
  // Quote from a partial virtual window before opening the tree: history supplies #2.
  const originalMessages = await page.locator('.ds-virtual-list-visible-items').innerHTML();
  await page.evaluate(() => {
    for (const id of ['1', '2']) document.querySelector(`[data-virtual-list-item-key="${id}"]`).remove();
    document.querySelector('.ds-virtual-list-visible-items').style.setProperty('--dsl-virtual-list-transform-y', '500px');
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('[data-virtual-list-item-key="4"] .ds-markdown'));
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.locator('.dse-popup-preview').filter({ hasText: 'Selected assistant #2:' }).waitFor();
  assert.equal(requests, 1);
  await page.getByRole('button', { name: 'Quote', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#composer').value.includes('[Quote · assistant #2]'));
  await page.evaluate(html => {
    window.getSelection().removeAllRanges();
    document.querySelector('.ds-virtual-list-visible-items').innerHTML = html;
    document.querySelector('.ds-virtual-list-visible-items').style.setProperty('--dsl-virtual-list-transform-y', '0px');
    document.querySelector('#composer').value = '';
  }, originalMessages);
  await page.getByRole('button', { name: 'Conversation tree', exact: true }).click();
  await page.locator('[data-dse-tree] .node').nth(4).waitFor();
  assert.equal(await page.locator('[data-dse-tree] .node').count(), 5);
  assert.equal(await page.locator('[data-dse-tree] .node.active').count(), 4);
  assert.equal(requests, 1);
  await page.locator('[data-dse-tree] .node[data-id="5"]').click();
  assert.match(await page.locator('[data-dse-tree] .preview-text').textContent(), /<script>/);
  assert.equal(await page.evaluate(() => window.bad), undefined);
  assert.match(await page.locator('[data-dse-tree] .preview-label').textContent(), /Other branches/);
  await page.getByRole('searchbox', { name: 'Search conversation messages' }).fill('closure');
  assert.equal(await page.locator('[data-dse-tree] .node.match').count(), 2);
  await page.getByRole('searchbox', { name: 'Search conversation messages' }).fill('');
  await page.locator('[data-dse-tree] .node[data-id="3"]').click();
  await page.getByText('Message located', { exact: true }).waitFor();
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.waitForFunction(() => document.querySelector('[data-dse-tree]')?.getAttribute('data-theme') === 'dark');
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/tree-dark.png' });
  await page.evaluate(() => document.documentElement.classList.replace('dark', 'light'));
  await page.waitForFunction(() => document.querySelector('[data-dse-tree]')?.getAttribute('data-theme') === 'light');
  await page.locator('[data-dse-tree] .node[data-id="1"]').hover();
  await page.screenshot({ path: 'artifacts/tree-light.png' });
  fail = true;
  await page.getByRole('button', { name: 'Refresh conversation tree' }).click();
  await page.getByText('Refresh failed. Showing the previously loaded tree.').waitFor();
  assert.equal(await page.locator('[data-dse-tree] .node').count(), 5);
  // Same-document navigation clears history and rejects stale responses.
  await page.evaluate(() => { history.pushState({}, '', '/a/chat/s/abcdef-5678'); document.querySelector('main').append(document.createElement('div')); });
  await page.getByText('Could not load full history. Showing rendered messages; try refreshing.').waitFor();
  assert.equal(await page.locator('[data-dse-tree] .node').count(), 4);
  assert.equal(await page.locator('[data-dse-tree] .edge').count(), 0);
  await page.getByRole('button', { name: 'Close conversation tree' }).click();
  assert.equal(await page.getByRole('button', { name: 'Conversation tree', exact: true }).isVisible(), true);
  await page.getByRole('button', { name: 'Conversation tree', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search conversation messages' }).press('Escape');
  assert.equal(await page.getByRole('button', { name: 'Conversation tree', exact: true }).isVisible(), true);
  assert.deepEqual(errors, []);
  console.log('Production extension check passed: history bridge, quote ordinals, shared cache, branches, search, preview, navigation, fallback, themes, keyboard and message jump.');
} finally {
  await context.close(); await rm(profile, { recursive: true, force: true });
}
