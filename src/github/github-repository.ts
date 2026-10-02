import {
  GitProviderError,
  type BranchHead,
  type CommitRequest,
  type FileChange,
  type GitProvider,
  type Repository,
} from '../core/services/git-provider';
import type { GitHubClient } from './github-client';

type RepoRef = Pick<Repository, 'owner' | 'name'>;

interface RepoResponse {
  name?: unknown;
  full_name?: unknown;
  private?: unknown;
  default_branch?: unknown;
  owner?: { login?: unknown };
  permissions?: { push?: unknown };
}

const MAX_PAGES = 10;

function repoPath(repository: RepoRef): string {
  return `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** UTF-8 safe base64, for the Contents API. */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function parseRepository(value: RepoResponse): Repository | undefined {
  const owner = value.owner?.login;
  if (
    typeof value.name !== 'string' ||
    typeof owner !== 'string' ||
    typeof value.full_name !== 'string'
  ) {
    return undefined;
  }
  return {
    owner,
    name: value.name,
    fullName: value.full_name,
    private: value.private === true,
    defaultBranch: typeof value.default_branch === 'string' ? value.default_branch : 'main',
    canPush: value.permissions?.push === true,
  };
}

function readSha(value: unknown, what: string): string {
  if (typeof value === 'object' && value !== null && 'sha' in value) {
    const sha = value.sha;
    if (typeof sha === 'string' && sha !== '') return sha;
  }
  throw new GitProviderError('server', `GitHub response is missing the ${what} SHA`);
}

/**
 * GitHub implementation of GitProvider. Commits go through the Git Data API
 * (tree → commit → ref) so one submission is exactly one commit.
 */
export class GitHubRepositoryProvider implements GitProvider {
  constructor(
    private readonly client: GitHubClient,
    private readonly hasToken: () => Promise<boolean>,
  ) {}

  isAuthenticated(): Promise<boolean> {
    return this.hasToken();
  }

  async getRepositories(): Promise<Repository[]> {
    const repositories: Repository[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await this.client.requestJson<RepoResponse[]>(
        `/user/repos?per_page=100&page=${String(page)}&sort=updated&affiliation=owner,collaborator,organization_member`,
      );
      if (!Array.isArray(batch)) throw new GitProviderError('server', 'Unexpected repository list');
      for (const item of batch) {
        const repository = parseRepository(item);
        if (repository !== undefined) repositories.push(repository);
      }
      if (batch.length < 100) break;
    }
    return repositories;
  }

  async getBranches(repository: RepoRef): Promise<string[]> {
    const branches: string[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await this.client.requestJson<{ name?: unknown }[]>(
        `${repoPath(repository)}/branches?per_page=100&page=${String(page)}`,
      );
      if (!Array.isArray(batch)) throw new GitProviderError('server', 'Unexpected branch list');
      for (const item of batch) {
        if (typeof item.name === 'string') branches.push(item.name);
      }
      if (batch.length < 100) break;
    }
    return branches;
  }

  async getBranchHead(repository: RepoRef, branch: string): Promise<BranchHead | undefined> {
    const base = repoPath(repository);
    // 409 means the repository has no commits yet.
    const ref = await this.client.request<{ object?: unknown }>(
      `${base}/git/ref/heads/${encodePath(branch)}`,
      { allow: [409] },
    );
    if (ref === undefined) {
      return undefined;
    }
    const commitSha = readSha(ref.object, 'branch');
    const commit = await this.client.requestJson<{ tree?: unknown }>(
      `${base}/git/commits/${commitSha}`,
    );
    return { commitSha, treeSha: readSha(commit.tree, 'tree') };
  }

  async readFile(
    repository: RepoRef,
    commitSha: string,
    path: string,
  ): Promise<string | undefined> {
    return this.client.request<string>(
      `${repoPath(repository)}/contents/${encodePath(path)}?ref=${encodeURIComponent(commitSha)}`,
      { accept: 'application/vnd.github.raw+json', allow: [404] },
    );
  }

  async createCommit(request: CommitRequest): Promise<string> {
    const base = repoPath(request.repository);
    const tree = await this.client.requestJson<unknown>(`${base}/git/trees`, {
      method: 'POST',
      body: {
        base_tree: request.parent.treeSha,
        tree: request.files.map((file) => ({
          path: file.path,
          mode: '100644',
          type: 'blob',
          content: file.content,
        })),
      },
    });
    const commit = await this.client.requestJson<unknown>(`${base}/git/commits`, {
      method: 'POST',
      body: {
        message: request.message,
        tree: readSha(tree, 'tree'),
        parents: [request.parent.commitSha],
      },
    });
    const commitSha = readSha(commit, 'commit');
    // force: false — GitHub rejects the update (422) if the branch moved, which surfaces as a conflict.
    await this.client.requestJson<unknown>(`${base}/git/refs/heads/${encodePath(request.branch)}`, {
      method: 'PATCH',
      body: { sha: commitSha, force: false },
    });
    return commitSha;
  }

  async createOrUpdateFile(
    repository: RepoRef,
    branch: string,
    file: FileChange,
    message: string,
  ): Promise<void> {
    await this.client.requestJson<unknown>(
      `${repoPath(repository)}/contents/${encodePath(file.path)}`,
      { method: 'PUT', body: { message, branch, content: toBase64(file.content) } },
    );
  }
}
