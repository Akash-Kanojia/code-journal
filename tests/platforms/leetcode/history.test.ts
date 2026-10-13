import { describe, expect, it, vi } from 'vitest';
import { createLogger, type LogSink } from '../../../src/core/logger';
import type { CodingSubmission } from '../../../src/core/models/coding-submission';
import type { ImportProgress } from '../../../src/core/types/import';
import {
  LeetCodeHistoryImporter,
  type HistoryImporterDeps,
} from '../../../src/platforms/leetcode/history-importer';
import { LeetCodeHttpError } from '../../../src/platforms/leetcode/leetcode-api';
import { parseSubmissionDetailsResponse } from '../../../src/platforms/leetcode/parsers/details';
import {
  normalizeHistorySubmission,
  parseHistoryPage,
  unixSecondsToIso,
} from '../../../src/platforms/leetcode/parsers/history';
import detailsAccepted from './fixtures/history-details-accepted.json';
import detailsWrongAnswer from './fixtures/history-details-wrong-answer.json';
import page1 from './fixtures/history-page-1.json';
import page2 from './fixtures/history-page-2.json';
import signedOut from './fixtures/history-signed-out.json';

const text = (value: unknown) => JSON.stringify(value);
const details = (value: unknown) => {
  const parsed = parseSubmissionDetailsResponse(text(value));
  if (parsed === undefined) throw new Error('fixture did not parse');
  return parsed;
};

describe('history parsers', () => {
  it('parses a page with its cursor, accepting string or number timestamps', () => {
    expect(parseHistoryPage(text(page1))).toEqual({
      hasNext: true,
      lastKey: 'cursor-1',
      items: [
        {
          id: '1000000012',
          titleSlug: 'two-sum',
          statusDisplay: 'Accepted',
          lang: 'cpp',
          submittedAt: '2024-05-05T09:06:40.000Z',
          isPending: false,
        },
        {
          id: '1000000011',
          titleSlug: 'two-sum',
          statusDisplay: 'Wrong Answer',
          lang: 'cpp',
          submittedAt: '2024-05-04T05:20:00.000Z',
          isPending: false,
        },
        {
          id: '1000000010',
          titleSlug: 'two-sum',
          statusDisplay: 'Pending',
          lang: 'cpp',
          submittedAt: '2024-05-03T01:33:20.000Z',
          isPending: true,
        },
      ],
    });
    expect(parseHistoryPage(text(page2))?.items[0]?.submittedAt).toBe('2024-05-01T21:46:40.000Z');
    expect(unixSecondsToIso('abc')).toBeUndefined();
  });

  it('treats a null submission list (signed out) and malformed bodies as unreadable', () => {
    expect(parseHistoryPage(text(signedOut))).toBeUndefined();
    expect(parseHistoryPage('<html>')).toBeUndefined();
  });

  it('normalizes a past submission with its original time, exact code and results', () => {
    const item = parseHistoryPage(text(page1))?.items[1];
    if (item === undefined) throw new Error('missing item');
    const result = normalizeHistorySubmission(item, details(detailsWrongAnswer));
    expect(result).toMatchObject({
      ok: true,
      submission: {
        id: '1000000011',
        platformSubmissionId: '1000000011',
        platform: 'leetcode',
        problem: {
          id: '1',
          title: 'Two Sum',
          slug: 'two-sum',
          difficulty: 'Easy',
          url: 'https://leetcode.com/problems/two-sum/',
        },
        language: 'cpp',
        code: 'class Solution { /* attempt 1000000011 */ };',
        status: 'wrong_answer',
        submittedAt: '2024-05-04T05:20:00.000Z',
        metrics: {
          testsPassed: 3,
          testsTotal: 65,
          failedTestCase: { input: '[3,2,4]\n6', expected: '[1,2]', actual: '[0,0]' },
        },
      },
    });
    const accepted = normalizeHistorySubmission(
      { id: '1000000012', isPending: false, statusDisplay: 'Accepted' },
      details(detailsAccepted),
    );
    expect(accepted).toMatchObject({
      ok: true,
      submission: { status: 'accepted', metrics: { runtimeMs: 4, testsPassed: 65 } },
    });
    expect(accepted.ok ? accepted.submission.metrics : {}).not.toHaveProperty('memoryBytes');
    expect(accepted.ok ? accepted.submission.metrics : {}).not.toHaveProperty('failedTestCase');
  });

  it('refuses to import a submission whose problem cannot be identified', () => {
    const noQuestion = details({
      data: { submissionDetails: { code: 'x', lang: { name: 'cpp' }, timestamp: 1 } },
    });
    expect(normalizeHistorySubmission({ id: '1', isPending: false }, noQuestion)).toEqual({
      ok: false,
      reason: 'Problem is unknown',
    });
  });
});

