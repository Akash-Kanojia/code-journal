import type { CodingSubmission } from '../core/models/coding-submission';

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface SubmissionRecord {
  /** `${platform}:${id}` */
  key: string;
  submission: CodingSubmission;
  createdAt: string;
  updatedAt: string;
}

export interface SyncEntry {
  /** Same key as the submission record. */
  key: string;
  status: SyncStatus;
  /** Copied from the submission so the queue can be ordered without loading submissions. */
  submittedAt: string;
  /** Number of failed sync attempts. */
  retryCount: number;
  lastError?: string;
  /** ISO time before which the entry must not be retried. */
  nextRetryAt?: string;
  lastAttemptAt?: string;
  syncedAt?: string;
  /** Repository path of the attempt file, once synced. */
  path?: string;
  commitSha?: string;
  createdAt: string;
  updatedAt: string;
}

/** Fields to change on a sync entry; a field set to `undefined` is removed. */
export type SyncPatch = {
  [K in Exclude<keyof SyncEntry, 'key' | 'createdAt'>]?: SyncEntry[K] | undefined;
};

export interface StoredSubmission {
  record: SubmissionRecord;
  sync: SyncEntry;
}

export interface SaveResult {
  /** False when the submission was already stored (duplicate event). */
  created: boolean;
  stored: StoredSubmission;
}

export type SyncCounts = Record<SyncStatus, number>;

/** Persistent submission history and sync queue. The rest of the app never touches IndexedDB directly. */
export interface SubmissionStore {
  /** Stores the submission and enqueues it for sync atomically. Idempotent per key. */
  save(submission: CodingSubmission, now: Date): Promise<SaveResult>;
  get(key: string): Promise<StoredSubmission | undefined>;
  /** Most recent first, by submission time. */
  listRecent(limit: number): Promise<StoredSubmission[]>;
  /** Pending entries, oldest submission first. */
  listPending(): Promise<SyncEntry[]>;
  counts(): Promise<SyncCounts>;
  /** Applies `patch` to an existing sync entry. Returns the updated entry. */
  updateSync(key: string, patch: SyncPatch, now: Date): Promise<SyncEntry>;
  /** Entries left in "syncing" by a worker that stopped mid-sync go back to "pending". */
  recoverInterrupted(now: Date): Promise<number>;
  /** Moves every failed entry back to pending for an immediate retry. */
  retryFailed(now: Date): Promise<number>;
  /** Clears backoff on pending entries so they are retried now. */
  clearBackoff(now: Date): Promise<number>;
}

/** Secret storage, kept out of reach of content scripts (extension-origin IndexedDB). */
export interface SecretStore {
  getSecret<T>(name: string): Promise<T | undefined>;
  setSecret(name: string, value: unknown): Promise<void>;
  deleteSecret(name: string): Promise<void>;
}
