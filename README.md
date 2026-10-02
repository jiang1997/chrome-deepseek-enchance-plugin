# DeepSeek Enhancer

Select text in a DeepSeek response and quote it into the composer to keep asking. The extension runs locally and does not upload chat content.

## How it works

1. Select text in a response on `https://chat.deepseek.com/`.
2. A prompt matching the composer's width appears directly above the composer, with a preview and a Quote button.
3. Click Quote. The text is appended to your draft as `“selected text”`, with the cursor after the quote.
4. Keep typing, edit the quote, and send the message yourself. Existing draft text is preserved.

## Install from a ZIP file

```sh
npm install
npm run pack:zip
```

The output is `release/deepseek-enhancer-<version>-unpacked.zip` (ignored by Git). To install it:

1. Extract the ZIP file to a permanent directory.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the extracted directory that directly contains `manifest.json`.

Keep the extracted directory in place after installation.

## Install from source

```sh
npm install
npm run build
```

Then use **Load unpacked** in `chrome://extensions` and select the generated `dist/` directory.

## Check the extension

- Select text in a response, including a list or code block. A prompt should appear above the composer.
- Click Quote. The composer appends the text; the cursor stays after it.
- Existing draft text stays intact. You can keep typing, edit, and send manually.
- Clicking elsewhere or pressing Escape hides the prompt. Scrolling and resizing keep it aligned.
- Selecting text inside the composer shows no prompt. Selections over 5,000 characters are rejected.

`fixtures/mock-chat.html` provides a mock conversation for local checks. `npm run inspect:deepseek` runs a read-only diagnostic against the live DeepSeek page (reachability plus composer candidates); it loads no extension and asserts no quote behavior.

Verified so far: real-page quote flow and English UI. Not yet fully covered: every zoom level, every editor branch, and the full dark/light regression matrix.

## Development commands

- `npm test`: run unit tests with Vitest.
- `npm run typecheck`: check TypeScript types.
- `npm run build`: create the production extension in `dist/`.
- `npm run inspect:deepseek`: diagnose the live DeepSeek page structure; screenshots go to `artifacts/`.
- `npm run pack:zip`: build the store upload ZIP.

Store listing sources, screenshots, and release steps: `store-assets/README.md`.

## Optional local CRX

For managed or automated local distribution only; the Chrome Web Store does not need it:

```sh
npm run init:crx-key
npm run pack:crx
```

The private key at `keys/deepseek-enhancer.pem` is gitignored. Back it up; losing it changes the extension ID for CRX installs. Store signing is managed separately by Google.

## Privacy

The content script runs only on `chat.deepseek.com`. The extension requests no tabs, storage, cookies, or network permissions. Selected text and the existing draft are processed locally for the quote feature. The extension does not transmit this content to the developer or persist it in storage.

Privacy policy: https://jiang1997.github.io/chrome-deepseek-enchance-plugin/privacy.html

## Limitations

DeepSeek may change its composer or page structure. Dark mode and browser zoom still need full manual regression coverage.
