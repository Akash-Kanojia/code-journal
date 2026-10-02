import type { BridgeMessage } from './bridge';

export interface ObservationRule {
  /** Whether the request body should be forwarded (only for requests that carry submitted code/ids). */
  captureRequestBody: boolean;
}

/** Decides synchronously, from URL and method only, whether a request is observed. */
export type RequestClassifier = (url: URL, method: string) => ObservationRule | undefined;

export interface NetworkObserverOptions {
  channel: string;
  classify: RequestClassifier;
  /** Returns the URL relative request URLs resolve against (the current page URL). */
  baseUrl: () => string;
  post: (message: BridgeMessage) => void;
}

interface ObserverTarget {
  fetch: typeof fetch;
  XMLHttpRequest?: typeof XMLHttpRequest;
}

const INSTALLED = Symbol.for('code-journal.network-observer');

type CapturedBody = Pick<BridgeMessage, 'requestBody' | 'requestForm'>;

/** Text fields of a form body. Files are skipped. */
function formFields(form: FormData | URLSearchParams): Record<string, string> {
  const fields: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === 'string') fields[key] = value;
  });
  return fields;
}

function captureBody(body: unknown): CapturedBody | undefined {
  if (typeof body === 'string') return { requestBody: body };
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return { requestForm: formFields(body) };
  }
  if (body instanceof URLSearchParams) return { requestForm: formFields(body) };
  return undefined;
}

/**
 * Wraps `fetch` and `XMLHttpRequest` so that responses of submission endpoints are reported
 * through `post`. The page's requests and responses pass through untouched, and observer
 * failures never affect the page.
 */
export function installNetworkObserver(
  target: ObserverTarget,
  options: NetworkObserverOptions,
): void {
  const marked = target as ObserverTarget & { [INSTALLED]?: true };
  if (marked[INSTALLED]) {
    return;
  }
  marked[INSTALLED] = true;
  wrapFetch(target, options);
  if (target.XMLHttpRequest !== undefined) {
    wrapXhr(target.XMLHttpRequest, options);
  }
}

function resolve(
  rawUrl: string,
  method: string,
  options: NetworkObserverOptions,
): { url: URL; rule: ObservationRule } | undefined {
  try {
    const url = new URL(rawUrl, options.baseUrl());
    const rule = options.classify(url, method);
    return rule === undefined ? undefined : { url, rule };
  } catch {
    return undefined;
  }
}

function wrapFetch(target: ObserverTarget, options: NetworkObserverOptions): void {
  const originalFetch = target.fetch;

  target.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    let observed:
      { message: BridgeMessageBase; body: Promise<CapturedBody | undefined> } | undefined;
    try {
      const request = typeof input === 'string' || input instanceof URL ? undefined : input;
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
      const match = resolve(rawUrl, method, options);
      if (match !== undefined) {
        let body: Promise<CapturedBody | undefined> = Promise.resolve(undefined);
        if (match.rule.captureRequestBody) {
          if (init?.body !== undefined && init.body !== null) {
            body = Promise.resolve(captureBody(init.body));
          } else if (request !== undefined) {
            // Read a clone before fetch consumes the original body.
            body = request
              .clone()
              .text()
              .then((text) => ({ requestBody: text }));
          }
        }
        observed = {
          message: { channel: options.channel, url: match.url.href, method },
          body: body.catch(() => undefined),
        };
      }
    } catch {
      observed = undefined;
    }

    const result = originalFetch.call(this, input, init);
    if (observed === undefined) {
      return result;
    }
    const request = observed;
    return result.then((response) => {
      // Clone before the page receives the response: once the page reads the body,
      // it can no longer be cloned.
      try {
        const clone = response.clone();
        void Promise.all([request.body, clone.text()])
          .then(([body, responseBody]) => {
            options.post({ ...request.message, ...body, status: response.status, responseBody });
          })
          .catch(() => undefined);
      } catch {
        // Never interfere with the page.
      }
      return response;
    });
  };
}

type BridgeMessageBase = Pick<BridgeMessage, 'channel' | 'url' | 'method'>;

interface XhrState {
  method: string;
  rawUrl: string;
}

function wrapXhr(Xhr: typeof XMLHttpRequest, options: NetworkObserverOptions): void {
  const proto = Xhr.prototype;
  const states = new WeakMap<XMLHttpRequest, XhrState>();
  const originalOpen: (this: XMLHttpRequest, ...args: unknown[]) => void =
    Object.getOwnPropertyDescriptor(proto, 'open')?.value as (
      this: XMLHttpRequest,
      ...args: unknown[]
    ) => void;
  const originalSend: (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) => void = Object.getOwnPropertyDescriptor(proto, 'send')?.value as (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) => void;

  proto.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    try {
      const [method, url] = args;
      states.set(this, { method: String(method).toUpperCase(), rawUrl: String(url) });
    } catch {
      states.delete(this);
    }
    originalOpen.apply(this, args);
  };

  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    try {
      const state = states.get(this);
      const match = state === undefined ? undefined : resolve(state.rawUrl, state.method, options);
      if (state !== undefined && match !== undefined) {
        const captured = match.rule.captureRequestBody ? captureBody(body) : undefined;
        const message: BridgeMessageBase = {
          channel: options.channel,
          url: match.url.href,
          method: state.method,
        };
        this.addEventListener('loadend', () => {
          try {
            const responseBody = readXhrResponse(this);
            if (responseBody === undefined || this.status === 0) return;
            options.post({ ...message, ...captured, status: this.status, responseBody });
          } catch {
            // Never interfere with the page.
          }
        });
      }
    } catch {
      // Never interfere with the page.
    }
    originalSend.call(this, body);
  };
}

function readXhrResponse(xhr: XMLHttpRequest): string | undefined {
  if (xhr.responseType === '' || xhr.responseType === 'text') return xhr.responseText;
  if (xhr.responseType === 'json') return JSON.stringify(xhr.response);
  return undefined;
}
