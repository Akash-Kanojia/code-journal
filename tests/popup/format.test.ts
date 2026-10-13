import { describe, expect, it } from 'vitest';
import type { ImportProgress } from '../../src/core/types/import';
import { describeImport } from '../../src/popup/format';

const NOW = Date.parse('2026-10-04T10:00:00.000Z');
const progress = (overrides: Partial<ImportProgress>): ImportProgress => ({
  platform: 'leetcode',
  state: 'running',
  offset: 40,
  imported: 30,
  existing: 8,
  skipped: 2,
  startedAt: '2026-10-04T09:50:00.000Z',
  updatedAt: '2026-10-04T09:59:30.000Z',
  ...overrides,
});

describe('describeImport', () => {
  it('describes each import state for the popup', () => {
    expect(describeImport(undefined, NOW)).toMatchObject({ text: 'Not started', running: false });
    expect(describeImport(progress({}), NOW)).toEqual({
      text: 'Importing… 30 imported, 8 already saved, 2 skipped',
      running: true,
      startLabel: 'Importing…',
    });
    expect(describeImport(progress({ updatedAt: '2026-10-04T09:00:00.000Z' }), NOW)).toMatchObject({
      text: 'Interrupted (30 imported, 8 already saved)',
      running: false,
      startLabel: 'Resume from this tab',
    });
    expect(
      describeImport(progress({ state: 'done', finishedAt: '2026-10-04T09:59:30.000Z' }), NOW),
    ).toMatchObject({
      running: false,
      startLabel: 'Check for new submissions',
    });
    expect(describeImport(progress({ state: 'failed', error: 'x' }), NOW).text).toBe(
      'Failed (30 imported, 8 already saved)',
    );
  });
});
