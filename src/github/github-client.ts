import { GitProviderError, type GitProviderErrorKind } from '../core/services/git-provider';

export const GITHUB_API = 'https://api.github.com';

export interface GitHubClientDeps {
  fetch: typeof fetch;
  /** Returns the current access token, or undefined when not connected. */
  getToken(): Promise<string | undefined>;
  timeoutMs?: number;
}

export interface GitHubRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Accept header; defaults to the JSON media type. */
  accept?: string;
  /** Status codes returned as `undefined` instead of throwing (e.g. 404 for "file absent"). */
  allow?: readonly number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.message === 'string') return body.message;
  } catch {
    // Not JSON.
  }
  return response.statusText || 'Request failed';
}

function rateLimitDelayMs(response: Response, now: number): number | undefined {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter !== null && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
  const reset = response.headers.get('x-ratelimit-reset');
  if (reset !== null && /^\d+$/.test(reset)) return Math.max(Number(reset) * 1000 - now, 1000);
  return undefined;
}

/** Maps an HTTP failure to a provider error. Error messages never include tokens. */
export async function toProviderError(
  response: Response,
  now = Date.now(),
): Promise<GitProviderError> {
  const message = await errorMessage(response);
  const status = response.status;
  const label = `GitHub API ${String(status)}: ${message}`;
  const rateLimited =
    status === 429 ||
    (status === 403 &&
      (response.headers.get('x-ratelimit-remaining') === '0' ||
        /rate limit/i.test(message) ||
        response.headers.has('retry-after')));
  if (rateLimited) {
    return new GitProviderError('rate_limited', label, rateLimitDelayMs(response, now));
  }
  let kind: GitProviderErrorKind;
  if (status === 401) kind = 'auth';
  else if (status === 403) kind = 'permission';
  else if (status === 404) kind = 'not_found';
  else if (status === 409) kind = 'conflict';
  else if (status === 422 && /fast.?forward|reference update failed/i.test(message))
    kind = 'conflict';
  else if (status >= 500) kind = 'server';
  else kind = 'invalid';
  return new GitProviderError(kind, label);
}

/** Minimal authenticated GitHub REST client. Only runs in the background service worker. */
export class GitHubClient {
  constructor(private readonly deps: GitHubClientDeps) {}

  async request<T>(path: string, options: GitHubRequest = {}): Promise<T | undefined> {
    const token = await this.deps.getToken();
    if (token === undefined) {
      throw new GitProviderError('auth', 'Not connected to GitHub');
    }
    const headers: Record<string, string> = {
      accept: options.accept ?? 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    };
    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(this.deps.timeoutMs ?? 20_000),
    };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.deps.fetch(`${GITHUB_API}${path}`, init);
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown';
      throw new GitProviderError('network', `GitHub request failed (${reason})`);
    }

    if (options.allow?.includes(response.status) === true) return undefined;
    if (!response.ok) throw await toProviderError(response);
    if (response.status === 204) return undefined;
    if (options.accept?.includes('raw') === true) return (await response.text()) as T;
    try {
      return (await response.json()) as T;
    } catch {
      throw new GitProviderError('server', 'GitHub returned a malformed response');
    }
  }

  /** Like `request`, but a missing body is an error. */
  async requestJson<T>(path: string, options: GitHubRequest = {}): Promise<T> {
    const result = await this.request<T>(path, options);
    if (result === undefined) {
      throw new GitProviderError('server', 'GitHub returned an empty response');
    }
    return result;
  }
}
