import { describe, expect, it, vi } from 'vitest';
import { createLogger, type LogSink } from '../../src/core/logger';
import { SubmissionLifecycleTracker } from '../../src/core/services/submission-lifecycle';

const problem = { platform: 'leetcode', url: 'https://leetcode.com/problems/two-sum/' } as const;

function setup() {
  const sink = vi.fn<LogSink>();
  return { sink, tracker: new SubmissionLifecycleTracker(createLogger('Lifecycle', sink)) };
}

const started = {
  type: 'SUBMISSION_STARTED',
  platform: 'leetcode',
  submissionId: '1',
  problem,
  language: 'cpp',
  detectedAt: '2026-09-28T12:00:00.000Z',
} as const;

describe('SubmissionLifecycleTracker', () => {
  it('moves forward through the lifecycle and logs each transition once', () => {
    const { tracker, sink } = setup();

    tracker.handle(started);
    tracker.handle({
      type: 'SUBMISSION_JUDGING',
      platform: 'leetcode',
      submissionId: '1',
      platformState: 'PENDING',
    });
    tracker.handle({
      type: 'SUBMISSION_JUDGING',
      platform: 'leetcode',
      submissionId: '1',
      platformState: 'RUNNING_TESTS',
    });
    tracker.handle({
      type: 'SUBMISSION_RESULT_RECEIVED',
      platform: 'leetcode',
      submissionId: '1',
      raw: {},
    });

    expect(tracker.get('leetcode', '1')?.state).toBe('RESULT_RECEIVED');
    expect(sink.mock.calls.map((c) => c[2])).toEqual([
      'Submission detected',
      'Submission judging',
      'Submission result received',
    ]);
    expect(sink.mock.calls[0]?.[3]).toMatchObject({
      platform: 'leetcode',
      submissionId: '1',
      problem,
    });
  });

  it('ignores duplicates, regressions and untracked submissions', () => {
    const { tracker, sink } = setup();

    tracker.handle(started);
    tracker.handle(started);
    tracker.handle({
      type: 'SUBMISSION_RESULT_RECEIVED',
      platform: 'leetcode',
      submissionId: '1',
      raw: {},
    });
    tracker.handle({
      type: 'SUBMISSION_JUDGING',
      platform: 'leetcode',
      submissionId: '1',
      platformState: 'PENDING',
    });
    tracker.handle({
      type: 'SUBMISSION_JUDGING',
      platform: 'leetcode',
      submissionId: '999',
      platformState: 'PENDING',
    });

    expect(tracker.get('leetcode', '1')?.state).toBe('RESULT_RECEIVED');
    expect(tracker.get('leetcode', '999')).toBeUndefined();
    expect(sink.mock.calls.filter((c) => c[0] === 'info')).toHaveLength(2);
  });

  it('logs capture failures as errors', () => {
    const { tracker, sink } = setup();

    tracker.handle(started);
    tracker.handle({
      type: 'SUBMISSION_CAPTURE_FAILED',
      platform: 'leetcode',
      submissionId: '1',
      reason: 'bad',
    });
    tracker.handle({ type: 'SUBMISSION_CAPTURE_FAILED', platform: 'leetcode', reason: 'no id' });

    expect(tracker.get('leetcode', '1')?.state).toBe('CAPTURE_FAILED');
    expect(sink.mock.calls.filter((c) => c[0] === 'error').map((c) => c[3])).toEqual([
      { platform: 'leetcode', submissionId: '1', reason: 'bad' },
      { platform: 'leetcode', reason: 'no id' },
    ]);
  });

  it('records the normalized submission and logs a summary without code', () => {
    const { tracker, sink } = setup();
    const submission = {
      id: '1',
      platform: 'leetcode',
      problem: { ...problem, id: '1', title: 'Two Sum' },
      language: 'cpp',
      code: 'SECRET_SOURCE_MARKER',
      status: 'accepted',
      submittedAt: '2026-09-28T12:00:00.000Z',
      metrics: { runtimeMs: 3 },
    } as const;

    tracker.handle(started);
    tracker.handle({
      type: 'SUBMISSION_RESULT_RECEIVED',
      platform: 'leetcode',
      submissionId: '1',
      raw: {},
    });
    tracker.handle({ type: 'SUBMISSION_NORMALIZED', platform: 'leetcode', submission });
    tracker.handle({ type: 'SUBMISSION_NORMALIZED', platform: 'leetcode', submission });

    expect(tracker.get('leetcode', '1')).toMatchObject({ state: 'NORMALIZED', submission });
    const normalizedLogs = sink.mock.calls.filter((c) => c[2] === 'Submission normalized');
    expect(normalizedLogs).toHaveLength(1);
    expect(normalizedLogs[0]?.[3]).toMatchObject({ status: 'accepted', metrics: { runtimeMs: 3 } });
    expect(JSON.stringify(sink.mock.calls)).not.toContain('SECRET_SOURCE_MARKER');
  });

  it('logs parsing failures as errors', () => {
    const { tracker, sink } = setup();

    tracker.handle(started);
    tracker.handle({
      type: 'SUBMISSION_PARSING_FAILED',
      platform: 'leetcode',
      submissionId: '1',
      reason: 'Submitted code was not captured',
      raw: {},
    });

    expect(tracker.get('leetcode', '1')?.state).toBe('PARSING_FAILED');
    expect(sink.mock.calls.at(-1)).toEqual([
      'error',
      '[CodeJournal:Lifecycle]',
      'Submission parsing failed',
      { platform: 'leetcode', submissionId: '1', reason: 'Submitted code was not captured' },
    ]);
  });
});
