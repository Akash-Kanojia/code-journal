import type { Logger } from '../../core/logger';
import type { CodingSubmission } from '../../core/models/coding-submission';
import type { ImportProgress } from '../../core/types/import';
import { LeetCodeHttpError } from './leetcode-api';
import type { LeetCodeSubmissionDetails } from './parsers/details';
import { normalizeHistorySubmission, parseHistoryPage } from './parsers/history';

export interface HistoryImporterDeps {
  /** Raw `submissionList` response text. Throws `LeetCodeHttpError` on HTTP failure. */
  fetchPage(offset: number, lastKey: string | undefined): Promise<string>;
  /** Throws `LeetCodeHttpError` on HTTP failure; undefined when LeetCode has no details. */
  fetchDetails(submissionId: string): Promise<LeetCodeSubmissionDetails | undefined>;
  /** Returns the ids that are not stored yet. */
  filterUnknown(submissionIds: string[]): Promise<string[]>;
  /** Persists a batch (background worker). */
  deliver(submissions: CodingSubmission[]): Promise<void>;
  loadProgress(): Promise<ImportProgress | undefined>;
  saveProgress(progress: ImportProgress): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): Date;
  logger: Logger;
  /** Delay before each LeetCode request; keeps the import well under rate limits. */
  pacingMs?: number;
  /** Retries per request on 429 / 5xx / network errors. */
  maxRetries?: number;
}

class ImportFailure extends Error {}

/**
 * Imports the signed-in user's LeetCode submission history (newest first): one
 * `submissionList` page at a time, then `submissionDetails` for each submission not stored yet.
 * Progress is saved after every page, so an interrupted import resumes where it stopped.
 */
export class LeetCodeHistoryImporter {
  private cancelled = false;
  private running: Promise<ImportProgress> | undefined;

  constructor(private readonly deps: HistoryImporterDeps) {}

  isRunning(): boolean {
    return this.running !== undefined;
  }

  cancel(): void {
    this.cancelled = true;
  }

  /** Read through a method: `cancel()` can flip the flag while the import awaits. */
  private isCancelled(): boolean {
    return this.cancelled;
  }

  /** Starts (or resumes) the import. `restart` begins again from the newest submission. */
  start(restart = false): Promise<ImportProgress> {
    this.running ??= this.run(restart).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async run(restart: boolean): Promise<ImportProgress> {
    this.cancelled = false;
    const now = this.deps.now().toISOString();
    const previous = await this.deps.loadProgress();
    const resume = !restart && previous !== undefined && previous.state !== 'done';
    let progress: ImportProgress = resume
      ? { ...previous, state: 'running', updatedAt: now }
      : {
          platform: 'leetcode',
          state: 'running',
          offset: 0,
          imported: 0,
          existing: 0,
          skipped: 0,
          startedAt: now,
          updatedAt: now,
        };
    delete progress.error;
    delete progress.finishedAt;
    await this.deps.saveProgress(progress);
    this.deps.logger.info(resume ? 'Resuming history import' : 'Starting history import', {
      offset: progress.offset,
    });

    try {
      for (;;) {
        if (this.isCancelled()) return await this.finish(progress, 'cancelled');
        const next = await this.importPage(progress);
        if (next === undefined) return await this.finish(progress, 'cancelled');
        progress = next;
        await this.deps.saveProgress(progress);
        if (progress.state === 'done') {
          this.deps.logger.info('History import finished', {
            imported: progress.imported,
            existing: progress.existing,
            skipped: progress.skipped,
          });
          return progress;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.error('History import failed', { error: message, offset: progress.offset });
      return this.finish({ ...progress, error: message }, 'failed');
    }
  }

  /** Imports one page; undefined if cancelled mid-page (the page is redone on resume). */
  private async importPage(progress: ImportProgress): Promise<ImportProgress | undefined> {
    const text = await this.request(() => this.deps.fetchPage(progress.offset, progress.lastKey));
    const page = parseHistoryPage(text);
    if (page === undefined) {
      throw new ImportFailure(
        'LeetCode returned no submission list. Make sure you are signed in to leetcode.com.',
      );
    }
    const judged = page.items.filter((item) => !item.isPending);
    let skipped = page.items.length - judged.length;
    const unknown = new Set(await this.deps.filterUnknown(judged.map((item) => item.id)));

    const batch: CodingSubmission[] = [];
    for (const item of judged) {
      if (!unknown.has(item.id)) continue;
      if (this.isCancelled()) return undefined;
      const details = await this.request(() => this.deps.fetchDetails(item.id));
      const result =
        details === undefined
          ? { ok: false as const, reason: 'No submission details' }
          : normalizeHistorySubmission(item, details);
      if (result.ok) {
        batch.push(result.submission);
      } else {
        skipped++;
        this.deps.logger.warn('Skipped a past submission', {
          submissionId: item.id,
          reason: result.reason,
        });
      }
    }
    if (batch.length > 0) await this.deps.deliver(batch);

    const next: ImportProgress = {
      ...progress,
      offset: progress.offset + page.items.length,
      imported: progress.imported + batch.length,
      existing: progress.existing + (judged.length - unknown.size),
      skipped: progress.skipped + skipped,
      updatedAt: this.deps.now().toISOString(),
    };
    if (page.lastKey !== undefined) next.lastKey = page.lastKey;
    if (!page.hasNext || page.items.length === 0) {
      next.state = 'done';
      next.finishedAt = next.updatedAt;
    }
    return next;
  }

  /** Paces requests and retries rate limits (429), server errors and network failures. */
  private async request<T>(call: () => Promise<T>): Promise<T> {
    const maxRetries = this.deps.maxRetries ?? 6;
    for (let attempt = 0; ; attempt++) {
      await this.deps.sleep(this.deps.pacingMs ?? 1000);
      try {
        return await call();
      } catch (error) {
        const http = error instanceof LeetCodeHttpError ? error : undefined;
        const retryable =
          http === undefined
            ? error instanceof TypeError ||
              (error instanceof Error && error.name === 'TimeoutError')
            : http.status === 429 || http.status >= 500;
        if (http !== undefined && (http.status === 401 || http.status === 403)) {
          throw new ImportFailure('LeetCode refused the request. Make sure you are signed in.');
        }
        if (!retryable || attempt >= maxRetries) throw error;
        const delay = http?.retryAfterMs ?? Math.min(30_000 * 2 ** attempt, 5 * 60_000);
        this.deps.logger.warn('LeetCode request failed; backing off', {
          status: http?.status,
          delayMs: delay,
        });
        await this.deps.sleep(delay);
      }
    }
  }

  private async finish(
    progress: ImportProgress,
    state: 'cancelled' | 'failed',
  ): Promise<ImportProgress> {
    const final: ImportProgress = { ...progress, state, updatedAt: this.deps.now().toISOString() };
    await this.deps.saveProgress(final);
    return final;
  }
}
