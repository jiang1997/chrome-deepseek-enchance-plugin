import { readFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modes = ['status', 'upload', 'publish', 'staged'];

export function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let i = 0; i < 4; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

// fetch and sleep are injectable so tests never contact the store.
export async function runStoreOperation({
  mode, token, publisherId, extensionId, version, zip,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxPolls = 60,
}) {
  if (!modes.includes(mode)) throw new Error(`Choose a mode: ${modes.join(', ')}`);
  if (!token) throw new Error('CWS_ACCESS_TOKEN is required');
  if (!/^[a-p]{32}$/.test(extensionId) || !/^[a-zA-Z0-9-]+$/.test(publisherId)) {
    throw new Error('Invalid publisher or extension ID');
  }
  const item = `publishers/${publisherId}/items/${extensionId}`;
  const api = `https://chromewebstore.googleapis.com/v2/${item}`;
  async function request(url, options = {}) {
    const response = await fetchImpl(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(120_000),
    });
    const text = await response.text();
    // Never include a token, even if a server/proxy echoes it in an error.
    const safeText = text.replaceAll(token, '[REDACTED]');
    if (!response.ok) throw new Error(`Chrome Web Store HTTP ${response.status}: ${safeText}`);
    return JSON.parse(safeText);
  }

  const status = await request(`${api}:fetchStatus`);
  if (mode === 'status') return { mode, status };
  if (!zip?.length || !/^\d+(?:\.\d+){0,3}$/.test(version)) {
    throw new Error('A store ZIP and valid manifest version are required');
  }
  const submitted = status.submittedItemRevisionStatus;
  if (['PENDING_REVIEW', 'STAGED'].includes(submitted?.state)) {
    throw new Error(`Existing submission is ${submitted.state}; resolve it in the dashboard first`);
  }
  if (['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(status.lastAsyncUploadState)) {
    throw new Error('An existing upload is still processing; wait before uploading again');
  }
  for (const channel of status.publishedItemRevisionStatus?.distributionChannels ?? []) {
    if (channel.crxVersion && compareVersions(version, channel.crxVersion) <= 0) {
      throw new Error(`Version ${version} must be greater than published ${channel.crxVersion}`);
    }
  }
  const upload = await request(`https://chromewebstore.googleapis.com/upload/v2/${item}:upload`, {
    method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: zip,
  });
  let uploadState = upload.uploadState;
  for (let attempt = 0; ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(uploadState) && attempt < maxPolls; attempt++) {
    await sleep(5000);
    uploadState = (await request(`${api}:fetchStatus`)).lastAsyncUploadState;
  }
  if (!['SUCCEEDED', 'UPLOAD_SUCCESS'].includes(uploadState)) {
    throw new Error(`Upload did not succeed (${uploadState ?? 'unknown'}); no publish request was sent`);
  }
  if (upload.crxVersion && upload.crxVersion !== version) {
    throw new Error(`Uploaded version ${upload.crxVersion} does not match ${version}; no publish request was sent`);
  }
  if (mode === 'upload') return { mode, version, uploadState };
  const submission = await request(`${api}:publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publishType: mode === 'staged' ? 'STAGED_PUBLISH' : 'DEFAULT_PUBLISH',
      skipReview: false, blockOnWarnings: true,
    }),
  });
  return { mode, version, uploadState, submission };
}

async function main() {
  const config = JSON.parse(await readFile(path.join(root, 'scripts/cws-config.json'), 'utf8'));
  const mode = process.env.CWS_MODE ?? 'status';
  let version;
  let zip;
  if (mode !== 'status') {
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const built = JSON.parse(await readFile(path.join(root, 'dist/manifest.json'), 'utf8'));
    version = manifest.version;
    if (pkg.version !== version || built.version !== version) {
      throw new Error('package.json, manifest.json and dist/manifest.json versions must match');
    }
    zip = await readFile(path.join(root, `release/deepseek-enhancer-${version}-unpacked.zip`));
    console.log(`Package version: ${version}; SHA256: ${createHash('sha256').update(zip).digest('hex')}`);
  }
  const result = await runStoreOperation({ ...config, mode, version, zip, token: process.env.CWS_ACCESS_TOKEN });
  const output = JSON.stringify(result, null, 2);
  console.log(output);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Chrome Web Store\n\n\`\`\`json\n${output}\n\`\`\`\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
