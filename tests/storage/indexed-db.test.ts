import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { IndexedDbStore } from '../../src/storage/indexed-db';
import { gfgSubmission, leetCodeSubmission } from '../helpers/submissions';

const NOW = new Date('2026-10-01T10:00:00.000Z');
let factory: IDBFactory;
let store: IndexedDbStore;

beforeEach(async () => {
  factory = new IDBFactory();
  store = await IndexedDbStore.open(factory, 'test');
});

describe('IndexedDbStore', () => {
  it('stores a submission and queues it for sync in one step', async () => {
    const submission = leetCodeSubmission();
    const { created, stored } = await store.save(submission, NOW);

    expect(created).toBe(true);
    expect(stored.record).toEqual({
      key: `leetcode:${submission.id}`,
      submission,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect(stored.sync).toMatchObject({
      status: 'pending',
      retryCount: 0,
      submittedAt: submission.submittedAt,
    });
    expect(await store.get(`leetcode:${submission.id}`)).toEqual(stored);
  });

  it('deduplicates by platform + id', async () => {
    const submission = leetCodeSubmission();
    await store.save(submission, NOW);
    const again = await store.save(
      { ...submission, code: 'different' },
      new Date(NOW.getTime() + 1000),
    );

    expect(again.created).toBe(false);
    expect(again.stored.record.submission.code).toBe(submission.code);
    expect((await store.counts()).pending).toBe(1);
    // Same id on another platform is a different submission.
    expect((await store.save(gfgSubmission({ id: submission.id }), NOW)).created).toBe(true);
  });

  it('keeps every attempt of the same problem separately', async () => {
    for (const status of ['wrong_answer', 'time_limit_exceeded', 'accepted'] as const) {
      await store.save(leetCodeSubmission({ status }), NOW);
    }
    const recent = await store.listRecent(10);
    expect(recent.map((r) => r.record.submission.status)).toEqual([
      'accepted',
      'time_limit_exceeded',
      'wrong_answer',
    ]);
    expect((await store.listPending()).map((e) => e.key)).toEqual(
      recent.map((r) => r.record.key).reverse(),
    );
  });

  it('updates sync state, retry counters and removes cleared fields', async () => {
    const { stored } = await store.save(leetCodeSubmission(), NOW);
    const later = new Date(NOW.getTime() + 5000);
    await store.updateSync(
      stored.sync.key,
      { status: 'pending', retryCount: 2, lastError: 'boom', nextRetryAt: later.toISOString() },
      later,
    );
    const failed = await store.updateSync(
      stored.sync.key,
      { status: 'synced', lastError: undefined, nextRetryAt: undefined, path: 'a/001.js' },
      later,
    );

    expect(failed).toMatchObject({
      status: 'synced',
      retryCount: 2,
      path: 'a/001.js',
      updatedAt: later.toISOString(),
    });
    expect(failed).not.toHaveProperty('lastError');
    expect(failed).not.toHaveProperty('nextRetryAt');
    expect(await store.counts()).toEqual({ pending: 0, syncing: 0, synced: 1, failed: 0 });
    await expect(store.updateSync('missing', { status: 'synced' }, NOW)).rejects.toThrow(
      /No sync entry/,
    );
  });

  it('recovers interrupted syncs and retries failed entries', async () => {
    const a = (await store.save(leetCodeSubmission(), NOW)).stored.sync.key;
    const b = (await store.save(leetCodeSubmission(), NOW)).stored.sync.key;
    await store.updateSync(a, { status: 'syncing' }, NOW);
    await store.updateSync(
      b,
      { status: 'failed', retryCount: 11, nextRetryAt: NOW.toISOString() },
      NOW,
    );

    expect(await store.recoverInterrupted(NOW)).toBe(1);
    expect(await store.retryFailed(NOW)).toBe(1);
    const entry = (await store.get(b))?.sync;
    expect(entry).toMatchObject({ status: 'pending', retryCount: 0 });
    expect(entry).not.toHaveProperty('nextRetryAt');
    expect((await store.counts()).pending).toBe(2);
  });

  it('persists across reopening the database (worker / browser restart)', async () => {
    const submission = leetCodeSubmission();
    await store.save(submission, NOW);
    store.close();

    const reopened = await IndexedDbStore.open(factory, 'test');
    expect((await reopened.listPending()).map((e) => e.key)).toEqual([`leetcode:${submission.id}`]);
    expect((await reopened.get(`leetcode:${submission.id}`))?.record.submission.code).toBe(
      submission.code,
    );
  });

  it('drops oversized raw payloads but keeps the submission', async () => {
    const submission = leetCodeSubmission({ raw: { blob: 'x'.repeat(100_000) } });
    const { stored } = await store.save(submission, NOW);
    expect(stored.record.submission).not.toHaveProperty('raw');
    expect(stored.record.submission.code).toBe(submission.code);
  });

  it('stores secrets separately', async () => {
    await store.setSecret('github.token', { accessToken: 't' });
    expect(await store.getSecret('github.token')).toEqual({ accessToken: 't' });
    await store.deleteSecret('github.token');
    expect(await store.getSecret('github.token')).toBeUndefined();
  });
});
