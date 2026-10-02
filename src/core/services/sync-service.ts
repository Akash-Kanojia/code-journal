import type { Logger } from '../logger';
import type { SubmissionStore, SyncEntry } from '../../storage/storage';
import { GitProviderError } from './git-provider';
import type { JournalTarget, JournalWriter } from './journal-writer';

export interface RetryPolicy {
  /** Delay before the n-th retry (n starts at 1). Provider-requested delays (rate limits) take precedence when longer. */
  delayMs(retryCount: number): number;
  /** Transient failures after which an entry is marked failed and waits for a manual retry. */
  maxRetries: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 10,
  delayMs: (retryCount) => Math.min(30_000 * 2 ** (retryCount - 1), 60 * 60_000),
};

export type SyncBlockReason = 'not_configured' | 'not_authenticated';

export interface SyncRunResult {
  synced: number;
  failed: number;
  /** Why the run did not process the queue, if it did not. */
  blocked?: SyncBlockReason;
  /** ISO time of the next due retry, if entries are waiting on backoff. */
  nextRetryAt?: string;
}

export interface SyncServiceDeps {
  store: SubmissionStore;
  writer: JournalWriter;
  /** Resolves the configured repository/branch/directory, or undefined if incomplete. */
  getTarget(): Promise<JournalTarget | undefined>;
  isAuthenticated(): Promise<boolean>;
  /** Called when the provider rejects the credentials (revoked/expired token). */
  onAuthRejected(): Promise<void>;
  /** Called between submissions; lets the service worker extend its lifetime. */
  heartbeat?(): Promise<void>;
  logger: Logger;
  now(): Date;
  retryPolicy?: RetryPolicy;
}

/** Failure kinds that affect every submission, so the run stops instead of burning retries. */
const STOPS_RUN = new Set<GitProviderError['kind']>([
  'network',
  'server',
  'rate_limited',
  'conflict',
  'permission',
  'not_found',
]);

/**
 * Drains the persistent sync queue in submission order. Ordering matters because attempt
 * numbers are assigned at commit time: a later submission is never committed while an
 * earlier one is waiting to be retried.
 */
export class SyncService {
  private running: Promise<SyncRunResult> | undefined;
  private rerunRequested = false;

  constructor(private readonly deps: SyncServiceDeps) {}

  /** Runs the queue; concurrent calls coalesce into one extra run after the current one. */
  run(): Promise<SyncRunResult> {
    if (this.running !== undefined) {
      this.rerunRequested = true;
      return this.running;
    }
    const loop = async (): Promise<SyncRunResult> => {
      let result: SyncRunResult;
      do {
        this.rerunRequested = false;
        result = await this.runOnce();
      } while (this.takeRerunRequest() && result.blocked === undefined);
      return result;
    };
    this.running = loop().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  /** Set by `run()` calls that arrived while a run was in progress. */
  private takeRerunRequest(): boolean {
    const requested = this.rerunRequested;
    this.rerunRequested = false;
    return requested;
  }

  private async runOnce(): Promise<SyncRunResult> {
    const { store, logger } = this.deps;
    const result: SyncRunResult = { synced: 0, failed: 0 };

    const target = await this.deps.getTarget();
    if (target === undefined) return { ...result, blocked: 'not_configured' };
    if (!(await this.deps.isAuthenticated())) return { ...result, blocked: 'not_authenticated' };

    for (const entry of await store.listPending()) {
      const now = this.deps.now();
      if (entry.nextRetryAt !== undefined && Date.parse(entry.nextRetryAt) > now.getTime()) {
        result.nextRetryAt = entry.nextRetryAt;
        break;
      }
      const outcome = await this.syncEntry(target, entry);
      if (outcome === 'synced') result.synced++;
      if (outcome === 'failed') result.failed++;
      if (outcome === 'retry') {
        const updated = await store.get(entry.key);
        if (updated?.sync.nextRetryAt !== undefined) result.nextRetryAt = updated.sync.nextRetryAt;
        break;
      }
      if (outcome === 'auth') return { ...result, blocked: 'not_authenticated' };
      await this.deps.heartbeat?.();
    }
    if (result.synced + result.failed > 0) {
      logger.info('Sync run finished', { synced: result.synced, failed: result.failed });
    }
    return result;
  }

  private async syncEntry(
    target: JournalTarget,
    entry: SyncEntry,
  ): Promise<'synced' | 'failed' | 'retry' | 'auth'> {
    const { store, logger } = this.deps;
    const stored = await store.get(entry.key);
    if (stored === undefined) {
      await store.updateSync(
        entry.key,
        { status: 'failed', lastError: 'Submission record missing' },
        this.deps.now(),
      );
      return 'failed';
    }
    const { submission } = stored.record;
    await store.updateSync(
      entry.key,
      { status: 'syncing', lastAttemptAt: this.deps.now().toISOString() },
      this.deps.now(),
    );
    logger.info('Syncing submission', { key: entry.key, status: submission.status });

    try {
      const written = await this.deps.writer.write(target, submission);
      await store.updateSync(
        entry.key,
        {
          status: 'synced',
          syncedAt: this.deps.now().toISOString(),
          path: written.path,
          commitSha: written.commitSha,
          lastError: undefined,
          nextRetryAt: undefined,
        },
        this.deps.now(),
      );
      logger.info(
        written.commitSha === undefined ? 'Submission already in repository' : 'Submission synced',
        {
          key: entry.key,
          attempt: written.attempt,
          path: written.path,
        },
      );
      return 'synced';
    } catch (error) {
      return this.handleFailure(entry, error);
    }
  }

  private async handleFailure(
    entry: SyncEntry,
    error: unknown,
  ): Promise<'failed' | 'retry' | 'auth'> {
    const { store, logger } = this.deps;
    const providerError = error instanceof GitProviderError ? error : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const now = this.deps.now();

    if (providerError?.kind === 'auth') {
      // Not the submission's fault: keep it pending, without consuming a retry.
      await store.updateSync(entry.key, { status: 'pending', lastError: message }, now);
      logger.warn('GitHub rejected the credentials; sync paused until reconnected', {
        key: entry.key,
      });
      await this.deps.onAuthRejected();
      return 'auth';
    }

    const policy = this.deps.retryPolicy ?? DEFAULT_RETRY_POLICY;
    const retryCount = entry.retryCount + 1;
    const transient = providerError === undefined || STOPS_RUN.has(providerError.kind);
    if (!transient || retryCount > policy.maxRetries) {
      await store.updateSync(
        entry.key,
        { status: 'failed', retryCount, lastError: message, nextRetryAt: undefined },
        now,
      );
      logger.error('Submission sync failed', { key: entry.key, error: message, retryCount });
      return transient ? 'retry' : 'failed';
    }

    const delay = Math.max(policy.delayMs(retryCount), providerError?.retryAfterMs ?? 0);
    const nextRetryAt = new Date(now.getTime() + delay);
    await store.updateSync(
      entry.key,
      { status: 'pending', retryCount, lastError: message, nextRetryAt: nextRetryAt.toISOString() },
      now,
    );
    logger.warn('Submission sync failed; will retry', {
      key: entry.key,
      error: message,
      retryCount,
      nextRetryAt: nextRetryAt.toISOString(),
    });
    return 'retry';
  }
}
