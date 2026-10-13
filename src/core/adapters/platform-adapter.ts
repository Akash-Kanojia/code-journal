import type { CodingSubmission } from '../models/coding-submission';
import type { SubmissionEventListener } from '../models/submission-event';
import type { ImportProgress } from '../types/import';
import type { Platform } from '../types/platform';

/** Where a history import sends its results; provided by the content script. */
export interface HistoryImportSink {
  /** Returns the submission ids that are not stored yet. */
  filterUnknown(submissionIds: string[]): Promise<string[]>;
  deliver(submissions: CodingSubmission[]): Promise<void>;
  loadProgress(): Promise<ImportProgress | undefined>;
  saveProgress(progress: ImportProgress): Promise<void>;
}

/** Imports the user's past submissions from a platform. */
export interface HistoryImporter {
  /** Starts or resumes; `restart` begins from the newest submission again. */
  start(restart: boolean): Promise<ImportProgress>;
  cancel(): void;
  isRunning(): boolean;
}

/**
 * Contract every platform integration implements.
 * Core services depend only on this interface, never on a concrete platform.
 *
 * Adapters push submission events as they are observed: platforms deliver the
 * submission id and the judging result asynchronously, and several submissions
 * may be in flight at once.
 */
export interface PlatformAdapter {
  readonly platform: Platform;

  /** Whether this adapter handles the given page URL. */
  canHandle(url: URL): boolean;

  /** Begin observing the page. Returns a function that stops observation. */
  start(listener: SubmissionEventListener): () => void;

  /** Present only for platforms whose past submissions (with code) can be imported. */
  createHistoryImporter?(sink: HistoryImportSink): HistoryImporter;
}
