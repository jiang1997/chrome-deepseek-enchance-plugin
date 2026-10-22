import { readFile, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { requireRecord, requireString, readVersion } from "./lib/validation.ts";

export type StoreFetch = (url: string, options: RequestInit) => Promise<Pick<Response, "ok" | "status" | "text">>;

type StoreStatus = {
  submittedItemRevisionStatus?: { state?: string | undefined } | undefined;
  lastAsyncUploadState?: string | undefined;
  publishedItemRevisionStatus?:
    | {
        distributionChannels?: { crxVersion?: string | undefined }[] | undefined;
      }
    | undefined;
};

type StoreOptions = {
  mode: string;
  token: string | undefined;
  publisherId: string;
  extensionId: string;
  version?: string | undefined;
  zip?: Uint8Array<ArrayBuffer> | undefined;
  fetchImpl?: StoreFetch;
  sleep?: (ms: number) => Promise<void>;
  maxPolls?: number;
};

type StoreResult =
  | { mode: "status"; status: StoreStatus }
  | { mode: "upload"; version: string; uploadState: string }
  | {
      mode: "publish" | "staged";
      version: string;
      uploadState: string;
      submission: Record<string, unknown>;
    };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modes = ["status", "upload", "publish", "staged"];

export function compareVersions(left: string, right: string) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let i = 0; i < 4; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

function optionalString(value: unknown, label: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

/** Validate fields used for release decisions; preserve the rest of the status response. */
function validateStatus(status: Record<string, unknown>): StoreStatus {
  optionalString(status.lastAsyncUploadState, "Last upload state");
  if (status.submittedItemRevisionStatus !== undefined) {
    const submitted = requireRecord(status.submittedItemRevisionStatus, "Submitted revision");
    optionalString(submitted.state, "Submitted revision state");
  }
  if (status.publishedItemRevisionStatus !== undefined) {
    const published = requireRecord(status.publishedItemRevisionStatus, "Published revision");
    const channels = published.distributionChannels;
    if (channels !== undefined) {
      if (!Array.isArray(channels)) throw new Error("Distribution channels must be an array");
      for (const channel of channels) {
        optionalString(requireRecord(channel, "Distribution channel").crxVersion, "Published version");
      }
    }
  }
  return status as StoreStatus;
}

// fetch and sleep are injectable so tests never contact the store.
export async function runStoreOperation({
  mode,
  token,
  publisherId,
  extensionId,
  version,
  zip,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxPolls = 60,
}: StoreOptions): Promise<StoreResult> {
  if (mode !== "status" && mode !== "upload" && mode !== "publish" && mode !== "staged") {
    throw new Error(`Choose a mode: ${modes.join(", ")}`);
  }
  if (!token) throw new Error("CWS_ACCESS_TOKEN is required");
  const accessToken = token;
  if (!/^[a-p]{32}$/.test(extensionId) || !/^[a-zA-Z0-9-]+$/.test(publisherId)) {
    throw new Error("Invalid publisher or extension ID");
  }
  const item = `publishers/${publisherId}/items/${extensionId}`;
  const api = `https://chromewebstore.googleapis.com/v2/${item}`;
  async function request(url: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    const response = await fetchImpl(url, {
      ...options,
      headers,
      signal: AbortSignal.timeout(120_000),
    });
    const text = await response.text();
    // Never include a token, even if a server/proxy echoes it in an error.
    const safeText = text.replaceAll(accessToken, "[REDACTED]");
    if (!response.ok) throw new Error(`Chrome Web Store HTTP ${response.status}: ${safeText}`);
    return requireRecord(JSON.parse(safeText), "Chrome Web Store response");
  }

  const status = validateStatus(await request(`${api}:fetchStatus`));
  if (mode === "status") return { mode, status };
  if (!zip?.length || !version || !/^\d+(?:\.\d+){0,3}$/.test(version)) {
    throw new Error("A store ZIP and valid manifest version are required");
  }
  const submitted = status.submittedItemRevisionStatus;
  if (submitted && ["PENDING_REVIEW", "STAGED"].includes(submitted.state ?? "")) {
    throw new Error(`Existing submission is ${submitted.state}; resolve it in the dashboard first`);
  }
  if (["IN_PROGRESS", "UPLOAD_IN_PROGRESS"].includes(status.lastAsyncUploadState ?? "")) {
    throw new Error("An existing upload is still processing; wait before uploading again");
  }
  for (const channel of status.publishedItemRevisionStatus?.distributionChannels ?? []) {
    if (channel.crxVersion && compareVersions(version, channel.crxVersion) <= 0) {
      throw new Error(`Version ${version} must be greater than published ${channel.crxVersion}`);
    }
  }
  const upload = await request(`https://chromewebstore.googleapis.com/upload/v2/${item}:upload`, {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: zip,
  });
  let uploadState = optionalString(upload.uploadState, "Upload state");
  for (
    let attempt = 0;
    ["IN_PROGRESS", "UPLOAD_IN_PROGRESS"].includes(uploadState ?? "") && attempt < maxPolls;
    attempt++
  ) {
    await sleep(5000);
    uploadState = validateStatus(await request(`${api}:fetchStatus`)).lastAsyncUploadState;
  }
  if (!uploadState || !["SUCCEEDED", "UPLOAD_SUCCESS"].includes(uploadState)) {
    throw new Error(`Upload did not succeed (${uploadState ?? "unknown"}); no publish request was sent`);
  }
  const uploadedVersion = optionalString(upload.crxVersion, "Uploaded version");
  if (uploadedVersion && uploadedVersion !== version) {
    throw new Error(`Uploaded version ${uploadedVersion} does not match ${version}; no publish request was sent`);
  }
  if (mode === "upload") return { mode, version, uploadState };
  const submission = await request(`${api}:publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publishType: mode === "staged" ? "STAGED_PUBLISH" : "DEFAULT_PUBLISH",
      skipReview: false,
      blockOnWarnings: true,
    }),
  });
  return { mode, version, uploadState, submission };
}

async function main() {
  const config = requireRecord(
    JSON.parse(await readFile(path.join(root, "scripts/cws-config.json"), "utf8")),
    "Publishing configuration",
  );
  const publisherId = requireString(config.publisherId, "Publisher ID");
  const extensionId = requireString(config.extensionId, "Extension ID");
  const mode = process.env.CWS_MODE ?? "status";
  let version: string | undefined;
  let zip: Uint8Array<ArrayBuffer> | undefined;
  if (mode !== "status") {
    version = await readVersion(path.join(root, "manifest.json"));
    const packageVersion = await readVersion(path.join(root, "package.json"));
    const builtVersion = await readVersion(path.join(root, "dist/manifest.json"));
    if (packageVersion !== version || builtVersion !== version) {
      throw new Error("package.json, manifest.json and dist/manifest.json versions must match");
    }
    zip = await readFile(path.join(root, `release/deepseek-enhancer-${version}-unpacked.zip`));
    console.log(`Package version: ${version}; SHA256: ${createHash("sha256").update(zip).digest("hex")}`);
  }
  const result = await runStoreOperation({
    publisherId,
    extensionId,
    mode,
    version,
    zip,
    token: process.env.CWS_ACCESS_TOKEN,
  });
  const output = JSON.stringify(result, null, 2);
  console.log(output);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Chrome Web Store\n\n\`\`\`json\n${output}\n\`\`\`\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
