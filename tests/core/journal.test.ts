import { describe, expect, it } from 'vitest';
import {
  attemptFileName,
  commitMessage,
  normalizeBaseDirectory,
  problemDirectory,
  toPathSegment,
} from '../../src/core/journal/layout';
import {
  attemptMetadata,
  findAttempt,
  nextAttemptNumber,
  parseProblemMetadata,
  serializeMetadata,
  withAttempt,
} from '../../src/core/journal/metadata';
import { gfgSubmission, leetCodeSubmission } from '../helpers/submissions';

describe('journal layout', () => {
  it('builds platform/problem directories', () => {
    const leetcode = leetCodeSubmission();
    expect(problemDirectory('', leetcode.problem)).toBe(
      'leetcode/1477-find-two-non-overlapping-sub-arrays-each-with-target-sum',
    );
    expect(problemDirectory('/code-journal/', leetcode.problem)).toBe(
      'code-journal/leetcode/1477-find-two-non-overlapping-sub-arrays-each-with-target-sum',
    );
    expect(problemDirectory('', gfgSubmission().problem)).toBe('gfg/key-pair5616');
  });

  it('sanitises path segments and base directories', () => {
    expect(toPathSegment('Two Sum: Pair/With "Given" Sum!')).toBe('two-sum-pair-with-given-sum');
    expect(toPathSegment('Ünïcödé')).toBe('unicode');
    expect(normalizeBaseDirectory(' a//b/../ ./c/ ')).toBe('a/b/c');
  });

  it('names attempt files with a padded number and the language extension', () => {
    expect(attemptFileName(1, 'javascript')).toBe('001.js');
    expect(attemptFileName(12, 'python3')).toBe('012.py');
    expect(attemptFileName(1000, 'cpp')).toBe('1000.cpp');
    expect(attemptFileName(2, 'unknown-lang')).toBe('002.txt');
  });

  it('formats commit messages per platform', () => {
    expect(commitMessage(leetCodeSubmission({ status: 'time_limit_exceeded' }), 2)).toBe(
      'LeetCode #1477 - Attempt 2 - Time Limit Exceeded',
    );
    expect(commitMessage(gfgSubmission({ status: 'wrong_answer' }), 1)).toBe(
      'GFG - Two Sum - Pair with Given Sum - Attempt 1 - Wrong Answer',
    );
  });
});

describe('problem metadata', () => {
  it('records attempts without source code or raw payloads', () => {
    const submission = leetCodeSubmission({
      error: 'x'.repeat(5000),
      metrics: { runtimeMs: 5, failedTestCase: { input: '[1]', expected: '1', actual: '2' } },
    });
    const metadata = withAttempt(undefined, submission, attemptMetadata(submission, 1, '001.js'));
    const text = serializeMetadata(metadata);

    expect(text).not.toContain(submission.code);
    expect(text).not.toContain('status_code');
    expect(metadata.problem).toEqual({
      id: '1477',
      title: submission.problem.title,
      slug: submission.problem.slug,
      url: submission.problem.url,
      difficulty: 'Medium',
    });
    expect(metadata.attempts[0]).toMatchObject({
      attempt: 1,
      file: '001.js',
      submissionId: submission.id,
      status: 'wrong_answer',
      statusLabel: 'Wrong Answer',
      language: 'javascript',
      languageName: 'JavaScript',
      runtimeMs: 5,
      failedTestCase: { input: '[1]', expected: '1', actual: '2' },
    });
    expect(metadata.attempts[0]?.error?.length).toBeLessThan(2100);
  });

  it('round-trips, numbers attempts and finds existing ones', () => {
    const first = leetCodeSubmission();
    const second = leetCodeSubmission();
    let metadata = withAttempt(undefined, first, attemptMetadata(first, 1, '001.js'));
    metadata = parseProblemMetadata(serializeMetadata(metadata));
    expect(nextAttemptNumber(undefined)).toBe(1);
    expect(nextAttemptNumber(metadata)).toBe(2);
    expect(findAttempt(metadata, first)?.attempt).toBe(1);
    expect(findAttempt(metadata, second)).toBeUndefined();
  });

  it('refuses to reuse unrecognisable metadata', () => {
    expect(() => parseProblemMetadata('{oops')).toThrow(/not valid JSON/);
    expect(() => parseProblemMetadata('{"platform":"leetcode"}')).toThrow(/unexpected format/);
    expect(() =>
      parseProblemMetadata('{"platform":"leetcode","problem":{},"attempts":[{"attempt":"1"}]}'),
    ).toThrow(/unrecognised attempts/);
  });
});
