import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../../src/core/logger';
import type { ProblemReference } from '../../../src/core/models/problem';
import type { SubmissionEvent } from '../../../src/core/models/submission-event';
import type { LeetCodeSubmissionDetails } from '../../../src/platforms/leetcode/parsers/details';
import type { BridgeMessage } from '../../../src/platforms/shared/bridge';
import { LeetCodeAdapter } from '../../../src/platforms/leetcode/leetcode-adapter';
import { fixtures } from './fixtures';

const PROBLEM: ProblemReference = {
  platform: 'leetcode',
  url: 'https://leetcode.com/problems/two-sum/',
  slug: 'two-sum',
  id: '1',
  title: 'Two Sum',
  difficulty: 'Easy',
};

type Extra = { [K in keyof BridgeMessage]?: BridgeMessage[K] | undefined };

function message(
  url: string,
  method: string,
  responseBody: string,
  extra: Extra = {},
): BridgeMessage {
  const merged = {
    channel: 'code-journal:leetcode',
    url,
    method,
    status: 200,
    responseBody,
    ...extra,
  };
  return Object.fromEntries(
    Object.entries(merged).filter(([, v]) => v !== undefined),
  ) as unknown as BridgeMessage;
}

const submit = (responseBody = fixtures.submitResponse, extra: Extra = {}) =>
  message('https://leetcode.com/problems/two-sum/submit/', 'POST', responseBody, {
    requestBody: fixtures.submitRequest,
    ...extra,
  });

const check = (responseBody: string, id = '1000000002') =>
  message(`https://leetcode.com/submissions/detail/${id}/v2/check/`, 'GET', responseBody);

function setup(
  lookupProblem: (slug: string) => Promise<ProblemReference> = () => Promise.resolve(PROBLEM),
  fetchSubmissionDetails: (id: string) => Promise<LeetCodeSubmissionDetails | undefined> = () =>
    Promise.resolve(undefined),
) {
  let deliver: (m: BridgeMessage) => void = () => undefined;
  const unsubscribe = vi.fn();
  const adapter = new LeetCodeAdapter({
    logger: createLogger('Test', () => undefined),
    now: () => new Date('2026-09-28T12:00:00.000Z'),
    lookupProblem,
    fetchSubmissionDetails,
    subscribe: (handler) => {
      deliver = handler;
      return unsubscribe;
    },
  });
  const events: SubmissionEvent[] = [];
  const stop = adapter.start((e) => events.push(e));
  return {
    adapter,
    events,
    stop,
    unsubscribe,
    deliver: (m: BridgeMessage) => {
      deliver(m);
    },
  };
}

