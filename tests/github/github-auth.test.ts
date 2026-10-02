import { describe, expect, it, vi } from 'vitest';
import { createLogger, type LogSink } from '../../src/core/logger';
import { GitHubAuth, type PendingDeviceFlow } from '../../src/github/github-auth';
import type { SecretStore } from '../../src/storage/storage';

class MemorySecrets implements SecretStore {
  readonly values = new Map<string, unknown>();
  getSecret<T>(name: string): Promise<T | undefined> {
    return Promise.resolve(this.values.get(name) as T | undefined);
  }
  setSecret(name: string, value: unknown): Promise<void> {
    this.values.set(name, value);
    return Promise.resolve();
  }
  deleteSecret(name: string): Promise<void> {
    this.values.delete(name);
    return Promise.resolve();
  }
}

const TOKEN = 'gho_DEVICE_FLOW_TOKEN';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function setup(tokenResponses: unknown[]) {
  const secrets = new MemorySecrets();
  let pending: PendingDeviceFlow | undefined;
  const sink = vi.fn<LogSink>();
  const calls: { url: string; body: string }[] = [];
  let now = Date.parse('2026-10-01T10:00:00Z');
  const fetchMock: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : '' });
    if (url === 'https://github.com/login/device/code') {
      return Promise.resolve(
        json({
          device_code: 'DEVICE',
          user_code: 'ABCD-1234',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        }),
      );
    }
    if (url === 'https://github.com/login/oauth/access_token') {
      return Promise.resolve(json(tokenResponses.shift() ?? { error: 'authorization_pending' }));
    }
    if (url === 'https://api.github.com/user') return Promise.resolve(json({ login: 'octo' }));
    return Promise.resolve(json({}, 404));
  };
  const sleeps: number[] = [];
  const auth = new GitHubAuth({
    fetch: fetchMock,
    secrets,
    pending: {
      get: () => Promise.resolve(pending),
      set: (flow) => {
        pending = flow;
        return Promise.resolve();
      },
    },
    logger: createLogger('github', sink),
    now: () => new Date(now),
    sleep: (ms) => {
      sleeps.push(ms);
      now += ms;
      return Promise.resolve();
    },
  });
  return { auth, secrets, sink, calls, sleeps, advance: (ms: number) => (now += ms) };
}

describe('GitHubAuth (device flow)', () => {
  it('connects after the user authorizes, honouring slow_down', async () => {
    const { auth, calls, sleeps, sink } = setup([
      { error: 'authorization_pending' },
      { error: 'slow_down', interval: 10 },
      { access_token: TOKEN, token_type: 'bearer', scope: 'repo' },
    ]);
    expect(await auth.getState()).toEqual({ status: 'disconnected' });

    const authorization = await auth.start('Iv1.client', 'repo');
    expect(authorization).toEqual({
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresAt: '2026-10-01T10:15:00.000Z',
    });
    expect(calls[0]?.body).toBe('client_id=Iv1.client&scope=repo');
    expect(await auth.getState()).toMatchObject({ status: 'pending' });

    expect(await auth.waitForAuthorization('Iv1.client')).toEqual({
      status: 'connected',
      login: 'octo',
    });
    expect(sleeps).toEqual([5000, 5000, 10000]);
    expect(await auth.getToken()).toBe(TOKEN);
    expect(await auth.getState()).toEqual({ status: 'connected', login: 'octo', scope: 'repo' });
    expect(JSON.stringify(sink.mock.calls)).not.toContain(TOKEN);
    expect(calls.some((c) => c.body.includes('client_secret'))).toBe(false);
  });

  it.each([
    ['access_denied', /cancelled on GitHub/],
    ['device_flow_disabled', /Device Flow is not enabled/],
    ['expired_token', /expired/],
  ])('fails with a clear message on %s', async (error, message) => {
    const { auth } = setup([{ error }]);
    await auth.start('id', 'repo');
    const result = await auth.waitForAuthorization('id');
    expect(result).toMatchObject({ status: 'failed' });
    expect(result.status === 'failed' ? result.error : '').toMatch(message);
    expect(await auth.getState()).toEqual({ status: 'disconnected' });
  });

  it('stops when the code expires or the flow is cancelled', async () => {
    const { auth, advance } = setup([]);
    await auth.start('id', 'repo');
    advance(901_000);
    expect(await auth.pollOnce('id')).toMatchObject({ status: 'failed' });

    await auth.start('id', 'repo');
    await auth.cancel();
    expect(await auth.waitForAuthorization('id')).toEqual({
      status: 'failed',
      error: 'Authorization cancelled',
    });
  });

  it('forgets the token on disconnect', async () => {
    const { auth, secrets } = setup([{ access_token: TOKEN, scope: 'public_repo' }]);
    await auth.start('id', 'public_repo');
    await auth.pollOnce('id');
    expect(await auth.isAuthenticated()).toBe(true);

    await auth.disconnect();
    expect(await auth.isAuthenticated()).toBe(false);
    expect(secrets.values.size).toBe(0);
  });
});
