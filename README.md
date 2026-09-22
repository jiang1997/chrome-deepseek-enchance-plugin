# DeepSeek Enhancer (MVP v0.1.0)

Select text in a DeepSeek response → click "Quote" → the text is inserted into the composer so you can keep asking. Runs entirely locally and uploads nothing.

## Install (development mode)

1. `npm install`
2. `npm run build` (output in `dist/`)
3. Open `chrome://extensions` in Chrome → enable Developer mode → "Load unpacked" → select `dist/`.
4. Open `https://chat.deepseek.com/` to verify.

## Check list

- Drag-select in a normal answer / list / heading / code block → a "Quote" button appears nearby and stays on screen;
- Clicking it inserts the quote as `“content”\n\n` into the correct bottom composer;
- Existing drafts are not lost; the quote is inserted at the current cursor and the cursor stays after it so you can keep typing;
- Clicking blank space / scrolling / zooming / Esc hides the button;
- Selecting text inside the composer shows no button; over-long selections (>5000 characters) are rejected with a hint;
- Typing / deleting / sending / refreshing / starting a new conversation keeps working, with no console errors and no automatic sending.

Mock page: `fixtures/mock-chat.html` (with a history answer, a sidebar search box, and a bottom composer).

## Commands

- `npm test`: Vitest unit tests (quote / selection / popup / composer)
- `npm run typecheck`: TypeScript type checking
- `npm run build`: production build
- `npm run dev`: development build (HMR)

## Privacy

- The content script runs only on `chat.deepseek.com`; it requests no `tabs/storage/cookies` or network permissions;
- It does not collect, upload, or persist chat content; quoted text is kept only in an in-memory snapshot and cleared after the click.

## Known limitations

- The real DeepSeek composer type (textarea vs contenteditable / ProseMirror / Lexical) needs to be verified in DevTools on the live page before adding preferred selectors (see `src/adapters/deepseek-composer.ts`);
- React controlled components are synced via the native setter + `input` event, but re-render persistence still needs verification on the live page;
- Dark theme and 80%/125% zoom need manual regression testing.
