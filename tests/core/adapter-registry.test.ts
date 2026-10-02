import { describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../../src/core/adapters/adapter-registry';
import type { PlatformAdapter } from '../../src/core/adapters/platform-adapter';
import type { Platform } from '../../src/core/types/platform';

function fakeAdapter(platform: Platform, host: string): PlatformAdapter {
  return {
    platform,
    canHandle: (url) => url.hostname === host,
    start: () => () => undefined,
  };
}

describe('AdapterRegistry', () => {
  it('finds the adapter that can handle a URL', () => {
    const registry = new AdapterRegistry();
    const leetcode = fakeAdapter('leetcode', 'leetcode.com');
    const gfg = fakeAdapter('gfg', 'www.geeksforgeeks.org');
    registry.register(leetcode);
    registry.register(gfg);

    expect(registry.findForUrl(new URL('https://leetcode.com/problems/two-sum/'))).toBe(leetcode);
    expect(registry.findForUrl(new URL('https://www.geeksforgeeks.org/problems/x/1'))).toBe(gfg);
  });

  it('returns undefined when no adapter matches', () => {
    const registry = new AdapterRegistry();
    registry.register(fakeAdapter('leetcode', 'leetcode.com'));

    expect(registry.findForUrl(new URL('https://example.com/'))).toBeUndefined();
  });

  it('rejects a second adapter for the same platform', () => {
    const registry = new AdapterRegistry();
    registry.register(fakeAdapter('leetcode', 'leetcode.com'));

    expect(() => {
      registry.register(fakeAdapter('leetcode', 'leetcode.cn'));
    }).toThrow(/already registered/);
  });

  it('looks up and lists adapters by platform', () => {
    const registry = new AdapterRegistry();
    const leetcode = fakeAdapter('leetcode', 'leetcode.com');
    registry.register(leetcode);

    expect(registry.get('leetcode')).toBe(leetcode);
    expect(registry.get('gfg')).toBeUndefined();
    expect(registry.list()).toEqual([leetcode]);
  });
});
