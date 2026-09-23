import { generateKeyPairSync } from "node:crypto";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultKeyPath = path.join(root, "keys", "deepseek-enhancer.pem");
const keyPath = path.resolve(process.env.CRX_KEY_PATH || defaultKeyPath);

try {
  await access(keyPath);
  await chmod(keyPath, 0o600);
  console.log(`Signing key already exists: ${keyPath}`);
  console.log("No new key generated; the existing extension ID stays the same.");
  process.exit(0);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

await mkdir(path.dirname(keyPath), { recursive: true });

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });

// flag: "wx" prevents overwriting a key another process just created during concurrent runs.
await writeFile(keyPath, pem, { encoding: "utf8", mode: 0o600, flag: "wx" });
await chmod(keyPath, 0o600);

console.log(`Signing key generated: ${keyPath}`);
console.log("Back it up safely and do not commit it; losing it changes the extension ID and prevents in-place upgrades.");