/** In-memory harness around the importer with fake LeetCode responses. */
function harness(overrides: Partial<HistoryImporterDeps> = {}, stored: string[] = []) {
  const known = new Set(stored);
  const delivered: CodingSubmission[] = [];
  let progress: ImportProgress | undefined;
  const sink = vi.fn<LogSink>();
  const sleeps: number[] = [];
  const pages: Record<number, unknown> = { 0: page1, 3: page2 };
  const detailsById: Record<string, unknown> = {
    '1000000012': detailsAccepted,
    '1000000011': detailsWrongAnswer,
    '1000000009': {
      data: {
        submissionDetails: {
          ...detailsAccepted.data.submissionDetails,
          code: 'old python',
          statusCode: 20,
          timestamp: 1714600000,
          lang: { name: 'python3' },
        },
      },
    },
  };
  const fetchPage = vi.fn<HistoryImporterDeps['fetchPage']>((offset) =>
    Promise.resolve(text(pages[offset] ?? signedOut)),
  );
  const fetchDetails = vi.fn((id: string) =>
    Promise.resolve(parseSubmissionDetailsResponse(text(detailsById[id]))),
  );
  const deps: HistoryImporterDeps = {
    fetchPage,
    fetchDetails,
    filterUnknown: (ids) => Promise.resolve(ids.filter((id) => !known.has(id))),
    deliver: (batch) => {
      for (const s of batch) known.add(s.id);
      delivered.push(...batch);
      return Promise.resolve();
    },
    loadProgress: () => Promise.resolve(progress),
    saveProgress: (p) => {
      progress = structuredClone(p);
      return Promise.resolve();
    },
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    now: () => new Date('2026-10-04T10:00:00.000Z'),
    logger: createLogger('import', sink),
    pacingMs: 1000,
    ...overrides,
  };
  return {
    importer: new LeetCodeHistoryImporter(deps),
    fetchPage,
    fetchDetails,
    delivered,
    sleeps,
    sink,
    progress: () => progress,
    setProgress: (p: ImportProgress) => (progress = p),
  };
}

describe('LeetCodeHistoryImporter', () => {
  it('imports every judged submission across pages, paced, and records completion', async () => {
    const h = harness();
    const result = await h.importer.start(false);

    expect(h.delivered.map((s) => [s.id, s.status, s.submittedAt])).toEqual([
      ['1000000012', 'accepted', '2024-05-05T09:06:40.000Z'],
      ['1000000011', 'wrong_answer', '2024-05-04T05:20:00.000Z'],
      ['1000000009', 'compile_error', '2024-05-01T21:46:40.000Z'],
    ]);
    expect(result).toMatchObject({
      state: 'done',
      offset: 4,
      imported: 3,
      existing: 0,
      skipped: 1,
      finishedAt: '2026-10-04T10:00:00.000Z',
    });
    expect(h.progress()).toEqual(result);
    // 2 pages + 3 details, each preceded by the pacing delay.
    expect(h.sleeps).toEqual([1000, 1000, 1000, 1000, 1000]);
    expect(JSON.stringify(h.sink.mock.calls)).not.toContain('attempt 1000000011');
  });

  it('skips submissions that are already stored without fetching their details', async () => {
    const h = harness({}, ['1000000012', '1000000011']);
    const result = await h.importer.start(false);
    expect(result).toMatchObject({ state: 'done', imported: 1, existing: 2 });
    expect(h.fetchDetails).toHaveBeenCalledTimes(1);
  });

  it('resumes from the saved position, and restarts after a finished import', async () => {
    const h = harness();
    h.setProgress({
      platform: 'leetcode',
      state: 'cancelled',
      offset: 3,
      lastKey: 'cursor-1',
      imported: 2,
      existing: 0,
      skipped: 1,
      startedAt: 'a',
      updatedAt: 'b',
    });
    expect(await h.importer.start(false)).toMatchObject({ state: 'done', imported: 3 });
    expect(h.fetchPage).toHaveBeenCalledWith(3, 'cursor-1');

    await h.importer.start(false); // previous run is done → starts over from the newest
    expect(h.fetchPage).toHaveBeenLastCalledWith(3, 'cursor-1');
    expect(h.fetchPage.mock.calls.at(-2)).toEqual([0, undefined]);
  });

  it('backs off on rate limiting and then continues', async () => {
    let calls = 0;
    const h = harness({
      fetchPage: (offset) => {
        calls++;
        if (calls === 1) return Promise.reject(new LeetCodeHttpError(429, 45_000));
        return Promise.resolve(text(offset === 0 ? page1 : page2));
      },
    });
    expect(await h.importer.start(false)).toMatchObject({ state: 'done', imported: 3 });
    expect(h.sleeps).toContain(45_000);
  });

  it('fails with a clear message when signed out, keeping the position to resume', async () => {
    const h = harness({ fetchPage: () => Promise.resolve(text(signedOut)) });
    expect(await h.importer.start(false)).toMatchObject({
      state: 'failed',
      offset: 0,
      error: expect.stringContaining('signed in') as string,
    });

    const forbidden = harness({ fetchPage: () => Promise.reject(new LeetCodeHttpError(403)) });
    expect(await forbidden.importer.start(false)).toMatchObject({ state: 'failed' });
  });

  it('gives up after repeated server errors', async () => {
    const h = harness({
      fetchPage: () => Promise.reject(new LeetCodeHttpError(502)),
      maxRetries: 2,
    });
    expect(await h.importer.start(false)).toMatchObject({
      state: 'failed',
      error: 'LeetCode returned HTTP 502',
    });
  });

  it('stops when cancelled and does not run twice concurrently', async () => {
    const h = harness();
    const first = h.importer.start(false);
    const second = h.importer.start(false);
    expect(second).toBe(first);
    h.importer.cancel();
    expect(await first).toMatchObject({ state: 'cancelled' });
    expect(h.importer.isRunning()).toBe(false);
  });
});
