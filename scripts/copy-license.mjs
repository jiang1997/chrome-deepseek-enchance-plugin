import { copyFile } from "node:fs/promises";

// Keep the copyright and permission notice in every packaged build.
await copyFile(
  new URL("../LICENSE", import.meta.url),
  new URL("../dist/LICENSE", import.meta.url),
);