const SUBMITTED_CODE = (JSON.parse(fixtures.submitRequest) as { typed_code: string }).typed_code;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('LeetCodeAdapter', () => {
  it('handles only leetcode.com pages', () => {
    const { adapter } = setup();
    expect(adapter.canHandle(new URL('https://leetcode.com/problems/two-sum/'))).toBe(true);
    expect(adapter.canHandle(new URL('https://www.geeksforgeeks.org/'))).toBe(false);
  });

  it('emits the submission lifecycle in order', async () => {
    const { deliver, events } = setup();

    deliver(submit());
    deliver(check(fixtures.checkPending));
    deliver(check(fixtures.checkRunningTests));
    deliver(check(fixtures.finalChecks.wrongAnswer));
    await flush();

    expect(events.map((e) => e.type)).toEqual([
      'SUBMISSION_STARTED',
      'SUBMISSION_JUDGING',
      'SUBMISSION_JUDGING',
      'SUBMISSION_RESULT_RECEIVED',
      'SUBMISSION_NORMALIZED',
    ]);
    expect(events[0]).toEqual({
      type: 'SUBMISSION_STARTED',
      platform: 'leetcode',
      submissionId: '1000000002',
      problem: PROBLEM,
      language: 'cpp',
      detectedAt: '2026-09-28T12:00:00.000Z',
    });
    expect(events[1]).toMatchObject({ submissionId: '1000000002', platformState: 'PENDING' });
    expect(events[3]).toMatchObject({
      submissionId: '1000000002',
      raw: JSON.parse(fixtures.finalChecks.wrongAnswer) as unknown,
    });
    expect(events[4]).toEqual({
      type: 'SUBMISSION_NORMALIZED',
      platform: 'leetcode',
      submission: {
        id: '1000000002',
        platform: 'leetcode',
        problem: PROBLEM,
        language: 'cpp',
        code: SUBMITTED_CODE,
        status: 'wrong_answer',
        submittedAt: '2026-09-28T12:00:00.000Z',
        metrics: {
          testsPassed: 0,
          testsTotal: 65,
          failedTestCase: { input: '[2,7,11,15]\n9', expected: '[0,1]', actual: '[0,0]' },
        },
        platformSubmissionId: '1000000002',
        raw: JSON.parse(fixtures.finalChecks.wrongAnswer) as unknown,
      },
    });
  });

  it('retries an incomplete problem lookup before normalizing', async () => {
    const lookup = vi
      .fn<(slug: string) => Promise<ProblemReference>>()
      .mockResolvedValueOnce({ platform: 'leetcode', url: PROBLEM.url, slug: 'two-sum' })
      .mockResolvedValueOnce(PROBLEM);
    const { deliver, events } = setup(lookup);

    deliver(submit());
    deliver(check(fixtures.finalChecks.wrongAnswer));
    await flush();

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toMatchObject({
      type: 'SUBMISSION_NORMALIZED',
      submission: { problem: PROBLEM },
    });
  });

  it('reports a parsing failure with the raw result when the code was not captured', async () => {
    const { deliver, events } = setup();

    deliver(submit(fixtures.submitResponse, { requestBody: undefined }));
    deliver(check(fixtures.finalChecks.wrongAnswer));
    await flush();

    expect(events.at(-1)).toEqual({
      type: 'SUBMISSION_PARSING_FAILED',
      platform: 'leetcode',
      submissionId: '1000000002',
      reason: 'Submitted code was not captured',
      raw: JSON.parse(fixtures.finalChecks.wrongAnswer) as unknown,
    });
  });

  it('normalizes a final result only once', async () => {
    const { deliver, events } = setup();

    deliver(submit());
    deliver(check(fixtures.finalChecks.wrongAnswer));
    deliver(check(fixtures.finalChecks.wrongAnswer));
    await flush();

    expect(events.filter((e) => e.type === 'SUBMISSION_NORMALIZED')).toHaveLength(1);
  });

  it('reports a capture failure when an unobserved submission cannot be recovered', async () => {
    const { deliver, events } = setup();

    deliver(check(fixtures.finalChecks.accepted, '1000000005'));
    deliver(check(fixtures.finalChecks.accepted, '1000000005'));
    await flush();

    expect(events).toEqual([
      {
        type: 'SUBMISSION_CAPTURE_FAILED',
        platform: 'leetcode',
        submissionId: '1000000005',
        reason: 'Result observed without its submit request, and recovery failed',
      },
    ]);
  });

  it('recovers a submission whose submit request was missed (page refreshed while judging)', async () => {
    const details = vi.fn(() =>
      Promise.resolve<LeetCodeSubmissionDetails>({
        code: 'recovered code',
        language: 'cpp',
        submittedAt: '2026-09-28T11:59:00.000Z',
        question: {
          questionId: '1',
          questionFrontendId: '1',
          title: 'Two Sum',
          titleSlug: 'two-sum',
          difficulty: 'Easy',
        },
      }),
    );
    const { deliver, events } = setup(undefined, details);

    deliver(check(fixtures.checkRunningTests, '1000000005'));
    deliver(check(fixtures.finalChecks.accepted, '1000000005'));
    deliver(check(fixtures.finalChecks.accepted, '1000000005'));
    await flush();

    expect(details).toHaveBeenCalledOnce();
    expect(events.map((e) => e.type)).toEqual([
      'SUBMISSION_STARTED',
      'SUBMISSION_RESULT_RECEIVED',
      'SUBMISSION_NORMALIZED',
    ]);
    expect(events.at(-1)).toMatchObject({
      submission: {
        id: '1000000005',
        code: 'recovered code',
        language: 'cpp',
        status: 'accepted',
        submittedAt: '2026-09-28T11:59:00.000Z',
        problem: PROBLEM,
      },
    });
  });

  it('keeps rapid submissions apart: each result gets its own code', async () => {
    const { deliver, events } = setup();
    const body = (code: string) =>
      JSON.stringify({ lang: 'cpp', question_id: '1', typed_code: code });

    deliver(submit('{"submission_id":1000000002}', { requestBody: body('code A') }));
    deliver(submit('{"submission_id":1000000005}', { requestBody: body('code B') }));
    deliver(check(fixtures.finalChecks.accepted, '1000000005'));
    deliver(check(fixtures.finalChecks.wrongAnswer, '1000000002'));
    await flush();

    const normalized = events.flatMap((e) =>
      e.type === 'SUBMISSION_NORMALIZED' ? [e.submission] : [],
    );
    expect(normalized.map((s) => [s.id, s.code, s.status]).sort()).toEqual([
      ['1000000002', 'code A', 'wrong_answer'],
      ['1000000005', 'code B', 'accepted'],
    ]);
  });

  it('ignores a duplicate submit response for the same submission id', async () => {
    const { deliver, events } = setup();

    deliver(submit());
    deliver(submit());
    deliver(check(fixtures.finalChecks.wrongAnswer));
    await flush();

    expect(events.filter((e) => e.type === 'SUBMISSION_STARTED')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'SUBMISSION_NORMALIZED')).toHaveLength(1);
  });

  it('keeps order when the problem lookup is slower than polling', async () => {
    let resolveLookup: (p: ProblemReference) => void = () => undefined;
    const { deliver, events } = setup(() => new Promise((resolve) => (resolveLookup = resolve)));

    deliver(submit());
    deliver(check(fixtures.checkPending));
    deliver(check(fixtures.finalChecks.wrongAnswer));
    await flush();
    expect(events).toEqual([]);

    resolveLookup(PROBLEM);
    await flush();
    expect(events.map((e) => e.type)).toEqual([
      'SUBMISSION_STARTED',
      'SUBMISSION_JUDGING',
      'SUBMISSION_RESULT_RECEIVED',
      'SUBMISSION_NORMALIZED',
    ]);
  });

  it('still reports the submission when the problem lookup rejects', async () => {
    const { deliver, events } = setup(() => Promise.reject(new Error('boom')));

    deliver(submit());
    await flush();

    expect(events[0]).toMatchObject({
      type: 'SUBMISSION_STARTED',
      submissionId: '1000000002',
      problem: {
        platform: 'leetcode',
        slug: 'two-sum',
        url: 'https://leetcode.com/problems/two-sum/',
      },
    });
  });

  it('reports a failed submit request', async () => {
    const { deliver, events } = setup();

    deliver(submit('{"error":"too many requests"}', { status: 429 }));
    deliver(submit('{}'));
    await flush();

    expect(events).toEqual([
      {
        type: 'SUBMISSION_CAPTURE_FAILED',
        platform: 'leetcode',
        reason: 'Submit request returned HTTP 429',
      },
      {
        type: 'SUBMISSION_CAPTURE_FAILED',
        platform: 'leetcode',
        reason: 'Submit response did not contain a submission id',
      },
    ]);
  });

  it('reports an unrecognised check response', async () => {
    const { deliver, events } = setup();

    deliver(submit());
    deliver(check('<html>'));
    await flush();

    expect(events[1]).toMatchObject({
      type: 'SUBMISSION_CAPTURE_FAILED',
      submissionId: '1000000002',
    });
  });

  it('ignores Run traffic and unsubscribes on stop', async () => {
    const { deliver, events, stop, unsubscribe } = setup();

    deliver(
      message(
        'https://leetcode.com/problems/two-sum/interpret_solution/',
        'POST',
        fixtures.interpretResponse,
      ),
    );
    await flush();
    expect(events).toEqual([]);

    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
