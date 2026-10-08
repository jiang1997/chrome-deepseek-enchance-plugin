// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { compareVersions, runStoreOperation } from '../scripts/publish-cws.mjs';

const base = {
  mode: 'publish', token: 'test-secret-token',
  publisherId: '751f873b-141b-480e-babb-b68958e382cd',
  extensionId: 'eaenmoclonobobodnhnnakgbiafdcide',
  version: '0.1.1', zip: Buffer.from('test package'), sleep: async () => {},
};
const published = {
  publishedItemRevisionStatus: { distributionChannels: [{ crxVersion: '0.1.0' }] },
};
function responses(...values) {
  const mock = vi.fn();
  for (const value of values) {
    mock.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify(value) });
  }
  return mock;
}

describe('Chrome Web Store release', () => {
  it('queries status without sending a mutation or needing a package', async () => {
    const fetchImpl = responses(published);
    const result = await runStoreOperation({ ...base, mode: 'status', version: undefined, zip: undefined, fetchImpl });
    expect(result.status).toEqual(published);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toMatch(/:fetchStatus$/);
    expect(fetchImpl.mock.calls[0][1].method).toBeUndefined();
  });
  it('compares numeric version segments and treats missing segments as zero', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBe(1);
    expect(compareVersions('1.0', '1.0.0.0')).toBe(0);
  });
  it.each(['0.1.0', '0.0.9'])('rejects non-increasing version %s before upload', async (version) => {
    const fetchImpl = responses(published);
    await expect(runStoreOperation({ ...base, version, fetchImpl })).rejects.toThrow('must be greater');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each(['PENDING_REVIEW', 'STAGED'])('preserves an existing %s submission', async (state) => {
    const fetchImpl = responses({ submittedItemRevisionStatus: { state } });
    await expect(runStoreOperation({ ...base, fetchImpl })).rejects.toThrow(state);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('waits for asynchronous upload completion before submitting', async () => {
    const fetchImpl = responses(published, { uploadState: 'IN_PROGRESS' },
      { lastAsyncUploadState: 'IN_PROGRESS' }, { lastAsyncUploadState: 'SUCCEEDED' },
      { state: 'PENDING_REVIEW' });
    const result = await runStoreOperation({ ...base, fetchImpl });
    expect(result.submission.state).toBe('PENDING_REVIEW');
    expect(fetchImpl.mock.calls[1][0]).toContain('/upload/v2/');
    expect(fetchImpl.mock.calls[1][1].body).toBe(base.zip);
    const [url, request] = fetchImpl.mock.calls[4];
    expect(url).toMatch(/:publish$/);
    expect(JSON.parse(request.body)).toEqual({ publishType: 'DEFAULT_PUBLISH', skipReview: false, blockOnWarnings: true });
  });
  it('supports an upload without submitting', async () => {
    const fetchImpl = responses(published, { uploadState: 'SUCCEEDED', crxVersion: base.version });
    await runStoreOperation({ ...base, mode: 'upload', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('supports staged approval instead of automatic go-live', async () => {
    const fetchImpl = responses(published, { uploadState: 'SUCCEEDED' }, { state: 'PENDING_REVIEW' });
    await runStoreOperation({ ...base, mode: 'staged', fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body).publishType).toBe('STAGED_PUBLISH');
  });
  it.each(['FAILED', 'NOT_FOUND', undefined])('does not submit after upload state %s', async (uploadState) => {
    const fetchImpl = responses(published, { uploadState });
    await expect(runStoreOperation({ ...base, fetchImpl })).rejects.toThrow('no publish request');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('bounds upload polling and does not submit on timeout', async () => {
    const fetchImpl = responses(published, { uploadState: 'IN_PROGRESS' }, { lastAsyncUploadState: 'IN_PROGRESS' });
    await expect(runStoreOperation({ ...base, fetchImpl, maxPolls: 1 })).rejects.toThrow('no publish request');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('does not submit a package with an unexpected uploaded version', async () => {
    const fetchImpl = responses(published, { uploadState: 'SUCCEEDED', crxVersion: '0.1.2' });
    await expect(runStoreOperation({ ...base, fetchImpl })).rejects.toThrow('does not match');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('redacts tokens from API errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => `Rejected ${base.token}` });
    await expect(runStoreOperation({ ...base, fetchImpl })).rejects.toThrow('HTTP 403: Rejected [REDACTED]');
  });
  it('rejects invalid modes and missing credentials without contacting Google', async () => {
    const fetchImpl = vi.fn();
    await expect(runStoreOperation({ ...base, mode: 'unknown', fetchImpl })).rejects.toThrow('Choose a mode');
    await expect(runStoreOperation({ ...base, token: '', fetchImpl })).rejects.toThrow('CWS_ACCESS_TOKEN');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
