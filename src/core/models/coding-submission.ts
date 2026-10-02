import type { Platform } from '../types/platform';
import type { Problem } from './problem';
import type { SubmissionMetrics, SubmissionStatus } from './submission-result';

/** Platform-independent representation of a single submission attempt. */
export interface CodingSubmission {
  /** Unique within the platform: the platform submission id when available, else a deterministic local id. */
  id: string;
  platform: Platform;
  problem: Problem;
  /** Platform language identifier as submitted, e.g. "cpp" or "python3". */
  language: string;
  /** The exact source code associated with this attempt. */
  code: string;
  status: SubmissionStatus;
  /** ISO-8601 timestamp. */
  submittedAt: string;
  metrics: SubmissionMetrics;
  /** Compiler or runtime error output, when the platform provides it. */
  error?: string;
  /** The platform's own submission id, when it provides one. */
  platformSubmissionId?: string;
  /** Platform-specific payload kept for debugging. Never synced to Git. */
  raw?: unknown;
}

/** Storage/dedup key: one logical submission per platform + id. */
export function submissionKey(submission: Pick<CodingSubmission, 'platform' | 'id'>): string {
  return `${submission.platform}:${submission.id}`;
}
