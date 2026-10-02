import { describe, expect, it } from 'vitest';
import type { CodingSubmission } from '../../../src/core/models/coding-submission';
import type { Problem } from '../../../src/core/models/problem';
import {
  parseNextDataProblem,
  parseProblemResponse,
  toProblemReference,
} from '../../../src/platforms/gfg/parsers/problem';
import {
  htmlToText,
  mapGfgStatus,
  normalizeGfgResult,
  parseExecutionTimeMs,
  parseResultResponse,
  type GfgSubmissionContext,
} from '../../../src/platforms/gfg/parsers/result';
import {
  parseResultRequest,
  parseSubmitRequest,
  parseSubmitResponse,
} from '../../../src/platforms/gfg/parsers/submit';
import type { JsonRecord } from '../../../src/platforms/shared/json';
import { GFG_SUBMISSION_ID, gfgFixtures } from './fixtures';

const PROBLEM: Problem = {
  platform: 'gfg',
  url: 'https://www.geeksforgeeks.org/problems/key-pair5616/1',
  slug: 'key-pair5616',
  id: '703092',
  title: 'Two Sum - Pair with Given Sum',
  difficulty: 'Easy',
};

const CODE = gfgFixtures.submitForm.userCode ?? '';

function context(overrides: Partial<GfgSubmissionContext> = {}): GfgSubmissionContext {
  return {
    submissionId: GFG_SUBMISSION_ID,
    problem: PROBLEM,
    language: 'cpp',
    code: CODE,
    detectedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

const final = (name: keyof typeof gfgFixtures.finalResults): JsonRecord => {
  const parsed = parseResultResponse(gfgFixtures.finalResults[name]);
  if (parsed === undefined) throw new Error(`fixture ${name} did not parse`);
  return parsed.raw;
};

describe('GFG submit parsers', () => {
  it('reads code, language and request type from the submit form', () => {
    expect(parseSubmitRequest(gfgFixtures.submitForm)).toEqual({
      language: 'cpp',
      requestType: 'solutionCheck',
      userCode: CODE,
    });
    expect(parseSubmitRequest(undefined)).toEqual({});
    expect(parseSubmitRequest({ userCode: '' })).toEqual({ userCode: '' });
  });

  it('reads the submission id or the rejection message', () => {
    expect(parseSubmitResponse(gfgFixtures.submitResponse)).toEqual({
      ok: true,
      submissionId: GFG_SUBMISSION_ID,
    });
    expect(parseSubmitResponse('{"results":{"submission_id":123}}')).toEqual({
      ok: true,
      submissionId: '123',
    });
    expect(parseSubmitResponse(gfgFixtures.submitError)).toEqual({
      ok: false,
      reason: 'GFG rejected the submission: Please wait before submitting again.',
    });
    expect(parseSubmitResponse('<html>')).toMatchObject({ ok: false });
    expect(parseSubmitResponse('{}')).toMatchObject({ ok: false });
  });

  it('reads the submission and problem ids from the result poll form', () => {
    expect(parseResultRequest({ sub_id: 'abc', sub_type: 'solutionCheck', pid: '703092' })).toEqual(
      {
        submissionId: 'abc',
        problemId: '703092',
      },
    );
    expect(parseResultRequest(undefined)).toEqual({});
  });
});

describe('GFG problem parsers', () => {
  const expected = {
    id: '703092',
    title: 'Two Sum - Pair with Given Sum',
    slug: 'key-pair5616',
    difficulty: 'Easy',
  };

  it('parses the problem API response and __NEXT_DATA__', () => {
    expect(parseProblemResponse(gfgFixtures.problemResponse)).toEqual(expected);
    expect(parseNextDataProblem(gfgFixtures.nextData)).toEqual(expected);
    expect(parseProblemResponse('{"results":{}}')).toBeUndefined();
    expect(parseNextDataProblem('{"props":{}}')).toBeUndefined();
  });

  it('ignores data for a different slug (stale page data after SPA navigation)', () => {
    expect(toProblemReference(PROBLEM.url, 'key-pair5616', expected)).toEqual(PROBLEM);
    expect(toProblemReference('https://x/', 'other-slug', expected)).toEqual({
      platform: 'gfg',
      url: 'https://x/',
      slug: 'other-slug',
    });
  });
});

describe('parseResultResponse', () => {
  it.each([
    ['QUEUED', gfgFixtures.resultQueued, 'judging'],
    ['PICKED', gfgFixtures.resultPicked, 'judging'],
    ['FAILED', gfgFixtures.resultFailed, 'evaluation_failed'],
    ['SUCCESS', gfgFixtures.finalResults.accepted, 'final'],
    ['calculated', gfgFixtures.finalResults.wrongAnswer, 'final'],
  ])('classifies %s', (state, text, phase) => {
    expect(parseResultResponse(text)).toMatchObject({ state, phase });
  });

  it('accepts a results wrapper and rejects responses without a status', () => {
    expect(parseResultResponse('{"results":{"status":"QUEUED"}}')).toMatchObject({
      phase: 'judging',
    });
    expect(parseResultResponse('{}')).toBeUndefined();
    expect(parseResultResponse('nope')).toBeUndefined();
  });
});

describe('GFG field parsers', () => {
  it('maps view_mode to a status', () => {
    expect(mapGfgStatus(final('accepted'))).toBe('accepted');
    expect(mapGfgStatus(final('wrongAnswer'))).toBe('wrong_answer');
    expect(mapGfgStatus({ view_mode: 'wrong_cp' })).toBe('wrong_answer');
    expect(mapGfgStatus(final('compileError'))).toBe('compile_error');
    expect(mapGfgStatus(final('runtimeError'))).toBe('runtime_error');
    expect(mapGfgStatus(final('timeLimitExceeded'))).toBe('time_limit_exceeded');
    expect(mapGfgStatus(final('optimize'))).toBe('time_limit_exceeded');
    expect(mapGfgStatus(final('unknown'))).toBe('unknown');
    expect(mapGfgStatus({})).toBe('unknown');
  });

  it('parses execution time as seconds unless a unit is given', () => {
    expect(parseExecutionTimeMs('0.18')).toBe(180);
    expect(parseExecutionTimeMs('1.5 s')).toBe(1500);
    expect(parseExecutionTimeMs('12ms')).toBe(12);
    expect(parseExecutionTimeMs(0.02)).toBe(20);
    expect(parseExecutionTimeMs('fast')).toBeUndefined();
    expect(parseExecutionTimeMs(undefined)).toBeUndefined();
  });

  it('turns GFG HTML error text into plain text', () => {
    expect(htmlToText('a &lt;b&gt; &amp; &#39;c&#39;<br>d<span>e</span>')).toBe("a <b> & 'c'\nde");
  });
});

describe('normalizeGfgResult', () => {
  const base = {
    id: GFG_SUBMISSION_ID,
    platformSubmissionId: GFG_SUBMISSION_ID,
    platform: 'gfg',
    problem: PROBLEM,
    language: 'cpp',
    code: CODE,
    submittedAt: '2026-10-01T10:00:00.000Z',
  } as const;

  const expected: Record<
    keyof typeof gfgFixtures.finalResults,
    Omit<CodingSubmission, keyof typeof base | 'raw'>
  > = {
    accepted: {
      status: 'accepted',
      metrics: { runtimeMs: 180, testsPassed: 1115, testsTotal: 1115 },
    },
    wrongAnswer: {
      status: 'wrong_answer',
      metrics: {
        testsPassed: 7,
        testsTotal: 1115,
        failedTestCase: { input: '0 -1 2 -3 1\n-2', expected: 'true', actual: 'false' },
      },
    },
    compileError: {
      status: 'compile_error',
      metrics: {},
      error:
        "prog.cpp: In member function 'bool Solution::twoSum(std::vector<int>&, int)':\nprog.cpp:5:9: error: expected ';' before '}' token",
    },
    runtimeError: {
      status: 'runtime_error',
      metrics: { testsTotal: 1115, failedTestCase: { input: '1 2\n3' } },
      error: 'Segmentation Fault (SIGSEGV)\nLearn More about Seg Fault',
    },
    timeLimitExceeded: { status: 'time_limit_exceeded', metrics: { testsTotal: 1115 } },
    optimize: { status: 'time_limit_exceeded', metrics: { testsTotal: 1115 } },
    unknown: { status: 'unknown', metrics: {} },
  };

  it.each(Object.entries(expected))('normalizes the %s fixture', (name, fields) => {
    const raw = final(name as keyof typeof gfgFixtures.finalResults);
    expect(normalizeGfgResult(raw, context())).toEqual({
      ok: true,
      submission: { ...base, ...fields, raw },
    });
  });

  it.each([
    ['missing code', context({ code: undefined as unknown as string }), /code was not captured/],
    [
      'missing language',
      context({ language: undefined as unknown as string }),
      /language is unknown/,
    ],
    [
      'an incomplete problem',
      context({ problem: { platform: 'gfg', url: PROBLEM.url } }),
      /Problem id or title/,
    ],
  ])('fails on %s instead of guessing', (_name, ctx, reason) => {
    const clean = Object.fromEntries(
      Object.entries(ctx).filter(([, v]) => v !== undefined),
    ) as unknown as GfgSubmissionContext;
    const result = normalizeGfgResult(final('accepted'), clean);
    expect(result.ok ? '' : result.reason).toMatch(reason);
  });
});
