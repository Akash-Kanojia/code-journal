import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger, type LogSink } from '../../src/core/logger';
import { JournalWriter } from '../../src/core/services/journal-writer';
import { SyncService, type RetryPolicy } from '../../src/core/services/sync-service';
import { GitHubClient } from '../../src/github/github-client';
import { GitHubRepositoryProvider } from '../../src/github/github-repository';
import { IndexedDbStore } from '../../src/storage/indexed-db';
import { FakeGitHub } from '../helpers/fake-github';
import { leetCodeSubmission } from '../helpers/submissions';

const REPO = 'octo/journal';
const DIR = 'leetcode/1477-find-two-non-overlapping-sub-arrays-each-with-target-sum';
const policy: RetryPolicy = { maxRetries: 3, delayMs: (n) => 1000 * 2 ** (n - 1) };

let github: FakeGitHub;
let store: IndexedDbStore;
let now: number;
let connected: boolean;
let configured: boolean;
let sink: ReturnType<typeof vi.fn<LogSink>>;
let onAuthRejected: ReturnType<typeof vi.fn<() => Promise<void>>>;
let sync: SyncService;

beforeEach(async () => {
  github = new FakeGitHub();
  github.addRepo(REPO);
  store = await IndexedDbStore.open(new IDBFactory(), 'sync');
  now = Date.parse('2026-10-01T10:00:00Z');
  connected = true;
  configured = true;
  sink = vi.fn<LogSink>();
  onAuthRejected = vi.fn(() => {
    connected = false;
    return Promise.resolve();
  });
  const client = new GitHubClient({
    fetch: github.fetch,
    getToken: () => Promise.resolve(connected ? github.token : undefined),
  });
  const provider = new GitHubRepositoryProvider(client, () => Promise.resolve(connected));
  const logger = createLogger('sync', sink);
  sync = new SyncService({
    store,
    writer: new JournalWriter(provider, logger),
    logger,
    now: () => new Date(now),
    retryPolicy: policy,
    isAuthenticated: () => Promise.resolve(connected),
    onAuthRejected,
    getTarget: () =>
      Promise.resolve(
        configured
          ? { repository: { owner: 'octo', name: 'journal' }, branch: 'main', directory: '' }
          : undefined,
      ),
  });
});

const capture = async (overrides: Parameters<typeof leetCodeSubmission>[0] = {}) => {
  const submission = leetCodeSubmission(overrides);
  return { submission, ...(await store.save(submission, new Date(now))) };
};

