import { beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/core/logger';
import { GitProviderError } from '../../src/core/services/git-provider';
import { JournalWriter, type JournalTarget } from '../../src/core/services/journal-writer';
import { GitHubClient } from '../../src/github/github-client';
import { GitHubRepositoryProvider, toBase64 } from '../../src/github/github-repository';
import { FakeGitHub } from '../helpers/fake-github';
import { leetCodeSubmission } from '../helpers/submissions';

const REPO = 'octo/journal';
const target: JournalTarget = {
  repository: { owner: 'octo', name: 'journal' },
  branch: 'main',
  directory: '',
};
const DIR = 'leetcode/1477-find-two-non-overlapping-sub-arrays-each-with-target-sum';

let github: FakeGitHub;
let provider: GitHubRepositoryProvider;
let writer: JournalWriter;

beforeEach(() => {
  github = new FakeGitHub();
  github.addRepo(REPO);
  const client = new GitHubClient({
    fetch: github.fetch,
    getToken: () => Promise.resolve(github.token),
  });
  provider = new GitHubRepositoryProvider(client, () => Promise.resolve(true));
  writer = new JournalWriter(
    provider,
    createLogger('test', () => undefined),
  );
});

describe('GitHubRepositoryProvider', () => {
  it('lists repositories with push permission and branches', async () => {
    github.addRepo('octo/private', { private: true });
    github.addRepo('other/readonly', { push: false, branches: ['main', 'dev'] });

    const repositories = await provider.getRepositories();
    expect(repositories.map((r) => [r.fullName, r.private, r.canPush])).toEqual([
      ['octo/journal', false, true],
      ['octo/private', true, true],
      ['other/readonly', false, false],
    ]);
    expect(await provider.getBranches({ owner: 'other', name: 'readonly' })).toEqual([
      'main',
      'dev',
    ]);
  });

  it('reports an empty repository as having no head, and a missing branch as not_found', async () => {
    github.addRepo('octo/empty', { empty: true });
    expect(await provider.getBranchHead({ owner: 'octo', name: 'empty' }, 'main')).toBeUndefined();
    await expect(provider.getBranchHead(target.repository, 'nope')).rejects.toMatchObject({
      kind: 'not_found',
    });
  });

  it('encodes UTF-8 content as base64', () => {
    expect(atob(toBase64('héllo ✓'))).toBe(
      String.fromCharCode(...new TextEncoder().encode('héllo ✓')),
    );
  });
});

describe('JournalWriter on GitHub', () => {
  it('writes each attempt as one commit with its file and metadata', async () => {
    const first = leetCodeSubmission({ status: 'wrong_answer' });
    const second = leetCodeSubmission({ status: 'time_limit_exceeded' });
    const third = leetCodeSubmission({
      status: 'accepted',
      metrics: { runtimeMs: 287, testsPassed: 21, testsTotal: 21 },
    });

    for (const s of [first, second, third]) await writer.write(target, s);

    expect(github.log(REPO)).toEqual([
      'LeetCode #1477 - Attempt 3 - Accepted',
      'LeetCode #1477 - Attempt 2 - Time Limit Exceeded',
      'LeetCode #1477 - Attempt 1 - Wrong Answer',
      'Initial commit',
    ]);
    const files = github.head(REPO)?.files;
    expect(files?.get(`${DIR}/001.js`)).toBe(first.code);
    expect(files?.get(`${DIR}/002.js`)).toBe(second.code);
    expect(files?.get(`${DIR}/003.js`)).toBe(third.code);
    expect(files?.get('README.md')).toBe('hello\n');
    const metadata = JSON.parse(files?.get(`${DIR}/metadata.json`) ?? '{}') as {
      attempts: { attempt: number; status: string; submissionId: string }[];
    };
    expect(metadata.attempts.map((a) => [a.attempt, a.status, a.submissionId])).toEqual([
      [1, 'wrong_answer', first.id],
      [2, 'time_limit_exceeded', second.id],
      [3, 'accepted', third.id],
    ]);
    // Each submission: one tree, one commit, one ref update.
    expect(github.requests.filter((r) => r.startsWith('PATCH'))).toHaveLength(3);
  });

  it('does not commit a submission that is already in the repository', async () => {
    const submission = leetCodeSubmission();
    const first = await writer.write(target, submission);
    const again = await writer.write(target, submission);

    expect(first.commitSha).toBeDefined();
    expect(again).toEqual({ attempt: 1, path: `${DIR}/001.js` });
    expect(github.log(REPO)).toHaveLength(2);
  });

  it('writes under the configured base directory', async () => {
    await writer.write({ ...target, directory: 'code-journal' }, leetCodeSubmission());
    expect([...(github.head(REPO)?.files.keys() ?? [])]).toContain(`code-journal/${DIR}/001.js`);
  });

  it('initializes an empty repository first', async () => {
    github.addRepo('octo/empty', { empty: true });
    await writer.write(
      { ...target, repository: { owner: 'octo', name: 'empty' } },
      leetCodeSubmission(),
    );
    expect(github.log('octo/empty')).toEqual([
      'LeetCode #1477 - Attempt 1 - Wrong Answer',
      'Initialize Code Journal',
    ]);
  });

  it('rebuilds on the new head when the branch moves during a commit', async () => {
    await writer.write(target, leetCodeSubmission());
    github.beforeRefUpdate = () => {
      github.pushExternal(REPO, 'notes.md', 'concurrent edit');
    };

    await writer.write(target, leetCodeSubmission());

    const files = github.head(REPO)?.files;
    expect(files?.get('notes.md')).toBe('concurrent edit');
    expect(files?.has(`${DIR}/002.js`)).toBe(true);
    expect(github.log(REPO)[0]).toBe('LeetCode #1477 - Attempt 2 - Wrong Answer');
  });

  it('surfaces permission errors and refuses to overwrite unreadable metadata', async () => {
    github.addRepo('other/readonly', { push: false });
    await expect(
      writer.write(
        { ...target, repository: { owner: 'other', name: 'readonly' } },
        leetCodeSubmission(),
      ),
    ).rejects.toMatchObject({ kind: 'permission' });

    github.pushExternal(REPO, `${DIR}/metadata.json`, 'garbage');
    await expect(writer.write(target, leetCodeSubmission())).rejects.toThrow(/metadata.json/);
    await expect(writer.write(target, leetCodeSubmission())).rejects.not.toBeInstanceOf(
      GitProviderError,
    );
  });
});
