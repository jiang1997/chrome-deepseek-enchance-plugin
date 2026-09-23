# DeepSeek Enhancer

DeepSeek Enhancer is a Chrome extension in early development. Select text in a DeepSeek response, click the floating quote button, and the selected text is inserted into the message composer so you can continue asking about it. The extension runs locally and does not upload chat content.

## Install from a ZIP file

Build a ZIP file without a signing key:

```sh
npm install
npm run pack:zip
```

The output is `release/deepseek-enhancer-<version>-unpacked.zip`. To install it:

1. Extract the ZIP file to a permanent directory.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the extracted directory that directly contains `manifest.json`.

Chrome cannot load the ZIP file directly. Keep the extracted directory in place after installation. To update the extension, replace its contents with the files from a newer ZIP and click **Reload** on the extension's card.

## Install from the source directory

Run `npm install` and `npm run build`, then use **Load unpacked** in `chrome://extensions` and select the generated `dist/` directory. Open `https://chat.deepseek.com/` to try the extension.

## Package for distribution

To produce a signed CRX file, first create a signing key:

```sh
npm run init:crx-key
npm run pack:crx
```

This creates two versioned files in `release/`:

- `deepseek-enhancer-<version>.zip` for uploading to the Chrome Web Store.
- `deepseek-enhancer-<version>.crx` for Linux, managed enterprise deployments, or automation.

The CRX is a single distribution file containing the extension's manifest, JavaScript, and CSS. Chrome does not allow ordinary macOS and Windows users to install a locally signed CRX directly. Use **Load unpacked** for local development on those platforms, or distribute through the Chrome Web Store.

The private key is stored at `keys/deepseek-enhancer.pem` with owner-only permissions. Keep it backed up and out of version control: losing it changes the extension ID and prevents updates to installations signed with the old key. `npm run pack:crx` fails if the key is missing. In CI, set `CRX_KEY_PATH` to a private key restored from a secret.

## Check the extension

- Select text in a response, including a list or code block. The Quote button should appear near the selection and stay within the viewport.
- Click Quote. The composer should receive the text as `“selected text”\n\n`, with the cursor after the quote.
- Existing draft text should remain intact. You should be able to keep typing, edit the quote, and send the message yourself.
- Clicking elsewhere, scrolling, resizing, or pressing Escape should hide the button.
- Selecting text inside the composer should not show the button. Selections over 5,000 characters should be rejected.

`fixtures/mock-chat.html` provides a mock conversation for local checks.

## Development commands

- `npm test`: run unit tests with Vitest.
- `npm run typecheck`: check TypeScript types.
- `npm run build`: create the production extension in `dist/`.
- `npm run dev`: start the Vite development build.
- `npm run pack:zip`: build a ZIP for extraction and installation with **Load unpacked**.
- `npm run init:crx-key`: create the CRX signing key once.
- `npm run pack:crx`: build versioned ZIP and CRX files (requires Node.js 22 or newer).

## Privacy

The content script runs only on `chat.deepseek.com`. The extension requests no tabs, storage, cookies, or network permissions. Selected text is held in memory for the quote action; it is not collected, uploaded, or persisted.

## Current limitations

DeepSeek may change its message composer or page structure. The composer adapter still needs validation against the live site, especially for controlled or rich-text editors. Dark mode and browser zoom levels also need manual regression testing.
