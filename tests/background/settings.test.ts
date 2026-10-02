import { describe, expect, it } from 'vitest';
import { applySettingsUpdate, DEFAULT_SETTINGS, oauthScope } from '../../src/background/settings';

const repo = { owner: 'octo', name: 'journal', fullName: 'octo/journal', private: false };

describe('settings', () => {
  it('applies updates and normalises the directory', () => {
    const next = applySettingsUpdate(DEFAULT_SETTINGS, {
      repository: repo,
      branch: ' main ',
      directory: '/code-journal/',
      clientId: ' Iv1.abc ',
    });
    expect(next).toEqual({
      ...DEFAULT_SETTINGS,
      repository: repo,
      branch: 'main',
      directory: 'code-journal',
      clientId: 'Iv1.abc',
    });
  });

  it('clears the branch when the repository changes, and clears fields set to null', () => {
    const current = applySettingsUpdate(DEFAULT_SETTINGS, { repository: repo, branch: 'main' });
    expect(
      applySettingsUpdate(current, {
        repository: { ...repo, name: 'other', fullName: 'octo/other' },
      }),
    ).not.toHaveProperty('branch');
    expect(applySettingsUpdate(current, { repository: null, clientId: '' })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('requests the narrowest scope that fits', () => {
    expect(oauthScope({ ...DEFAULT_SETTINGS, allowPrivateRepositories: true })).toBe('repo');
    expect(oauthScope({ ...DEFAULT_SETTINGS, allowPrivateRepositories: false })).toBe(
      'public_repo',
    );
  });
});
