import { describe, expect, it, vi } from 'vitest';
import { gfgObservationRule } from '../../../src/platforms/gfg/gfg-api';
import { leetCodeObservationRule } from '../../../src/platforms/leetcode/leetcode-api';
import type { BridgeMessage } from '../../../src/platforms/shared/bridge';
import {
  installNetworkObserver,
  type RequestClassifier,
} from '../../../src/platforms/shared/network-observer';
import { fixtures } from '../leetcode/fixtures';

const BASE = 'https://leetcode.com/problems/two-sum/description/';

function setup(
  respond: (url: string) => Response,
  classify: RequestClassifier = leetCodeObservationRule,
) {
  const pageFetch = vi.fn<typeof fetch>((input) =>
    Promise.resolve(respond(input instanceof Request ? input.url : String(input))),
  );
  const target = { fetch: pageFetch as typeof fetch };
  const posted: BridgeMessage[] = [];
  installNetworkObserver(target, {
    channel: 'test',
    classify,
    baseUrl: () => BASE,
    post: (m) => posted.push(m),
  });
  return { target, pageFetch, posted };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('installNetworkObserver: fetch', () => {
  it('reports submit request and response bodies and passes the response through', async () => {
    const { target, posted } = setup(() => new Response(fixtures.submitResponse));

    const response = await target.fetch('/problems/two-sum/submit/', {
      method: 'POST',
      headers: { 'x-csrftoken': 'secret' },
      body: fixtures.submitRequest,
    });
    await flush();

    expect(await response.text()).toBe(fixtures.submitResponse);
    expect(posted).toEqual([
      {
        channel: 'test',
        url: 'https://leetcode.com/problems/two-sum/submit/',
        method: 'POST',
        status: 200,
        requestBody: fixtures.submitRequest,
        responseBody: fixtures.submitResponse,
      },
    ]);
    expect(JSON.stringify(posted)).not.toContain('secret');
  });

  it('still reports when the page reads the response body immediately', async () => {
    const { target, posted } = setup(() => new Response(fixtures.checkPending));

    // Pages await fetch and read the body right away; the observer must have cloned it already.
    const body: unknown = await target
      .fetch('/submissions/detail/1/v2/check/')
      .then((r) => r.json());
    await flush();

    expect(body).toEqual({ state: 'PENDING' });
    expect(posted.map((m) => m.responseBody)).toEqual([fixtures.checkPending]);
  });

  it('reads the body of a Request object without consuming the page request', async () => {
    const { target, pageFetch, posted } = setup(() => new Response(fixtures.submitResponse));
    const request = new Request('https://leetcode.com/problems/two-sum/submit/', {
      method: 'POST',
      body: fixtures.submitRequest,
    });

    await target.fetch(request);
    await flush();

    expect(posted[0]?.requestBody).toBe(fixtures.submitRequest);
    expect(pageFetch).toHaveBeenCalledWith(request, undefined);
  });

  it('serialises FormData bodies (GFG) as text fields', async () => {
    const { target, posted } = setup(
      () => new Response('{"results":{"submission_id":"1"}}'),
      gfgObservationRule,
    );
    const form = new FormData();
    form.append('userCode', 'int main() {}');
    form.append('language', 'cpp');
    form.append('file', new Blob(['binary']), 'f.bin');

    await target.fetch(
      'https://practiceapiorigin.geeksforgeeks.org/api/latest/problems/key-pair5616/submit/compile/',
      { method: 'POST', body: form, credentials: 'include' },
    );
    await flush();

    expect(posted[0]).toMatchObject({
      method: 'POST',
      requestForm: { userCode: 'int main() {}', language: 'cpp' },
    });
    expect(posted[0]?.requestForm).not.toHaveProperty('file');
  });

  it('does not forward request bodies of endpoints that do not need them', async () => {
    const { target, posted } = setup(() => new Response(fixtures.checkPending));

    await target.fetch('/submissions/detail/1000000002/v2/check/');
    await flush();

    expect(posted).toHaveLength(1);
    expect(posted[0]).not.toHaveProperty('requestBody');
  });

  it('ignores unrelated requests, including Run', async () => {
    const { target, posted } = setup(() => new Response('{}'));

    await target.fetch('/graphql/', { method: 'POST', body: '{}' });
    await target.fetch('/problems/two-sum/interpret_solution/', { method: 'POST', body: '{}' });
    await flush();

    expect(posted).toEqual([]);
  });

  it('propagates page fetch failures unchanged', async () => {
    const target = { fetch: (() => Promise.reject(new TypeError('offline'))) as typeof fetch };
    const post = vi.fn();
    installNetworkObserver(target, {
      channel: 'test',
      classify: leetCodeObservationRule,
      baseUrl: () => BASE,
      post,
    });

    await expect(target.fetch('/problems/two-sum/submit/', { method: 'POST' })).rejects.toThrow(
      'offline',
    );
    await flush();
    expect(post).not.toHaveBeenCalled();
  });

  it('never breaks the page when the classifier throws', async () => {
    const { target, posted } = setup(
      () => new Response('ok'),
      () => {
        throw new Error('bug');
      },
    );
    const response = await target.fetch('/anything');
    expect(await response.text()).toBe('ok');
    expect(posted).toEqual([]);
  });

  it('installs only once per target', async () => {
    const { target, posted } = setup(() => new Response(fixtures.checkPending));
    installNetworkObserver(target, {
      channel: 'test',
      classify: leetCodeObservationRule,
      baseUrl: () => BASE,
      post: (m) => posted.push(m),
    });

    await target.fetch('/submissions/detail/1/v2/check/');
    await flush();

    expect(posted).toHaveLength(1);
  });
});

/** Minimal XMLHttpRequest stand-in: records calls and fires loadend on respond(). */
class FakeXhr {
  static instances: FakeXhr[] = [];
  status = 0;
  responseType = '';
  responseText = '';
  response: unknown = '';
  sent: unknown;
  private listeners: (() => void)[] = [];
  constructor() {
    FakeXhr.instances.push(this);
  }
  open(): void {
    // Arguments are read by the observer's wrapper.
  }
  send(body?: unknown): void {
    this.sent = body;
  }
  addEventListener(type: string, listener: () => void): void {
    if (type === 'loadend') this.listeners.push(listener);
  }
  respond(status: number, text: string): void {
    this.status = status;
    this.responseText = text;
    for (const l of this.listeners) l();
  }
}

describe('installNetworkObserver: XMLHttpRequest', () => {
  it('reports XHR submission traffic with form bodies', () => {
    FakeXhr.instances = [];
    const posted: BridgeMessage[] = [];
    const target = {
      fetch: vi.fn() as unknown as typeof fetch,
      XMLHttpRequest: FakeXhr as unknown as typeof XMLHttpRequest,
    };
    installNetworkObserver(target, {
      channel: 'gfg',
      classify: gfgObservationRule,
      baseUrl: () => 'https://www.geeksforgeeks.org/problems/key-pair5616/1',
      post: (m) => posted.push(m),
    });

    const form = new FormData();
    form.append('sub_id', 'abc123');
    form.append('pid', '703092');
    const xhr = new target.XMLHttpRequest();
    xhr.open(
      'post',
      'https://practiceapiorigin.geeksforgeeks.org/api/latest/problems/submission/submit/result/',
    );
    xhr.send(form);
    (xhr as unknown as FakeXhr).respond(200, '{"status":"QUEUED"}');

    const other = new target.XMLHttpRequest();
    other.open('GET', 'https://www.geeksforgeeks.org/other');
    other.send();
    (other as unknown as FakeXhr).respond(200, 'x');

    expect(posted).toEqual([
      {
        channel: 'gfg',
        url: 'https://practiceapiorigin.geeksforgeeks.org/api/latest/problems/submission/submit/result/',
        method: 'POST',
        status: 200,
        requestForm: { sub_id: 'abc123', pid: '703092' },
        responseBody: '{"status":"QUEUED"}',
      },
    ]);
    expect((xhr as unknown as FakeXhr).sent).toBe(form);
  });
});
