import { describe, expect, it } from 'vitest';
import type { CodingSubmission } from '../../../src/core/models/coding-submission';
import type { Problem } from '../../../src/core/models/problem';
import type { JsonRecord } from '../../../src/platforms/shared/json';
import {
  parseError,
  parseFailedTestCase,
  parseMemoryBytes,
  parseMetrics,
  parseRuntimeMs,
} from '../../../src/platforms/leetcode/parsers/metrics';
import {
  normalizeCheckResult,
  type LeetCodeSubmissionContext,
} from '../../../src/platforms/leetcode/parsers/result';
import { mapLeetCodeStatus } from '../../../src/platforms/leetcode/parsers/status';
import { fixtures } from './fixtures';

const final = (name: keyof typeof fixtures.finalChecks) =>
  JSON.parse(fixtures.finalChecks[name]) as JsonRecord;

const TWO_SUM: Problem = {
  platform: 'leetcode',
  url: 'https://leetcode.com/problems/two-sum/',
  slug: 'two-sum',
  id: '1',
  title: 'Two Sum',
  difficulty: 'Easy',
};

const CODE = 'class Solution { /* exact submitted code */ };';

/** Overrides may set a field to undefined to remove it. */
type Overrides = {
  [K in keyof LeetCodeSubmissionContext]?: LeetCodeSubmissionContext[K] | undefined;
};

function context(submissionId: string, overrides: Overrides = {}): LeetCodeSubmissionContext {
  const merged: Overrides = {
    submissionId,
    problem: TWO_SUM,
    language: 'cpp',
    code: CODE,
    detectedAt: '2026-09-28T12:00:00.000Z',
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(merged).filter(([, v]) => v !== undefined),
  ) as unknown as LeetCodeSubmissionContext;
}

describe('mapLeetCodeStatus', () => {
  it.each([
    [10, 'accepted'],
    [11, 'wrong_answer'],
    [12, 'memory_limit_exceeded'],
    [13, 'output_limit_exceeded'],
    [14, 'time_limit_exceeded'],
    [15, 'runtime_error'],
    [20, 'compile_error'],
  ] as const)('maps status_code %i to %s', (code, status) => {
    expect(mapLeetCodeStatus(code, undefined)).toBe(status);
  });

  it('falls back to status_msg, then unknown', () => {
    expect(mapLeetCodeStatus(999, 'Memory Limit Exceeded')).toBe('memory_limit_exceeded');
    expect(mapLeetCodeStatus(undefined, ' time limit exceeded ')).toBe('time_limit_exceeded');
    expect(mapLeetCodeStatus(16, 'Internal Error')).toBe('unknown');
    expect(mapLeetCodeStatus(undefined, undefined)).toBe('unknown');
  });
});

describe('metric parsers', () => {
  it('parses runtime from status_runtime only', () => {
    expect(parseRuntimeMs('3 ms')).toBe(3);
    expect(parseRuntimeMs('0 ms')).toBe(0);
    expect(parseRuntimeMs('1.5 s')).toBe(1500);
    expect(parseRuntimeMs('N/A')).toBeUndefined();
    expect(parseRuntimeMs('fast')).toBeUndefined();
    expect(parseRuntimeMs(3)).toBeUndefined();
  });

  it('trusts memory only when LeetCode displays it', () => {
    expect(parseMemoryBytes(14968000, '15 MB')).toBe(14968000);
    expect(parseMemoryBytes(14228000, 'N/A')).toBeUndefined();
    expect(parseMemoryBytes(0, '0 MB')).toBeUndefined();
    expect(parseMemoryBytes(undefined, '15 MB')).toBeUndefined();
  });

  it('reads test counts, treating null as unavailable', () => {
    expect(parseMetrics(final('accepted'), 'accepted')).toMatchObject({
      testsPassed: 65,
      testsTotal: 65,
    });
    const compile = parseMetrics(final('compileError'), 'compile_error');
    expect(compile).not.toHaveProperty('testsPassed');
    expect(compile).not.toHaveProperty('testsTotal');
  });

  it('extracts the failed testcase and drops empty fields', () => {
    expect(parseFailedTestCase(final('wrongAnswer'), 'wrong_answer')).toEqual({
      input: '[2,7,11,15]\n9',
      expected: '[0,1]',
      actual: '[0,0]',
    });
    expect(parseFailedTestCase(final('timeLimitExceeded'), 'time_limit_exceeded')).toEqual({
      input: '[2,7,11,15]\n9',
      expected: '[0,1]',
    });
    expect(parseFailedTestCase(final('accepted'), 'accepted')).toBeUndefined();
    expect(parseFailedTestCase(final('compileError'), 'compile_error')).toBeUndefined();
  });

  it('prefers the full compiler or runtime error', () => {
    expect(parseError(final('compileError'))).toBe(final('compileError').full_compile_error);
    expect(parseError(final('runtimeError'))).toBe(final('runtimeError').full_runtime_error);
    expect(parseError({ runtime_error: 'short' })).toBe('short');
    expect(parseError(final('accepted'))).toBeUndefined();
  });
});

