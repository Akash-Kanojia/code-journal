import type { Logger } from '../core/logger';
import type { SecretStore } from '../storage/storage';
import { GITHUB_API } from './github-client';

/**
 * GitHub OAuth Device Flow (RFC 8628).
 *
 * Why the device flow: the web (redirect) flow needs the OAuth App's client secret to
 * exchange the code for a token, and an extension cannot keep a secret — anything shipped
 * in the bundle is public. The device flow needs only the public client id, there is no
 * Code Journal server, and the token never passes through a web page.
 */
export const DEVICE_CODE_URL = 'https://github.com/login/device/code';
export const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

const TOKEN_SECRET = 'github.token';

export interface StoredToken {
  accessToken: string;
  scope: string;
  login: string;
  createdAt: string;
}

/** The part of a pending device authorization that the popup may display. */
export interface DeviceAuthorization {
  userCode: string;
  verificationUri: string;
  expiresAt: string;
}

/** Persisted (in session storage) so polling survives a service-worker restart. */
export interface PendingDeviceFlow extends DeviceAuthorization {
  deviceCode: string;
  intervalSeconds: number;
  scope: string;
}

export type AuthState =
  | { status: 'disconnected'; error?: string }
  | { status: 'pending'; authorization: DeviceAuthorization }
  | { status: 'connected'; login: string; scope: string };

export interface PendingFlowStore {
  get(): Promise<PendingDeviceFlow | undefined>;
  set(flow: PendingDeviceFlow | undefined): Promise<void>;
}

export interface GitHubAuthDeps {
  fetch: typeof fetch;
  secrets: SecretStore;
  pending: PendingFlowStore;
  logger: Logger;
  now(): Date;
  sleep(ms: number): Promise<void>;
}

