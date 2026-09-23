import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yazl from "yazl";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const manifestPath = path.join(distDir, "manifest.json");

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(absolutePath)));
    else if (entry.isFile()) files.push(absolutePath);
  }

  return files;
}

async function createZip(files, outputPath) {
  const zip = new yazl.ZipFile();
  const output = createWriteStream(outputPath, { mode: 0o644 });

  const completion = new Promise((resolve, reject) => {
    output.once("close", resolve);
    output.once("error", reject);
    zip.outputStream.once("error", reject);
  });

  zip.outputStream.pipe(output);
  for (const filePath of files) {
    // ZIP 内统一使用 POSIX 分隔符，并让 manifest.json 位于根目录。
    const archivePath = path.relative(distDir, filePath).split(path.sep).join("/");
    zip.addFile(filePath, archivePath, { compressionLevel: 9 });
  }
  zip.end();
  await completion;
}

async function main() {
  const manifestStat = await stat(manifestPath).catch((error) => {
    if (error?.code === "ENOENT") {
      throw new Error(`未找到 ${manifestPath}，请先执行 npm run build`);
    }
    throw error;
  });
  if (!manifestStat.isFile()) throw new Error(`${manifestPath} 不是文件`);

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (typeof manifest.version !== "string" || !/^\d+(?:\.\d+){0,3}$/.test(manifest.version)) {
    throw new Error(`manifest version 无效：${String(manifest.version)}`);
  }

  const files = await collectFiles(distDir);
  if (!files.some((filePath) => path.relative(distDir, filePath) === "manifest.json")) {
    throw new Error("打包失败：dist 根目录缺少 manifest.json");
  }

  const releaseDir = path.join(root, "release");
  const zipPath = path.join(releaseDir, `deepseek-enhancer-${manifest.version}-unpacked.zip`);
  await mkdir(releaseDir, { recursive: true });
  await createZip(files, zipPath);

  const zipStat = await stat(zipPath);
  if (!zipStat.isFile() || zipStat.size === 0) throw new Error("ZIP 产物为空");

  console.log(`开发者模式安装包：${zipPath}`);
  console.log(`已打包 ${files.length} 个文件；请先解压，再加载包含 manifest.json 的目录。`);
}

try {
  await main();
} catch (error) {
  console.error(`打包失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
