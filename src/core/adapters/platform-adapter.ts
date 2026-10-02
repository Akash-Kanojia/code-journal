import type { SubmissionEventListener } from '../models/submission-event';
import type { Platform } from '../types/platform';

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
}