export type PollResult =
  | { status: 'connected'; login: string }
  | { status: 'pending' }
  | { status: 'failed'; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function postForm(
  fetchFn: typeof fetch,
  url: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetchFn(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (!isRecord(body)) {
    throw new Error(`GitHub returned HTTP ${String(response.status)} without a JSON body`);
  }
  return body;
}

const DEVICE_ERRORS: Readonly<Record<string, string>> = {
  expired_token: 'The code expired. Start connecting again.',
  access_denied: 'Authorization was cancelled on GitHub.',
  incorrect_client_credentials: 'The GitHub OAuth client id is not valid.',
  device_flow_disabled: 'Device Flow is not enabled for this GitHub OAuth App.',
  unsupported_grant_type: 'GitHub rejected the device grant.',
  incorrect_device_code: 'GitHub did not recognise the device code.',
};

export class GitHubAuth {
  constructor(private readonly deps: GitHubAuthDeps) {}

  async getToken(): Promise<string | undefined> {
    return (await this.deps.secrets.getSecret<StoredToken>(TOKEN_SECRET))?.accessToken;
  }

  async isAuthenticated(): Promise<boolean> {
    return (await this.getToken()) !== undefined;
  }

  async getState(): Promise<AuthState> {
    const token = await this.deps.secrets.getSecret<StoredToken>(TOKEN_SECRET);
    if (token !== undefined) {
      return { status: 'connected', login: token.login, scope: token.scope };
    }
    const pending = await this.deps.pending.get();
    if (pending !== undefined && Date.parse(pending.expiresAt) > this.deps.now().getTime()) {
      return { status: 'pending', authorization: publicPart(pending) };
    }
    return { status: 'disconnected' };
  }

  /** Requests a device + user code. The user enters the user code at `verificationUri`. */
  async start(clientId: string, scope: string): Promise<DeviceAuthorization> {
    const body = await postForm(this.deps.fetch, DEVICE_CODE_URL, { client_id: clientId, scope });
    if (typeof body.error === 'string') {
      throw new Error(DEVICE_ERRORS[body.error] ?? `GitHub error: ${body.error}`);
    }
    const { device_code, user_code, verification_uri, expires_in, interval } = body;
    if (
      typeof device_code !== 'string' ||
      typeof user_code !== 'string' ||
      typeof verification_uri !== 'string' ||
      typeof expires_in !== 'number'
    ) {
      throw new Error('GitHub returned an unexpected device authorization response');
    }
    const flow: PendingDeviceFlow = {
      deviceCode: device_code,
      userCode: user_code,
      verificationUri: verification_uri,
      expiresAt: new Date(this.deps.now().getTime() + expires_in * 1000).toISOString(),
      intervalSeconds: typeof interval === 'number' && interval > 0 ? interval : 5,
      scope,
    };
    await this.deps.pending.set(flow);
    this.deps.logger.info('GitHub device authorization started');
    return publicPart(flow);
  }

  async cancel(): Promise<void> {
    await this.deps.pending.set(undefined);
  }

  /** Polls once. Call repeatedly, waiting `intervalSeconds` between calls. */
  async pollOnce(clientId: string): Promise<PollResult> {
    const flow = await this.deps.pending.get();
    if (flow === undefined) return { status: 'failed', error: 'No authorization in progress' };
    if (Date.parse(flow.expiresAt) <= this.deps.now().getTime()) {
      await this.deps.pending.set(undefined);
      return { status: 'failed', error: DEVICE_ERRORS.expired_token ?? 'expired' };
    }

    const body = await postForm(this.deps.fetch, ACCESS_TOKEN_URL, {
      client_id: clientId,
      device_code: flow.deviceCode,
      grant_type: DEVICE_GRANT,
    });
    if (typeof body.access_token === 'string' && body.access_token !== '') {
      const scope = typeof body.scope === 'string' ? body.scope : flow.scope;
      // The device code is single-use, so the token is kept even if the account lookup fails.
      const login = await this.fetchLogin(body.access_token).catch(() => '');
      await this.deps.secrets.setSecret(TOKEN_SECRET, {
        accessToken: body.access_token,
        scope,
        login,
        createdAt: this.deps.now().toISOString(),
      } satisfies StoredToken);
      await this.deps.pending.set(undefined);
      this.deps.logger.info('Connected to GitHub', { login, scope });
      return { status: 'connected', login };
    }
    const error = typeof body.error === 'string' ? body.error : 'unknown_error';
    if (error === 'authorization_pending') return { status: 'pending' };
    if (error === 'slow_down') {
      const interval = typeof body.interval === 'number' ? body.interval : flow.intervalSeconds + 5;
      await this.deps.pending.set({ ...flow, intervalSeconds: interval });
      return { status: 'pending' };
    }
    await this.deps.pending.set(undefined);
    return { status: 'failed', error: DEVICE_ERRORS[error] ?? `GitHub error: ${error}` };
  }

  /** Polls until connected, failed, expired or cancelled. */
  async waitForAuthorization(clientId: string, onTick?: () => Promise<void>): Promise<PollResult> {
    for (;;) {
      const flow = await this.deps.pending.get();
      if (flow === undefined) return { status: 'failed', error: 'Authorization cancelled' };
      await this.deps.sleep(flow.intervalSeconds * 1000);
      await onTick?.();
      let result: PollResult;
      try {
        result = await this.pollOnce(clientId);
      } catch (error) {
        // Network blip: keep polling until the code expires.
        this.deps.logger.warn('GitHub authorization poll failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (result.status !== 'pending') return result;
    }
  }

  /** Forgets the token locally. The user can revoke the grant on GitHub too (see README). */
  async disconnect(): Promise<void> {
    await this.deps.secrets.deleteSecret(TOKEN_SECRET);
    await this.deps.pending.set(undefined);
    this.deps.logger.info('Disconnected from GitHub');
  }

  private async fetchLogin(token: string): Promise<string> {
    const response = await this.deps.fetch(`${GITHUB_API}/user`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15_000),
    });
    const body: unknown = response.ok ? await response.json() : undefined;
    if (!isRecord(body) || typeof body.login !== 'string') {
      throw new Error(`Could not read the GitHub account (HTTP ${String(response.status)})`);
    }
    return body.login;
  }
}

function publicPart(flow: PendingDeviceFlow): DeviceAuthorization {
  return {
    userCode: flow.userCode,
    verificationUri: flow.verificationUri,
    expiresAt: flow.expiresAt,
  };
}
