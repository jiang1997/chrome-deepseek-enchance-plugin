# Dynamic DeepSeek fixture

`mock-chat.html` and `mock-chat.js` provide a hand-written page for local development and browser regression checks. They reproduce the message identity attributes, thinking/answer containers, composer, and scroll-driven virtual window used by the extension. They do not load DeepSeek's frontend or contact its servers.

For manual inspection, run `npm run dev` and visit `/fixtures/mock-chat.html` on the displayed local server. For the production-extension checks, run:

```sh
npm run build
npx playwright install --with-deps chromium
npm run check:tree
```

The browser check loads `dist/` in Chromium and intercepts requests at a mock `https://chat.deepseek.com` origin. The HTML's development module is removed so the extension is loaded only through its manifest. The fixture controller remains a regular page script.

## Page controls

Controls are available as `window.__mockDeepSeek` in the page console or Playwright's `page.evaluate`. Message objects use `{ id, role, content?, thinking?, answerClass? }`, with string IDs and `user`/`assistant` roles. `answerClass: false` renders an assistant answer with only `.ds-markdown`, allowing fallback selectors to be exercised.

| Method | Page behavior |
| --- | --- |
| `resetMessages()` | Restore the original four messages and disable virtualization. |
| `setMessages(messages)` | Replace rendered messages and disable virtualization. |
| `showRenderedWindow(ids, offset)` | Render a subset of the original messages with explicit virtual-list offset metadata. This is a fixed partial window; use `setVirtualMessages` for scrolling. |
| `addMessage(message)` | Append a message to a non-virtualized conversation. |
| `appendAnswer(id, text)` | Create or append to an answer, keeping its thinking block separate. |
| `replaceComposer()` | Detach the old textarea and create a new one with the same draft. |
| `setVirtualMessages(messages, rowHeight = 100, height = 300)` | Mount only visible rows plus one extra row; scrolling unmounts the previous window. |
| `switchConversation(id, messages)` | Change the SPA URL, replace the messages and composer, and clear the draft. |

Example: move from a thinking-only message to a streamed answer:

```js
window.__mockDeepSeek.setMessages([
  { id: "1", role: "user", content: "Explain closures." },
  { id: "2", role: "assistant", thinking: "Considering an example…" },
]);
window.__mockDeepSeek.appendAnswer("2", "A closure retains ");
window.__mockDeepSeek.appendAnswer("2", "its lexical environment.");
```

These controls only manipulate DOM and browser history. They do not invoke extension functions, calculate quote ordinals, populate the tree, or perform message jumps.

## Network controls and checks

`scripts/lib/mock-deepseek.ts` serves separate page, controller, and history routes. `setHistory(sessionId, { body, status?, delayMs?, gate? })` configures each session's response. A promise supplied as `gate` holds a request until the test releases it. Release gates in `finally` so failed scenarios cannot leave pending route handlers.

The server checks the history method, session query, and synthetic authorization header. It records requests and browser-reported failures, rejects unexpected HTTP(S) requests, and reports route errors at the end. No real credentials are used.

`scripts/lib/check-dynamic-chat.ts`, called by `check:tree`, exercises:

- Real mouse drag selection, composer replacement, draft preservation, input events, caret position, and subsequent typing.
- Thinking-only and streamed-answer DOM previews after a history failure, including Markdown fallback. The test uses the panel's Refresh button to read changed previews.
- Scroll-driven message unmounting and mounting, offscreen navigation with unordered IDs, and quote provenance with earlier messages absent from DOM.
- Navigation while history and quote insertion are pending, network cancellation, and a fresh lookup in the new session.
- HTTP 429/503 and an incompatible HTTP 200 payload falling back to rendered messages without inventing parent edges.

`scripts/lib/check-tree-navigation.ts` adds a 120-message virtualized conversation with an inactive branch. It verifies search result ordering and wraparound, Enter/Shift+Enter, scrolling offscreen matches into the tree viewport without moving the chat, refresh state preservation, reading-position navigation, independent search/reading styles, empty results, and resetting on conversation changes. A successful run saves `tree-navigation.png` alongside the existing theme screenshots.

Failures retain screenshots, `failure.txt`, the history request ledger `requests.json`, and `trace.zip` under `artifacts/tree-check/`, including the dynamic scenario pages.

## Fidelity limits

The virtual list uses fixed-height rows; DeepSeek's variable-height layout and scheduling can differ. Composer replacement uses a native textarea and does not reproduce framework-controlled input state. The page and API bodies are synthetic samples, not captured production fixtures. Passing these checks does not establish compatibility with the current live DOM, login state, or API contract; those need live-page validation.
