# Store assets

Upload source for the Chrome Web Store item. Keep paths stable; the dashboard references files from this directory.

## Files

- Store icon: `public/icons/icon128.png` (use directly; do not keep a second copy here)
- Small promo image: `store-assets/promo-440x280.png` (editable source: `store-assets/promo-440x280.svg`)
- Screenshots: `store-assets/screenshots/01-select-and-quote.png`, `store-assets/screenshots/02-follow-up-draft.png` (current screenshots used for the store listing, both 1280x800)
- Listing copy: `store-assets/description-en.txt` (single source; do not duplicate it elsewhere)
- Review field guide: `store-assets/privacy-dashboard-guide.txt` (single purpose, host permission, remote code, contact email verification)
- Privacy policy URL: https://jiang1997.github.io/chrome-deepseek-enchance-plugin/privacy.html

## Status

- 0.1.0 is submitted for review. The local candidate package is preserved outside Git at `release/archive/0.1.0-submitted/deepseek-enhancer-0.1.0-unpacked.zip` with `SHA256SUMS`. It has not been byte-verified against the dashboard upload; treat it as the local candidate until verified.
- Do not upload `release/archive/*.zip`, the old Chinese `deepseek-enhancer-0.1.0.zip`, or any `.crx`. The store upload is always `release/deepseek-enhancer-<version>-unpacked.zip` with `manifest.json` at the ZIP root.

## Manual verification so far

- Real-page quote flow verified: select response text, prompt appears above the composer, Quote appends `“selected text”` to the draft end, cursor stays after the quote, user sends manually.
- English UI verified.
- Not yet fully covered: all zoom levels, all editor branches, dark/light regression matrix. Do not claim full coverage.

## Release steps

Automated upload and submission via GitHub Actions: [automated publishing](automated-publishing.md).

```sh
npm install
npm test
npm run pack:zip
```

For a new version: bump `version` in `manifest.json` and `package.json`, rerun `npm run pack:zip`, upload the new `release/deepseek-enhancer-<version>-unpacked.zip` to the existing store item, and archive the uploaded ZIP with its SHA before the next build overwrites it.
