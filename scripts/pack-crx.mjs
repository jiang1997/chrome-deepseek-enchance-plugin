import { chmod, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crx3 from "crx3";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "dist", "manifest.json");
const defaultKeyPath = path.join(root, "keys", "deepseek-enhancer.pem");
const keyPath = path.resolve(process.env.CRX_KEY_PATH || defaultKeyPath);

async function requireFile(filePath, message) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error(`${filePath} is not a file`);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(message);
    throw error;
  }
}

function listZipEntries(buffer) {
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const minimumEocdSize = 22;
  const maximumCommentSize = 0xffff;
  let eocdOffset = -1;

  if (buffer.length < minimumEocdSize) {
    throw new Error("ZIP validation failed: file is too short");
  }

  for (
    let offset = buffer.length - minimumEocdSize;
    offset >= Math.max(0, buffer.length - minimumEocdSize - maximumCommentSize);
    offset -= 1
  ) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset < 0) throw new Error("ZIP validation failed: missing central directory");

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== centralSignature) {
      throw new Error("ZIP validation failed: invalid central directory entry");
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const name = buffer.toString("utf8", nameStart, nameStart + nameLength);
    entries.push(name);
    offset = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function validateArtifacts(crxPath, zipPath) {
  const [crx, zip] = await Promise.all([readFile(crxPath), readFile(zipPath)]);
  if (crx.length < 12 || crx.toString("ascii", 0, 4) !== "Cr24") {
    throw new Error("CRX validation failed: invalid file header");
  }
  if (crx.readUInt32LE(4) !== 3) {
    throw new Error("CRX validation failed: artifact is not CRX3");
  }

  const zipOffset = 12 + crx.readUInt32LE(8);
  if (zipOffset >= crx.length || !crx.subarray(zipOffset).equals(zip)) {
    throw new Error("CRX validation failed: signature payload does not match the ZIP artifact");
  }

  const entries = listZipEntries(zip);
  if (!entries.includes("manifest.json")) {
    throw new Error("Archive validation failed: manifest.json is missing from the root");
  }
  if (entries.some((entry) => path.isAbsolute(entry) || entry.split("/").includes(".."))) {
    throw new Error("Archive validation failed: contains an unsafe path");
  }

  return entries;
}

async function main() {
  await requireFile(manifestPath, `Cannot find ${manifestPath}; run npm run build first`);
  await requireFile(
    keyPath,
    `Cannot find signing key ${keyPath}; run npm run init:crx-key first, or specify a key via CRX_KEY_PATH`,
  );
  await chmod(keyPath, 0o600);

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (typeof manifest.version !== "string" || !/^\d+(?:\.\d+){0,3}$/.test(manifest.version)) {
    throw new Error(`Invalid manifest version: ${String(manifest.version)}`);
  }

  const releaseDir = path.join(root, "release");
  const artifactBase = `deepseek-enhancer-${manifest.version}`;
  const crxPath = path.join(releaseDir, `${artifactBase}.crx`);
  const zipPath = path.join(releaseDir, `${artifactBase}.zip`);
  await mkdir(releaseDir, { recursive: true });

  const info = await crx3([manifestPath], { keyPath, crxPath, zipPath });
  const entries = await validateArtifacts(crxPath, zipPath);

  console.log(`CRX: ${info.crxPath ?? crxPath}`);
  console.log(`ZIP: ${info.zipPath ?? zipPath}`);
  console.log(`Extension ID: ${info.appId}`);
  console.log(`Archive validation passed: ${entries.length} files, including manifest.json at the root`);
}

try {
  await main();
} catch (error) {
  console.error(`Packaging failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
