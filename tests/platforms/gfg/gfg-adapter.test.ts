import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../../src/core/logger';
import type { ProblemReference } from '../../../src/core/models/problem';
import type { SubmissionEvent } from '../../../src/core/models/submission-event';
import { GfgAdapter } from '../../../src/platforms/gfg/gfg-adapter';
import type { BridgeMessage } from '../../../src/platforms/shared/bridge';
import { GFG_RESULT_URL, GFG_SUBMISSION_ID, GFG_SUBMIT_URL, gfgFixtures } from './fixtures';

const PROBLEM: ProblemReference = {
  platform: 'gfg',
  url: 'https://www.geeksforgeeks.org/problems/key-pair5616/1',
  slug: 'key-pair5616',
  id: '703092',
  title: 'Two Sum - Pair with Given Sum',
  difficulty: 'Easy',
};

function submit(
  responseBody = gfgFixtures.submitResponse,
  form: Record<string, string> = gfgFixtures.submitForm,
  status = 200,
): BridgeMessage {
  return {
    channel: 'code-journal:gfg',
    url: GFG_SUBMIT_URL,
    method: 'POST',
    status,
    requestForm: form,
    responseBody,
  };
}

function result(responseBody: string, subId = GFG_SUBMISSION_ID, status = 200): BridgeMessage {
  return {
    channel: 'code-journal:gfg',
    url: GFG_RESULT_URL,
    method: 'POST',
    status,
    requestForm: { sub_id: subId, sub_type: 'solutionCheck', pid: '703092' },
    responseBody,
  };
}

function setup(
  lookup: (slug: string) => Promise<ProblemReference> = () => Promise.resolve(PROBLEM),
) {
  let deliver: (m: BridgeMessage) => void = () => undefined;
  const adapter = new GfgAdapter({
    logger: createLogger('Test', () => undefined),
    now: () => new Date('2026-10-01T10:00:00.000Z'),
    lookupProblem: lookup,
    subscribe: (handler) => {
      deliver = handler;
      return () => undefined;
    },
  });
  const events: SubmissionEvent[] = [];
  adapter.start((e) => events.push(e));
  return {
    adapter,
    events,
    deliver: (m: BridgeMessage) => {
      deliver(m);
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('GfgAdapter', () => {
  it('handles only www.geeksforgeeks.org', () => {
    const { adapter } = setup();
    expect(
      adapter.canHandle(new URL('https://www.geeksforgeeks.org/problems/key-pair5616/1')),
    ).toBe(true);
    expect(adapter.canHandle(new URL('https://leetcode.com/'))).toBe(false);
  });

  it('emits the lifecycle and normalizes with the exact submitted code', async () => {
    const { deliver, events } = setup();

    deliver(submit());
    deliver(result(gfgFixtures.resultQueued));
    deliver(result(gfgFixtures.resultPicked));
    deliver(result(gfgFixtures.finalResults.wrongAnswer));
    await flush();

    expect(events.map((e) => e.type)).toEqual([
      'SUBMISSION_STARTED',
      'SUBMISSION_JUDGING',
      'SUBMISSION_JUDGING',
      'SUBMISSION_RESULT_RECEIVED',
      'SUBMISSION_NORMALIZED',
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'SUBMISSION_NORMALIZED',
      submission: {
        id: GFG_SUBMISSION_ID,
        platform: 'gfg',
        problem: PROBLEM,
        language: 'cpp',
        code: gfgFixtures.submitForm.userCode,
        status: 'wrong_answer',
        submittedAt: '2026-10-01T10:00:00.000Z',
      },
    });
  });

  it('normalizes a final result once even if polled again', async () => {
    const { deliver, events } = setup();

    deliver(submit());
    deliver(result(gfgFixtures.finalResults.accepted));
    deliver(result(gfgFixtures.finalResults.accepted));
    await flush();

    expect(events.filter((e) => e.type === 'SUBMISSION_NORMALIZED')).toHaveLength(1);
  });

  it('keeps concurrent submissions apart', async () => {
    const { deliver, events } = setup();
    const formFor = (code: string) => ({ ...gfgFixtures.submitForm, userCode: code });

    deliver(submit('{"results":{"submission_id":"A"}}', formFor('code A')));
    deliver(submit('{"results":{"submission_id":"B"}}', formFor('code B')));
    deliver(result(gfgFixtures.finalResults.accepted, 'B'));
    deliver(result(gfgFixtures.finalResults.compileError, 'A'));
    await flush();

    const normalized = events.flatMap((e) =>
      e.type === 'SUBMISSION_NORMALIZED' ? [e.submission] : [],
    );
    expect(normalized.map((s) => [s.id, s.code, s.status]).sort()).toEqual([
      ['A', 'code A', 'compile_error'],
      ['B', 'code B', 'accepted'],
    ]);
  });

  it('ignores results for submissions it did not see (no way to recover code)', async () => {
    const { deliver, events } = setup();
    deliver(result(gfgFixtures.finalResults.accepted, 'unknown-id'));
    await flush();
    expect(events).toEqual([]);
  });

  it('reports rejected submits and evaluation failures without persisting them', async () => {
    const { deliver, events } = setup();

    deliver(submit(gfgFixtures.submitError));
    deliver(submit('', gfgFixtures.submitForm, 503));
    deliver(submit());
    deliver(result(gfgFixtures.resultFailed));
    await flush();

    expect(events.filter((e) => e.type === 'SUBMISSION_CAPTURE_FAILED')).toEqual([
      {
        type: 'SUBMISSION_CAPTURE_FAILED',
        platform: 'gfg',
        reason: 'GFG rejected the submission: Please wait before submitting again.',
      },
      {
        type: 'SUBMISSION_CAPTURE_FAILED',
        platform: 'gfg',
        reason: 'Submit request returned HTTP 503',
      },
      {
        type: 'SUBMISSION_CAPTURE_FAILED',
        platform: 'gfg',
        submissionId: GFG_SUBMISSION_ID,
        reason: 'GFG could not evaluate the submission',
      },
    ]);
    expect(events.some((e) => e.type === 'SUBMISSION_NORMALIZED')).toBe(false);
  });

  it('keeps polling through failed HTTP polls', async () => {
    const { deliver, events } = setup();

    deliver(submit());
    deliver(result('', GFG_SUBMISSION_ID, 502));
    deliver(result(gfgFixtures.finalResults.accepted));
    await flush();

    expect(events.at(-1)).toMatchObject({ type: 'SUBMISSION_NORMALIZED' });
  });

  it('ignores non-submit request types on the submit endpoint', async () => {
    const { deliver, events } = setup();
    deliver(
      submit(gfgFixtures.submitResponse, {
        ...gfgFixtures.submitForm,
        request_type: 'testSolution',
      }),
    );
    await flush();
    expect(events).toEqual([]);
  });

  it('retries the problem lookup, then reports a parsing failure with the raw result', async () => {
    const lookup = vi.fn(() =>
      Promise.resolve<ProblemReference>({
        platform: 'gfg',
        url: PROBLEM.url,
        slug: 'key-pair5616',
      }),
    );
    const { deliver, events } = setup(lookup);

    deliver(submit());
    deliver(result(gfgFixtures.finalResults.accepted));
    await flush();

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toMatchObject({
      type: 'SUBMISSION_PARSING_FAILED',
      reason: 'Problem id or title is unavailable',
      raw: { view_mode: 'correct' },
    });
  });
});
