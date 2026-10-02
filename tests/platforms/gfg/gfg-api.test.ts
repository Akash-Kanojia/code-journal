import { describe, expect, it, vi } from 'vitest';
import {
  classifyGfgRequest,
  gfgObservationRule,
  lookupProblem,
  problemUrl,
} from '../../../src/platforms/gfg/gfg-api';
import { GFG_RESULT_URL, GFG_SUBMIT_URL, gfgFixtures } from './fixtures';

describe('classifyGfgRequest', () => {
  it('recognises Submit and its result polling', () => {
    expect(classifyGfgRequest(new URL(GFG_SUBMIT_URL), 'POST')).toEqual({
      kind: 'submit',
      slug: 'key-pair5616',
    });
    expect(classifyGfgRequest(new URL(`${GFG_SUBMIT_URL}?batch_slug=x`), 'post')).toMatchObject({
      kind: 'submit',
    });
    expect(classifyGfgRequest(new URL(GFG_RESULT_URL), 'POST')).toEqual({ kind: 'result' });
    expect(
      classifyGfgRequest(
        new URL('https://practiceapi.geeksforgeeks.org/api/v1/problems/x/submit/compile/'),
        'POST',
      ),
    ).toMatchObject({ kind: 'submit', slug: 'x' });
  });

  it('ignores Compile & Run, other methods and other hosts', () => {
    const base = 'https://practiceapiorigin.geeksforgeeks.org/api/latest/problems';
    for (const [url, method] of [
      [`${base}/key-pair5616/compile-sub-id/`, 'POST'],
      [`${base}/submission/compile-run/result/`, 'POST'],
      [`${base}/submission/compile-output`, 'POST'],
      [GFG_SUBMIT_URL, 'GET'],
      ['https://evil.example/api/latest/problems/x/submit/compile/', 'POST'],
      ['http://practiceapi.geeksforgeeks.org/api/latest/problems/x/submit/compile/', 'POST'],
    ] as const) {
      expect(classifyGfgRequest(new URL(url), method)).toBeUndefined();
      expect(gfgObservationRule(new URL(url), method)).toBeUndefined();
    }
  });
});

describe('GFG lookupProblem', () => {
  const resolved = {
    platform: 'gfg',
    url: problemUrl('key-pair5616'),
    slug: 'key-pair5616',
    id: '703092',
    title: 'Two Sum - Pair with Given Sum',
    difficulty: 'Easy',
  };

  it('uses the public problem API without credentials', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(gfgFixtures.problemResponse)),
    );
    expect(
      await lookupProblem('key-pair5616', { fetch: fetchMock, readNextData: () => undefined }),
    ).toEqual(resolved);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://practiceapi.geeksforgeeks.org/api/latest/problems/key-pair5616/',
    );
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe('omit');
  });

  it('falls back to matching page data, then to the slug alone', async () => {
    const offline = () => Promise.reject(new Error('offline'));
    expect(
      await lookupProblem('key-pair5616', {
        fetch: offline,
        readNextData: () => gfgFixtures.nextData,
      }),
    ).toEqual(resolved);
    expect(
      await lookupProblem('other', { fetch: offline, readNextData: () => gfgFixtures.nextData }),
    ).toEqual({
      platform: 'gfg',
      url: problemUrl('other'),
      slug: 'other',
    });
  });
});
