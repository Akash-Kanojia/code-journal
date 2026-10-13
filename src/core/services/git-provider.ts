/** A remote repository the journal can be written to. */
export interface Repository {
  owner: string;
  name: string;
  /** "owner/name" */
  fullName: string;
  private: boolean;
  defaultBranch: string;
  /** Whether the authenticated user can push to it. */
  canPush: boolean;
}

export interface BranchHead {
  commitSha: string;
  treeSha: string;
}

export interface FileChange {
  path: string;
  /** UTF-8 text content. */
  content: string;
}

export interface CommitRequest {
  repository: Pick<Repository, 'owner' | 'name'>;
  branch: string;
  /** The head the commit is built on; the branch only moves if it still points here. */
  parent: BranchHead;
  files: FileChange[];
  message: string;
  /**
   * ISO time used as the commit's author and committer date (the submission time), so the
   * history reflects when the work happened even if the sync ran later. Defaults to now.
   */
  date?: string;
}

export type GitProviderErrorKind =
  /** Token missing, revoked or expired. */
  | 'auth'
  /** Authenticated, but not allowed to perform the operation. */
  | 'permission'
  | 'not_found'
  /** The branch moved while committing. */
  | 'conflict'
  | 'rate_limited'
  | 'network'
  | 'server'
  /** The request itself was rejected (e.g. validation); retrying will not help. */
  | 'invalid';

export class GitProviderError extends Error {
  constructor(
    readonly kind: GitProviderErrorKind,
    message: string,
    /** When the provider says how long to wait (rate limits). */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'GitProviderError';
  }
}

/**
 * Remote Git operations needed by the journal. Implemented by GitHub; the core never
 * talks to a provider API directly. Authentication is interactive and handled by the
 * provider's own auth module.
 */
export interface GitProvider {
  isAuthenticated(): Promise<boolean>;
  getRepositories(): Promise<Repository[]>;
  getBranches(repository: Pick<Repository, 'owner' | 'name'>): Promise<string[]>;
  /** Returns undefined when the repository has no commits yet. Throws `not_found` for a missing branch. */
  getBranchHead(
    repository: Pick<Repository, 'owner' | 'name'>,
    branch: string,
  ): Promise<BranchHead | undefined>;
  /** Reads a text file at a commit; undefined if it does not exist. */
  readFile(
    repository: Pick<Repository, 'owner' | 'name'>,
    commitSha: string,
    path: string,
  ): Promise<string | undefined>;
  /** Creates one commit containing all files and fast-forwards the branch. Throws `conflict` if the branch moved. */
  createCommit(request: CommitRequest): Promise<string>;
  /** Creates the first commit of an empty repository on `branch`. */
  createOrUpdateFile(
    repository: Pick<Repository, 'owner' | 'name'>,
    branch: string,
    file: FileChange,
    message: string,
  ): Promise<void>;
}
