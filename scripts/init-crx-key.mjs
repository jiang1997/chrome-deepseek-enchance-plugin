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
  console.log(`签名私钥已存在：${keyPath}`);
  console.log("未生成新私钥；现有扩展 ID 将保持不变。");
  process.exit(0);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

await mkdir(path.dirname(keyPath), { recursive: true });

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });

// flag: "wx" 防止并发执行时覆盖另一进程刚创建的密钥。
await writeFile(keyPath, pem, { encoding: "utf8", mode: 0o600, flag: "wx" });
await chmod(keyPath, 0o600);

console.log(`签名私钥已生成：${keyPath}`);
console.log("请安全备份且勿提交仓库；丢失后扩展 ID 会变化，无法原地升级。");
