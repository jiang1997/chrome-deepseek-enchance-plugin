import { readFile } from "node:fs/promises";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @param {string} label */
export function requireRecord(value, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

/** @param {unknown} value @param {string} label */
export function requireString(value, label) {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}

/** @param {unknown} value @returns {value is Error & { code: "ENOENT" }} */
export function isMissingFile(value) {
  return value instanceof Error && "code" in value && value.code === "ENOENT";
}

/** @param {string} filePath */
export async function readVersion(filePath) {
  const data = requireRecord(JSON.parse(await readFile(filePath, "utf8")), filePath);
  const version = requireString(data.version, `${filePath} version`);
  if (!/^\d+(?:\.\d+){0,3}$/.test(version)) throw new Error(`Invalid manifest version: ${version}`);
  return version;
}
