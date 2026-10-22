import { readFile } from "node:fs/promises";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireRecord(value: unknown, label: string) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

export function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

export function isMissingFile(value: unknown): value is Error & { code: "ENOENT" } {
  return value instanceof Error && "code" in value && value.code === "ENOENT";
}

export async function readVersion(filePath: string) {
  const data = requireRecord(JSON.parse(await readFile(filePath, "utf8")), filePath);
  const version = requireString(data.version, `${filePath} version`);
  if (!/^\d+(?:\.\d+){0,3}$/.test(version)) throw new Error(`Invalid manifest version: ${version}`);
  return version;
}
