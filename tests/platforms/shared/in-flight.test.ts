import { describe, expect, it } from 'vitest';
import { InFlightSubmissions } from '../../../src/platforms/shared/in-flight';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('InFlightSubmissions', () => {
  it('runs steps for one id in order, after its init', async () => {
    const log: string[] = [];
    const inFlight = new InFlightSubmissions<{ n: number }>();
    let release: () => void = () => undefined;
    inFlight.start(
      'a',
      { n: 1 },
      () =>
        new Promise<void>(
          (r) =>
            (release = () => {
              log.push('init');
              r();
            }),
        ),
    );
    inFlight.enqueue('a', (ctx) => {
      log.push(`step ${String(ctx?.n ?? '')}`);
    });
    inFlight.enqueue('b', (ctx) => {
      log.push(`untracked ${ctx === undefined ? 'undefined' : 'defined'}`);
    });
    await flush();
    expect(log).toEqual(['untracked undefined']);
    release();
    await flush();
    expect(log).toEqual(['untracked undefined', 'init', 'step 1']);
  });

  it('returns the context from finish only once, and survives failing steps', async () => {
    const inFlight = new InFlightSubmissions<string>();
    inFlight.start('a', 'ctx', () => Promise.resolve());
    const seen: (string | undefined)[] = [];
    inFlight.enqueue('a', () => {
      throw new Error('boom');
    });
    inFlight.enqueue('a', (ctx) => {
      seen.push(ctx);
      seen.push(inFlight.finish('a'));
      seen.push(inFlight.finish('a'));
    });
    await flush();
    expect(seen).toEqual(['ctx', 'ctx', undefined]);
    expect(inFlight.has('a')).toBe(false);
  });
});