describe('normalizeCheckResult', () => {
  const base = {
    platform: 'leetcode',
    problem: TWO_SUM,
    language: 'cpp',
    code: CODE,
    submittedAt: '2026-09-28T12:00:00.000Z',
  } as const;

  const expected: Record<keyof typeof fixtures.finalChecks, CodingSubmission> = {
    accepted: {
      ...base,
      id: '1000000005',
      platformSubmissionId: '1000000005',
      status: 'accepted',
      metrics: { runtimeMs: 3, memoryBytes: 14968000, testsPassed: 65, testsTotal: 65 },
      raw: final('accepted'),
    },
    wrongAnswer: {
      ...base,
      id: '1000000002',
      platformSubmissionId: '1000000002',
      status: 'wrong_answer',
      metrics: {
        testsPassed: 0,
        testsTotal: 65,
        failedTestCase: { input: '[2,7,11,15]\n9', expected: '[0,1]', actual: '[0,0]' },
      },
      raw: final('wrongAnswer'),
    },
    timeLimitExceeded: {
      ...base,
      id: '1000000004',
      platformSubmissionId: '1000000004',
      status: 'time_limit_exceeded',
      metrics: {
        testsPassed: 0,
        testsTotal: 65,
        failedTestCase: { input: '[2,7,11,15]\n9', expected: '[0,1]' },
      },
      raw: final('timeLimitExceeded'),
    },
    runtimeError: {
      ...base,
      id: '1000000003',
      platformSubmissionId: '1000000003',
      status: 'runtime_error',
      metrics: {
        testsPassed: 0,
        testsTotal: 65,
        failedTestCase: { input: '[2,7,11,15]\n9', expected: '[0,1]' },
      },
      error:
        "terminate called after throwing an instance of 'std::out_of_range'\n  what():  vector::_M_range_check: __n (which is 5) >= this->size() (which is 0)",
      raw: final('runtimeError'),
    },
    compileError: {
      ...base,
      id: '1000000001',
      platformSubmissionId: '1000000001',
      status: 'compile_error',
      metrics: {},
      error:
        'Line 5: Char 5: error: non-void function does not return a value [-Werror,-Wreturn-type]\n    5 |     }\n      |     ^\n1 error generated.',
      raw: final('compileError'),
    },
    memoryLimitExceeded: {
      ...base,
      id: '1000000006',
      platformSubmissionId: '1000000006',
      status: 'memory_limit_exceeded',
      // Memory is not trusted when LeetCode shows "N/A"; partial test counts are kept.
      metrics: {
        testsPassed: 10,
        testsTotal: 65,
        failedTestCase: { input: '[1,2,3]\n4', expected: '[0,2]' },
      },
      raw: final('memoryLimitExceeded'),
    },
  };

  it.each(Object.entries(expected))('normalizes the %s fixture', (_name, submission) => {
    const raw = submission.raw as JsonRecord;
    expect(normalizeCheckResult(raw, context(submission.id))).toEqual({ ok: true, submission });
  });

  it('maps an unrecognised result to "unknown" and keeps only fields that exist', () => {
    const raw = JSON.parse(fixtures.checkUnknownStatus) as JsonRecord;
    const result = normalizeCheckResult(raw, context('1000000007'));
    expect(result).toEqual({
      ok: true,
      submission: {
        ...base,
        id: '1000000007',
        platformSubmissionId: '1000000007',
        status: 'unknown',
        metrics: {},
        raw,
      },
    });
  });

  it('tolerates wrongly-typed fields instead of failing', () => {
    const raw: JsonRecord = {
      ...final('accepted'),
      status_runtime: 3,
      memory: 'lots',
      total_correct: '65',
      total_testcases: -1,
      expected_output: 42,
    };
    const result = normalizeCheckResult(raw, context('1000000005'));
    expect(result).toMatchObject({ ok: true, submission: { status: 'accepted', metrics: {} } });
  });

  it('uses the submitted code, not anything from the result', () => {
    const result = normalizeCheckResult(final('accepted'), context('1000000005', { code: '' }));
    expect(result).toMatchObject({ ok: true, submission: { code: '' } });
  });

  it('falls back to the result language when the request had none', () => {
    const result = normalizeCheckResult(
      final('accepted'),
      context('1000000005', { language: undefined }),
    );
    expect(result).toMatchObject({ ok: true, submission: { language: 'cpp' } });
  });

  it.each([
    ['a mismatched submission id', context('42'), /expected 42/],
    ['missing code', context('1000000005', { code: undefined }), /code was not captured/],
    [
      'an incomplete problem',
      context('1000000005', {
        problem: { platform: 'leetcode', url: TWO_SUM.url, slug: 'two-sum' },
      }),
      /Problem id or title/,
    ],
  ])('fails on %s instead of guessing', (_name, ctx, reason) => {
    const result = normalizeCheckResult(final('accepted'), ctx);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toMatch(reason);
  });
});
