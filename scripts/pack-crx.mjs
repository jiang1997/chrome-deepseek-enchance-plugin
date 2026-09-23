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
    if (!fileStat.isFile()) throw new Error(`${filePath} 不是文件`);
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
    throw new Error("ZIP 校验失败：文件过短");
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

  if (eocdOffset < 0) throw new Error("ZIP 校验失败：缺少中央目录");

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== centralSignature) {
      throw new Error("ZIP 校验失败：中央目录条目无效");
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
    throw new Error("CRX 校验失败：文件头无效");
  }
  if (crx.readUInt32LE(4) !== 3) {
    throw new Error("CRX 校验失败：产物不是 CRX3");
  }

  const zipOffset = 12 + crx.readUInt32LE(8);
  if (zipOffset >= crx.length || !crx.subarray(zipOffset).equals(zip)) {
    throw new Error("CRX 校验失败：签名负载与 ZIP 产物不一致");
  }

  const entries = listZipEntries(zip);
  if (!entries.includes("manifest.json")) {
    throw new Error("归档校验失败：根目录缺少 manifest.json");
  }
  if (entries.some((entry) => path.isAbsolute(entry) || entry.split("/").includes(".."))) {
    throw new Error("归档校验失败：包含不安全路径");
  }

  return entries;
}

async function main() {
  await requireFile(manifestPath, `未找到 ${manifestPath}，请先执行 npm run build`);
  await requireFile(
    keyPath,
    `未找到签名私钥 ${keyPath}，请先执行 npm run init:crx-key，或通过 CRX_KEY_PATH 指定私钥`,
  );
  await chmod(keyPath, 0o600);

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (typeof manifest.version !== "string" || !/^\d+(?:\.\d+){0,3}$/.test(manifest.version)) {
    throw new Error(`manifest version 无效：${String(manifest.version)}`);
  }

  const releaseDir = path.join(root, "release");
  const artifactBase = `deepseek-enhancer-${manifest.version}`;
  const crxPath = path.join(releaseDir, `${artifactBase}.crx`);
  const zipPath = path.join(releaseDir, `${artifactBase}.zip`);
  await mkdir(releaseDir, { recursive: true });

  const info = await crx3([manifestPath], { keyPath, crxPath, zipPath });
  const entries = await validateArtifacts(crxPath, zipPath);

  console.log(`CRX：${info.crxPath ?? crxPath}`);
  console.log(`ZIP：${info.zipPath ?? zipPath}`);
  console.log(`扩展 ID：${info.appId}`);
  console.log(`归档校验通过：${entries.length} 个文件，包含根目录 manifest.json`);
}

try {
  await main();
} catch (error) {
  console.error(`打包失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
