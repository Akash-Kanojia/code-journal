import { describe, expect, it } from 'vitest';
import { isSubmissionStatus, SUBMISSION_STATUSES } from '../../src/core/models/submission-result';
import { isPlatform, PLATFORMS } from '../../src/core/types/platform';
import {
  isContentRequest,
  isImportCommand,
  isPopupRequest,
  isSubmissionCapturedRequest,
} from '../../src/core/types/messages';

describe('core type guards', () => {
  it('recognises every declared submission status and nothing else', () => {
    for (const status of SUBMISSION_STATUSES) {
      expect(isSubmissionStatus(status)).toBe(true);
    }
    expect(new Set(SUBMISSION_STATUSES).size).toBe(SUBMISSION_STATUSES.length);
    expect(isSubmissionStatus('Accepted')).toBe(false);
    expect(isSubmissionStatus(undefined)).toBe(false);
  });

  it('recognises supported platforms', () => {
    expect(PLATFORMS).toEqual(['leetcode', 'gfg']);
    expect(isPlatform('leetcode')).toBe(true);
    expect(isPlatform('codeforces')).toBe(false);
  });

  it('validates popup requests', () => {
    expect(isPopupRequest({ type: 'GET_STATUS' })).toBe(true);
    expect(isPopupRequest({ type: 'LIST_BRANCHES', owner: 'a', name: 'b' })).toBe(true);
    expect(isPopupRequest({ type: 'LIST_BRANCHES', owner: 'a' })).toBe(false);
    expect(
      isPopupRequest({ type: 'SAVE_SETTINGS', settings: { directory: 'x', branch: null } }),
    ).toBe(true);
    expect(isPopupRequest({ type: 'SAVE_SETTINGS', settings: { directory: 3 } })).toBe(false);
    expect(isPopupRequest({ type: 'SUBMISSION_CAPTURED' })).toBe(false);
    expect(isPopupRequest(null)).toBe(false);
  });

  it('validates captured submissions structurally', () => {
    const submission = {
      id: '1',
      platform: 'leetcode',
      problem: {
        platform: 'leetcode',
        id: '1',
        title: 'Two Sum',
        url: 'https://leetcode.com/problems/two-sum/',
      },
      language: 'cpp',
      code: '',
      status: 'accepted',
      submittedAt: '2026-09-28T12:00:00.000Z',
      metrics: { runtimeMs: 3 },
    };
    expect(isSubmissionCapturedRequest({ type: 'SUBMISSION_CAPTURED', submission })).toBe(true);
    for (const broken of [
      { ...submission, status: 'Accepted' },
      { ...submission, platform: 'codeforces' },
      { ...submission, problem: { ...submission.problem, platform: 'gfg' } },
      { ...submission, submittedAt: 'yesterday' },
      { ...submission, metrics: { runtimeMs: -1 } },
      { ...submission, code: undefined },
    ]) {
      expect(isSubmissionCapturedRequest({ type: 'SUBMISSION_CAPTURED', submission: broken })).toBe(
        false,
      );
    }
  });
});

describe('content requests', () => {
  it('accepts import batches and id lookups from content scripts, within limits', () => {
    expect(isContentRequest({ type: 'SUBMISSIONS_IMPORTED', submissions: [] })).toBe(true);
    expect(
      isContentRequest({ type: 'SUBMISSIONS_IMPORTED', submissions: new Array(101).fill({}) }),
    ).toBe(false);
    expect(
      isContentRequest({ type: 'FILTER_UNKNOWN_SUBMISSIONS', platform: 'leetcode', ids: ['1'] }),
    ).toBe(true);
    expect(
      isContentRequest({ type: 'FILTER_UNKNOWN_SUBMISSIONS', platform: 'x', ids: ['1'] }),
    ).toBe(false);
    expect(isContentRequest({ type: 'GET_STATUS' })).toBe(false);
    expect(isImportCommand({ type: 'START_IMPORT', restart: false })).toBe(true);
    expect(isImportCommand({ type: 'START_IMPORT' })).toBe(false);
  });
});
