import { describe, expect, it } from 'vitest';
import { parseCheckResponse } from '../../../src/platforms/leetcode/parsers/check';
import { parseSubmissionDetailsResponse } from '../../../src/platforms/leetcode/parsers/details';
import {
  parseNextDataQuestion,
  parseQuestionResponse,
  toProblemReference,
} from '../../../src/platforms/leetcode/parsers/question';
import {
  parseSubmitRequest,
  parseSubmitResponse,
} from '../../../src/platforms/leetcode/parsers/submit';
import { fixtures, SLUG_1477 } from './fixtures';

describe('submit parsers', () => {
  it('reads language, internal question id and exact code from the submit request', () => {
    expect(parseSubmitRequest(fixtures.submitRequest)).toEqual({
      lang: 'cpp',
      questionId: '1',
      typedCode: (JSON.parse(fixtures.submitRequest) as { typed_code: string }).typed_code,
    });
  });

  it('tolerates missing or malformed request bodies', () => {
    expect(parseSubmitRequest(undefined)).toEqual({});
    expect(parseSubmitRequest('not json')).toEqual({});
    expect(parseSubmitRequest('[]')).toEqual({});
  });

  it('reads the numeric submission id as a string', () => {
    expect(parseSubmitResponse(fixtures.submitResponse)).toBe('1000000002');
    expect(parseSubmitResponse('{"submission_id":"42"}')).toBe('42');
  });

  it('returns undefined when there is no submission id', () => {
    expect(parseSubmitResponse(fixtures.interpretResponse)).toBeUndefined();
    expect(parseSubmitResponse('{"error":"rate limited"}')).toBeUndefined();
    expect(parseSubmitResponse('<html>')).toBeUndefined();
  });
});

describe('check parser', () => {
  it.each([
    ['PENDING', fixtures.checkPending],
    ['RUNNING_TESTS', fixtures.checkRunningTests],
  ])('treats %s as unfinished', (state, text) => {
    const check = parseCheckResponse(text);
    expect(check).toMatchObject({ state, finished: false });
    expect(check?.submissionId).toBeUndefined();
  });

  it.each(Object.entries(fixtures.finalChecks))('treats %s as finished', (_name, text) => {
    const check = parseCheckResponse(text);
    expect(check?.state).toBe('SUCCESS');
    expect(check?.finished).toBe(true);
    expect(check?.submissionId).toMatch(/^100000000\d$/);
    expect(check?.raw).toEqual(JSON.parse(text));
  });

  it('rejects responses without a state', () => {
    expect(parseCheckResponse('{}')).toBeUndefined();
    expect(parseCheckResponse('oops')).toBeUndefined();
  });
});

describe('question parsers', () => {
  const expected = {
    questionId: '1573',
    questionFrontendId: '1477',
    title: 'Find Two Non-overlapping Sub-arrays Each With Target Sum',
    titleSlug: SLUG_1477,
    difficulty: 'Medium',
  };

  it('parses the GraphQL question response', () => {
    expect(parseQuestionResponse(fixtures.graphqlQuestion)).toEqual(expected);
    expect(parseQuestionResponse('{"data":{"question":null}}')).toBeUndefined();
    expect(parseQuestionResponse('{"errors":[{}]}')).toBeUndefined();
  });

  it('parses the question from __NEXT_DATA__', () => {
    expect(parseNextDataQuestion(fixtures.nextData)).toEqual(expected);
    expect(parseNextDataQuestion('{"props":{}}')).toBeUndefined();
  });

  it('uses the displayed number (questionFrontendId) as the problem id', () => {
    const url = `https://leetcode.com/problems/${SLUG_1477}/`;
    expect(toProblemReference(url, SLUG_1477, expected)).toEqual({
      platform: 'leetcode',
      url,
      slug: SLUG_1477,
      id: '1477',
      title: expected.title,
      difficulty: 'Medium',
    });
  });

  it('ignores question data for a different slug', () => {
    const url = 'https://leetcode.com/problems/two-sum/';
    expect(toProblemReference(url, 'two-sum', expected)).toEqual({
      platform: 'leetcode',
      url,
      slug: 'two-sum',
    });
  });
});

describe('submission details parser', () => {
  it('extracts the stored code, language, time and question', () => {
    expect(parseSubmissionDetailsResponse(fixtures.submissionDetails)).toEqual({
      code: (
        JSON.parse(fixtures.submissionDetails) as { data: { submissionDetails: { code: string } } }
      ).data.submissionDetails.code,
      language: 'cpp',
      submittedAt: '2026-09-28T17:53:20.000Z',
      question: {
        questionId: '1',
        questionFrontendId: '1',
        title: 'Two Sum',
        titleSlug: 'two-sum',
        difficulty: 'Easy',
      },
    });
  });

  it('returns undefined when the submission is not available', () => {
    expect(parseSubmissionDetailsResponse('{"data":{"submissionDetails":null}}')).toBeUndefined();
    expect(
      parseSubmissionDetailsResponse('{"data":{"submissionDetails":{"timestamp":1}}}'),
    ).toBeUndefined();
    expect(parseSubmissionDetailsResponse('<html>')).toBeUndefined();
  });
});
