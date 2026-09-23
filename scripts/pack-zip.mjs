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
    // Use POSIX separators inside the ZIP and keep manifest.json at the root.
    const archivePath = path.relative(distDir, filePath).split(path.sep).join("/");
    zip.addFile(filePath, archivePath, { compressionLevel: 9 });
  }
  zip.end();
  await completion;
}

async function main() {
  const manifestStat = await stat(manifestPath).catch((error) => {
    if (error?.code === "ENOENT") {
      throw new Error(`Cannot find ${manifestPath}; run npm run build first`);
    }
    throw error;
  });
  if (!manifestStat.isFile()) throw new Error(`${manifestPath} is not a file`);

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (typeof manifest.version !== "string" || !/^\d+(?:\.\d+){0,3}$/.test(manifest.version)) {
    throw new Error(`Invalid manifest version: ${String(manifest.version)}`);
  }

  const files = await collectFiles(distDir);
  if (!files.some((filePath) => path.relative(distDir, filePath) === "manifest.json")) {
    throw new Error("Packaging failed: manifest.json is missing from the dist root");
  }

  const releaseDir = path.join(root, "release");
  const zipPath = path.join(releaseDir, `deepseek-enhancer-${manifest.version}-unpacked.zip`);
  await mkdir(releaseDir, { recursive: true });
  await createZip(files, zipPath);

  const zipStat = await stat(zipPath);
  if (!zipStat.isFile() || zipStat.size === 0) throw new Error("ZIP artifact is empty");

  console.log(`Unpacked developer package: ${zipPath}`);
  console.log(`Packed ${files.length} files; extract it first, then load the directory that contains manifest.json.`);
}

try {
  await main();
} catch (error) {
  console.error(`Packaging failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
