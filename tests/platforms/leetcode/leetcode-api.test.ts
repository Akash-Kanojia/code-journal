import { describe, expect, it, vi } from 'vitest';
import {
  classifyLeetCodeRequest,
  fetchSubmissionDetails,
  leetCodeObservationRule,
  lookupProblem,
} from '../../../src/platforms/leetcode/leetcode-api';
import { fixtures, SLUG_1477 } from './fixtures';

const at = (path: string) => new URL(path, 'https://leetcode.com');

describe('classifyLeetCodeRequest', () => {
  it('recognises the submit request', () => {
    expect(classifyLeetCodeRequest(at('/problems/two-sum/submit/'), 'POST')).toEqual({
      kind: 'submit',
      slug: 'two-sum',
    });
    expect(classifyLeetCodeRequest(at('/problems/two-sum/submit/'), 'post')).toMatchObject({
      kind: 'submit',
    });
  });

  it('recognises check polling with or without a version segment', () => {
    for (const path of ['/submissions/detail/123/v2/check/', '/submissions/detail/123/check/']) {
      expect(classifyLeetCodeRequest(at(path), 'GET')).toEqual({
        kind: 'check',
        submissionId: '123',
      });
    }
  });

  it('ignores Run, other methods, other paths and other origins', () => {
    const ignored: [string, string][] = [
      ['/problems/two-sum/interpret_solution/', 'POST'],
      ['/submissions/detail/runcode_1790618047.34_abc/check/', 'GET'],
      ['/problems/two-sum/submit/', 'GET'],
      ['/submissions/detail/123/v2/check/', 'POST'],
      ['/graphql/', 'POST'],
    ];
    for (const [path, method] of ignored) {
      expect(classifyLeetCodeRequest(at(path), method)).toBeUndefined();
    }
    expect(
      classifyLeetCodeRequest(new URL('https://leetcode.cn/problems/two-sum/submit/'), 'POST'),
    ).toBeUndefined();
  });
});

describe('lookupProblem', () => {
  const url = `https://leetcode.com/problems/${SLUG_1477}/`;
  const resolved = {
    platform: 'leetcode',
    url,
    slug: SLUG_1477,
    id: '1477',
    title: 'Find Two Non-overlapping Sub-arrays Each With Target Sum',
    difficulty: 'Medium',
  };

  it('uses the GraphQL question query', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(fixtures.graphqlQuestion)),
    );
    const problem = await lookupProblem(SLUG_1477, {
      fetch: fetchMock,
      readNextData: () => undefined,
    });

    expect(problem).toEqual(resolved);
    const [requestUrl, init] = fetchMock.mock.calls[0] ?? [];
    expect(requestUrl).toBe('https://leetcode.com/graphql/');
    expect(JSON.parse(init?.body as string)).toMatchObject({ variables: { titleSlug: SLUG_1477 } });
  });

  it('falls back to __NEXT_DATA__ when GraphQL fails', async () => {
    const problem = await lookupProblem(SLUG_1477, {
      fetch: () => Promise.reject(new Error('offline')),
      readNextData: () => fixtures.nextData,
    });
    expect(problem).toEqual(resolved);
  });

  it('returns only the slug when page data is stale', async () => {
    const problem = await lookupProblem('two-sum', {
      fetch: () => Promise.resolve(new Response('', { status: 500 })),
      readNextData: () => fixtures.nextData,
    });
    expect(problem).toEqual({
      platform: 'leetcode',
      url: 'https://leetcode.com/problems/two-sum/',
      slug: 'two-sum',
    });
  });
});

describe('leetCodeObservationRule', () => {
  it('captures request bodies only for submit', () => {
    expect(leetCodeObservationRule(at('/problems/two-sum/submit/'), 'POST')).toEqual({
      captureRequestBody: true,
    });
    expect(leetCodeObservationRule(at('/submissions/detail/1/v2/check/'), 'GET')).toEqual({
      captureRequestBody: false,
    });
    expect(leetCodeObservationRule(at('/graphql/'), 'POST')).toBeUndefined();
  });
});

describe('fetchSubmissionDetails', () => {
  it('queries submissionDetails with a numeric id and parses the result', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(fixtures.submissionDetails)),
    );
    const details = await fetchSubmissionDetails('1000000005', { fetch: fetchMock });

    expect(details?.question?.titleSlug).toBe('two-sum');
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
      query: string;
      variables: unknown;
    };
    expect(body.variables).toEqual({ submissionId: 1000000005 });
    expect(body.query).not.toMatch(/user/i);
  });

  it('returns undefined on network or HTTP failure', async () => {
    expect(
      await fetchSubmissionDetails('1', { fetch: () => Promise.reject(new Error('offline')) }),
    ).toBeUndefined();
    expect(
      await fetchSubmissionDetails('1', {
        fetch: () => Promise.resolve(new Response('', { status: 500 })),
      }),
    ).toBeUndefined();
  });
});
