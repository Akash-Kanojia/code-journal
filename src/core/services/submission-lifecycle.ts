import type { Logger } from '../logger';
import type { CodingSubmission } from '../models/coding-submission';
import type { ProblemReference } from '../models/problem';
import type { SubmissionEvent } from '../models/submission-event';
import type { Platform } from '../types/platform';

export type SubmissionLifecycleState =
  | 'SUBMISSION_DETECTED'
  | 'JUDGING'
  | 'RESULT_RECEIVED'
  | 'NORMALIZED'
  | 'PERSISTED'
  | 'CAPTURE_FAILED'
  | 'PARSING_FAILED'
  | 'PERSIST_FAILED';

export interface TrackedSubmission {
  platform: Platform;
  submissionId: string;
  problem: ProblemReference;
  language?: string;
  state: SubmissionLifecycleState;
  submission?: CodingSubmission;
}

const ORDER: Record<SubmissionLifecycleState, number> = {
  SUBMISSION_DETECTED: 0,
  JUDGING: 1,
  RESULT_RECEIVED: 2,
  CAPTURE_FAILED: 2,
  NORMALIZED: 3,
  PARSING_FAILED: 3,
  PERSISTED: 4,
  PERSIST_FAILED: 4,
};

const FAILURES = new Set<SubmissionLifecycleState>([
  'CAPTURE_FAILED',
  'PARSING_FAILED',
  'PERSIST_FAILED',
]);

const TRANSITION_MESSAGES: Record<SubmissionLifecycleState, string> = {
  SUBMISSION_DETECTED: 'Submission detected',
  JUDGING: 'Submission judging',
  RESULT_RECEIVED: 'Submission result received',
  NORMALIZED: 'Submission normalized',
  PERSISTED: 'Submission persisted locally',
  PERSIST_FAILED: 'Submission could not be persisted',
  CAPTURE_FAILED: 'Submission capture failed',
  PARSING_FAILED: 'Submission parsing failed',
};

/**
 * Tracks each submission through its in-page lifecycle (detection → normalization →
 * persistence). Sync states (queued, syncing, synced, failed) live in the persistent queue,
 * owned by the background worker.
 *
 * Tracks each submission through its lifecycle, ignoring duplicate or out-of-order
 * events (platforms poll repeatedly, so the same state is typically reported many times).
 */
export class SubmissionLifecycleTracker {
  private readonly submissions = new Map<string, TrackedSubmission>();

  constructor(private readonly logger: Logger) {}

  get(platform: Platform, submissionId: string): TrackedSubmission | undefined {
    return this.submissions.get(key(platform, submissionId));
  }

  handle(event: SubmissionEvent): void {
    switch (event.type) {
      case 'SUBMISSION_STARTED': {
        const k = key(event.platform, event.submissionId);
        if (this.submissions.has(k)) {
          this.logger.debug('Duplicate submission start ignored', {
            platform: event.platform,
            submissionId: event.submissionId,
          });
          return;
        }
        const tracked: TrackedSubmission = {
          platform: event.platform,
          submissionId: event.submissionId,
          problem: event.problem,
          state: 'SUBMISSION_DETECTED',
        };
        if (event.language !== undefined) {
          tracked.language = event.language;
        }
        this.submissions.set(k, tracked);
        this.logger.info(TRANSITION_MESSAGES.SUBMISSION_DETECTED, {
          platform: tracked.platform,
          submissionId: tracked.submissionId,
          problem: tracked.problem,
          language: tracked.language,
        });
        return;
      }
      case 'SUBMISSION_JUDGING':
        this.transition(event.platform, event.submissionId, 'JUDGING', {
          platformState: event.platformState,
        });
        return;
      case 'SUBMISSION_RESULT_RECEIVED':
        this.transition(event.platform, event.submissionId, 'RESULT_RECEIVED');
        return;
      case 'SUBMISSION_NORMALIZED': {
        const { submission } = event;
        const tracked = this.transition(
          event.platform,
          submission.id,
          'NORMALIZED',
          summarize(submission),
        );
        if (tracked) {
          tracked.submission = submission;
        }
        return;
      }
      case 'SUBMISSION_PARSING_FAILED':
        this.transition(event.platform, event.submissionId, 'PARSING_FAILED', {
          reason: event.reason,
        });
        return;
      case 'SUBMISSION_CAPTURE_FAILED':
        if (event.submissionId !== undefined) {
          this.transition(event.platform, event.submissionId, 'CAPTURE_FAILED', {
            reason: event.reason,
          });
        } else {
          this.logger.error('Submission capture failed', {
            platform: event.platform,
            reason: event.reason,
          });
        }
        return;
    }
  }

  /** Records the background worker's answer to a delivered submission. */
  markPersisted(platform: Platform, submissionId: string, ok: boolean, created?: boolean): void {
    this.transition(
      platform,
      submissionId,
      ok ? 'PERSISTED' : 'PERSIST_FAILED',
      ok ? { duplicate: created === false } : {},
    );
  }

  private transition(
    platform: Platform,
    submissionId: string,
    next: SubmissionLifecycleState,
    context: Record<string, unknown> = {},
  ): TrackedSubmission | undefined {
    const tracked = this.submissions.get(key(platform, submissionId));
    if (!tracked) {
      this.logger.debug('Event for untracked submission ignored', { platform, submissionId, next });
      return undefined;
    }
    if (ORDER[next] <= ORDER[tracked.state]) {
      return undefined;
    }
    tracked.state = next;
    const level = FAILURES.has(next) ? 'error' : 'info';
    this.logger[level](TRANSITION_MESSAGES[next], {
      platform,
      submissionId,
      ...context,
    });
    return tracked;
  }
}

/** Log-friendly summary. Deliberately excludes source code. */
function summarize(submission: CodingSubmission): Record<string, unknown> {
  return {
    problemId: submission.problem.id,
    title: submission.problem.title,
    language: submission.language,
    status: submission.status,
    submittedAt: submission.submittedAt,
    metrics: submission.metrics,
    hasError: submission.error !== undefined,
    codeLength: submission.code.length,
  };
}

function key(platform: Platform, submissionId: string): string {
  return `${platform}:${submissionId}`;
}
