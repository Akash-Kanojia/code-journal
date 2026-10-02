/**
 * Smoke test of the built service worker (dist/background.js) with in-memory chrome.* APIs,
 * fake IndexedDB and the fake GitHub API. Skipped when dist/ has not been built.
 */
import 'fake-indexeddb/auto';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeGitHub } from '../helpers/fake-github';
import { leetCodeSubmission } from '../helpers/submissions';

const BUNDLE = new URL('../../dist/background.js', import.meta.url);
const EXTENSION_ID = 'codejournalextensionid';

type Listener = (...args: unknown[]) => unknown;

function area() {
  const data = new Map<string, unknown>();
  return {
    data,
    get: (key: string) => Promise.resolve(data.has(key) ? { [key]: data.get(key) } : {}),
    set: (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v));
      return Promise.resolve();
    },
    remove: (key: string) => {
      data.delete(key);
      return Promise.resolve();
    },
  };
}

describe.skipIf(!existsSync(BUNDLE))('built background worker', () => {
  it('persists a capture once, syncs it to GitHub, and serves the popup', async () => {
    const github = new FakeGitHub();
    github.addRepo('octo/journal');
    const listeners: Record<string, Listener[]> = {};
    const on = (name: string) => ({
      addListener: (l: Listener) => (listeners[name] ??= []).push(l),
    });
    const alarms: unknown[] = [];
    Object.assign(globalThis, {
      fetch: github.fetch,
      chrome: {
        runtime: {
          id: EXTENSION_ID,
          onInstalled: on('installed'),
          onStartup: on('startup'),
          onMessage: on('message'),
          getURL: (p: string) => `chrome-extension://${EXTENSION_ID}/${p}`,
          getPlatformInfo: () => Promise.resolve({}),
        },
        alarms: {
          onAlarm: on('alarm'),
          create: (...args: unknown[]) => {
            alarms.push(args);
            return Promise.resolve();
          },
          clear: () => Promise.resolve(true),
        },
        storage: { local: area(), session: area() },
      },
    });

    await import(/* @vite-ignore */ BUNDLE.href);
    expect(Object.keys(listeners).sort()).toEqual(['alarm', 'installed', 'message', 'startup']);

    const send = (message: unknown, sender: Record<string, unknown>) =>
      new Promise<{ ok: boolean; data?: unknown; error?: string }>((done) => {
        const handler = listeners.message?.[0];
        const async = handler?.(message, { id: EXTENSION_ID, ...sender }, done);
        if (async !== true) done({ ok: false, error: 'sync response' });
      });
    const tab = { tab: { id: 1 }, url: 'https://leetcode.com/problems/x/' };
    const popup = { url: `chrome-extension://${EXTENSION_ID}/popup.html` };

    // Content scripts cannot use privileged messages.
    expect(await send({ type: 'GET_STATUS' }, tab)).toEqual({ ok: false, error: 'Not allowed' });

    // Store a token the way the device flow does (extension-origin IndexedDB).
    const db = await new Promise<IDBDatabase>((ok) => {
      const open = indexedDB.open('code-journal', 1);
      open.onupgradeneeded = () => {
        open.result
          .createObjectStore('submissions', { keyPath: 'key' })
          .createIndex('submittedAt', 'submission.submittedAt');
        open.result
          .createObjectStore('syncQueue', { keyPath: 'key' })
          .createIndex('status', 'status');
        open.result.createObjectStore('secrets');
      };
      open.onsuccess = () => {
        ok(open.result);
      };
    });
    await new Promise((ok) => {
      const tx = db.transaction('secrets', 'readwrite');
      tx.objectStore('secrets').put(
        { accessToken: github.token, scope: 'repo', login: 'octo', createdAt: '' },
        'github.token',
      );
      tx.oncomplete = ok;
    });
    db.close();

    const saved = await send(
      {
        type: 'SAVE_SETTINGS',
        settings: {
          repository: { owner: 'octo', name: 'journal', fullName: 'octo/journal', private: false },
          branch: 'main',
          directory: 'code-journal',
        },
      },
      popup,
    );
    expect(saved.ok).toBe(true);

    const submission = leetCodeSubmission({ status: 'accepted', raw: undefined });
    const first = await send({ type: 'SUBMISSION_CAPTURED', submission }, tab);
    const duplicate = await send({ type: 'SUBMISSION_CAPTURED', submission }, tab);
    const forged = await send(
      { type: 'SUBMISSION_CAPTURED', submission: { ...submission, status: 'hacked' } },
      tab,
    );
    expect(first).toMatchObject({ ok: true, data: { created: true } });
    expect(duplicate).toMatchObject({ ok: true, data: { created: false } });
    expect(forged.ok).toBe(false);

    const synced = await send({ type: 'SYNC_NOW' }, popup);
    expect(synced.ok).toBe(true);
    expect(github.log('octo/journal')).toEqual([
      'LeetCode #1477 - Attempt 1 - Accepted',
      'Initial commit',
    ]);
    expect(
      github
        .head('octo/journal')
        ?.files.get(
          'code-journal/leetcode/1477-find-two-non-overlapping-sub-arrays-each-with-target-sum/001.js',
        ),
    ).toBe(submission.code);

    const status = await send({ type: 'GET_STATUS' }, popup);
    expect(status).toMatchObject({
      ok: true,
      data: {
        auth: { status: 'connected', login: 'octo' },
        counts: { pending: 0, synced: 1, failed: 0 },
        recent: [{ status: 'accepted', syncStatus: 'synced' }],
      },
    });
    expect(JSON.stringify(status)).not.toContain(github.token);
    expect(JSON.stringify(status)).not.toContain(submission.code);
  });
});