describe('SyncService', () => {
  it('captured → stored → synced', async () => {
    const { stored } = await capture();

    expect(await sync.run()).toEqual({ synced: 1, failed: 0 });

    const entry = (await store.get(stored.sync.key))?.sync;
    expect(entry).toMatchObject({ status: 'synced', path: `${DIR}/001.js`, retryCount: 0 });
    expect(entry?.commitSha).toBe(github.head(REPO)?.sha);
    expect(github.log(REPO)[0]).toBe('LeetCode #1477 - Attempt 1 - Wrong Answer');
  });

  it('captured → stored → GitHub fails → pending → retry → synced', async () => {
    const { stored } = await capture();
    github.failNext.push({ match: /^POST .*git\/trees/, status: 503 });

    const first = await sync.run();
    expect(first.synced).toBe(0);
    expect(first.nextRetryAt).toBe(new Date(now + 1000).toISOString());
    expect((await store.get(stored.sync.key))?.sync).toMatchObject({
      status: 'pending',
      retryCount: 1,
      lastError: expect.stringContaining('503') as string,
    });

    // Not due yet: nothing happens.
    expect(await sync.run()).toMatchObject({ synced: 0 });
    now += 1000;
    expect(await sync.run()).toEqual({ synced: 1, failed: 0 });
    expect((await store.get(stored.sync.key))?.sync.status).toBe('synced');
    expect(github.log(REPO)).toHaveLength(2);
  });

  it('same submission received twice → one stored submission → one Git commit', async () => {
    const submission = leetCodeSubmission();
    await store.save(submission, new Date(now));
    await store.save(submission, new Date(now));
    await Promise.all([sync.run(), sync.run()]);

    expect(await store.counts()).toEqual({ pending: 0, syncing: 0, synced: 1, failed: 0 });
    expect(github.log(REPO)).toEqual([
      'LeetCode #1477 - Attempt 1 - Wrong Answer',
      'Initial commit',
    ]);
  });

  it('does not commit again when a commit succeeded but the local update was lost', async () => {
    const { stored } = await capture();
    await sync.run();
    // Simulate a crash after the GitHub commit, before recording success locally.
    await store.updateSync(
      stored.sync.key,
      { status: 'pending', path: undefined, commitSha: undefined },
      new Date(now),
    );

    expect(await sync.run()).toEqual({ synced: 1, failed: 0 });
    expect(github.log(REPO)).toHaveLength(2);
    expect((await store.get(stored.sync.key))?.sync).toMatchObject({
      status: 'synced',
      path: `${DIR}/001.js`,
    });
  });

  it('commits attempts in submission order, holding later ones while an earlier one waits', async () => {
    await capture({ status: 'wrong_answer' });
    await capture({ status: 'time_limit_exceeded' });
    await capture({ status: 'accepted' });
    github.failNext.push({ match: /^GET .*git\/ref\//, status: 0 });

    expect(await sync.run()).toMatchObject({ synced: 0 });
    now += 1000;
    expect(await sync.run()).toEqual({ synced: 3, failed: 0 });
    expect(github.log(REPO).slice(0, 3)).toEqual([
      'LeetCode #1477 - Attempt 3 - Accepted',
      'LeetCode #1477 - Attempt 2 - Time Limit Exceeded',
      'LeetCode #1477 - Attempt 1 - Wrong Answer',
    ]);
  });

  it('keeps submissions pending while not configured or not connected', async () => {
    const { stored } = await capture();
    configured = false;
    expect(await sync.run()).toEqual({ synced: 0, failed: 0, blocked: 'not_configured' });
    configured = true;
    connected = false;
    expect(await sync.run()).toEqual({ synced: 0, failed: 0, blocked: 'not_authenticated' });
    expect((await store.get(stored.sync.key))?.sync).toMatchObject({
      status: 'pending',
      retryCount: 0,
    });
  });

  it('pauses on rejected credentials without consuming retries', async () => {
    const { stored } = await capture();
    github.failNext.push({ match: /^GET/, status: 401, body: { message: 'Bad credentials' } });

    expect(await sync.run()).toMatchObject({ blocked: 'not_authenticated' });
    expect(onAuthRejected).toHaveBeenCalledOnce();
    expect((await store.get(stored.sync.key))?.sync).toMatchObject({
      status: 'pending',
      retryCount: 0,
    });
  });

  it('honours rate-limit delays', async () => {
    await capture();
    github.failNext.push({
      match: /^GET/,
      status: 403,
      body: { message: 'API rate limit exceeded' },
      headers: { 'x-ratelimit-remaining': '0', 'retry-after': '120' },
    });
    expect((await sync.run()).nextRetryAt).toBe(new Date(now + 120_000).toISOString());
  });

  it('marks a permanently rejected submission failed and continues with the next', async () => {
    const bad = await capture();
    const good = await capture();
    github.failNext.push({
      match: /^POST .*git\/trees/,
      status: 422,
      body: { message: 'Validation failed' },
    });

    expect(await sync.run()).toEqual({ synced: 1, failed: 1 });
    expect((await store.get(bad.stored.sync.key))?.sync).toMatchObject({
      status: 'failed',
      retryCount: 1,
    });
    expect((await store.get(good.stored.sync.key))?.sync.status).toBe('synced');
  });

  it('gives up after the maximum retries, then retries on request', async () => {
    const { stored } = await capture();
    for (let i = 0; i < policy.maxRetries + 1; i++) {
      github.failNext.push({ match: /^GET .*git\/ref\//, status: 500 });
      await sync.run();
      now += 60_000;
    }
    expect((await store.get(stored.sync.key))?.sync).toMatchObject({
      status: 'failed',
      retryCount: 4,
    });

    await store.retryFailed(new Date(now));
    expect(await sync.run()).toEqual({ synced: 1, failed: 0 });
  });

  it('never logs source code or tokens', async () => {
    await capture({ code: 'TOP_SECRET_SOURCE' });
    github.failNext.push({ match: /^POST .*git\/trees/, status: 500 });
    await sync.run();
    now += 10_000;
    await sync.run();
    const logged = JSON.stringify(sink.mock.calls);
    expect(logged).not.toContain('TOP_SECRET_SOURCE');
    expect(logged).not.toContain(github.token);
  });
});
