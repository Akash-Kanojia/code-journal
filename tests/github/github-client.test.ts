import { describe, expect, it } from 'vitest';
import { GitProviderError } from '../../src/core/services/git-provider';
import { GitHubClient, toProviderError } from '../../src/github/github-client';

const TOKEN = 'gho_SECRET_TOKEN';

function client(respond: typeof fetch, connected = true) {
  return new GitHubClient({
    fetch: respond,
    getToken: () => Promise.resolve(connected ? TOKEN : undefined),
  });
}

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe('toProviderError', () => {
  it.each([
    [res(401, { message: 'Bad credentials' }), 'auth'],
    [res(403, { message: 'Resource not accessible' }), 'permission'],
    [
      res(403, { message: 'x' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000' }),
      'rate_limited',
    ],
    [res(403, { message: 'You have exceeded a secondary rate limit' }), 'rate_limited'],
    [res(429, { message: 'slow down' }, { 'retry-after': '60' }), 'rate_limited'],
    [res(404, { message: 'Not Found' }), 'not_found'],
    [res(409, { message: 'Conflict' }), 'conflict'],
    [res(422, { message: 'Update is not a fast forward' }), 'conflict'],
    [res(422, { message: 'Validation failed' }), 'invalid'],
    [res(502, { message: 'Bad gateway' }), 'server'],
    [new Response('<html>', { status: 500 }), 'server'],
  ])('classifies %#', async (response, kind) => {
    expect((await toProviderError(response, 1_000_000)).kind).toBe(kind);
  });

  it('uses rate-limit headers for the retry delay', async () => {
    const reset = await toProviderError(
      res(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1060' }),
      1_000_000,
    );
    expect(reset.retryAfterMs).toBe(60_000);
    const retryAfter = await toProviderError(res(429, {}, { 'retry-after': '30' }));
    expect(retryAfter.retryAfterMs).toBe(30_000);
  });
});

describe('GitHubClient', () => {
  it('sends the token only in the Authorization header', async () => {
    let seen: RequestInit | undefined;
    let url = '';
    const c = client((...args: Parameters<typeof fetch>) => {
      const [input] = args;
      url = input instanceof Request ? input.url : input.toString();
      seen = args[1];
      return Promise.resolve(res(200, { ok: true }));
    });
    expect(await c.request('/user')).toEqual({ ok: true });
    expect(url).toBe('https://api.github.com/user');
    expect(new Headers(seen?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('fails as "auth" when not connected, without calling GitHub', async () => {
    let called = false;
    const c = client(() => {
      called = true;
      return Promise.resolve(res(200, {}));
    }, false);
    await expect(c.request('/user')).rejects.toMatchObject({ kind: 'auth' });
    expect(called).toBe(false);
  });

  it('maps network failures and malformed bodies', async () => {
    await expect(
      client(() => Promise.reject(new TypeError('Failed to fetch'))).request('/x'),
    ).rejects.toMatchObject({
      kind: 'network',
    });
    await expect(
      client(() => Promise.resolve(new Response('not json'))).request('/x'),
    ).rejects.toMatchObject({
      kind: 'server',
    });
  });

  it('returns undefined for allowed statuses', async () => {
    expect(
      await client(() => Promise.resolve(res(404, {}))).request('/x', { allow: [404] }),
    ).toBeUndefined();
  });

  it('never includes the token in error messages', async () => {
    const error = await client(() => Promise.resolve(res(500, { message: 'boom' })))
      .request('/x')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitProviderError);
    expect((error as Error).message).not.toContain(TOKEN);
  });
});
