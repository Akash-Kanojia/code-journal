import type { Platform } from '../types/platform';
import type { CodingSubmission } from './coding-submission';
import type { ProblemReference } from './problem';

/** Emitted as soon as a submission has been created on the platform. */
export interface SubmissionStartedEvent {
  type: 'SUBMISSION_STARTED';
  platform: Platform;
  submissionId: string;
  problem: ProblemReference;
  language?: string;
  /** ISO-8601 local time at which the extension detected the submission. */
  detectedAt: string;
}

/** The platform reported that the submission is still being judged. */
export interface SubmissionJudgingEvent {
  type: 'SUBMISSION_JUDGING';
  platform: Platform;
  submissionId: string;
  /** Platform-specific judging state, e.g. "PENDING". */
  platformState: string;
}

/** The platform reported a final judging result, not yet normalised. */
export interface SubmissionResultReceivedEvent {
  type: 'SUBMISSION_RESULT_RECEIVED';
  platform: Platform;
  submissionId: string;
  raw: unknown;
}

/** Something that looked like a submission could not be captured. */
export interface SubmissionCaptureFailedEvent {
  type: 'SUBMISSION_CAPTURE_FAILED';
  platform: Platform;
  reason: string;
  submissionId?: string;
}

/** The final result was normalised into a platform-independent submission. */
export interface SubmissionNormalizedEvent {
  type: 'SUBMISSION_NORMALIZED';
  platform: Platform;
  submission: CodingSubmission;
}

/** The final result was received but could not be normalised. `raw` preserves it. */
export interface SubmissionParsingFailedEvent {
  type: 'SUBMISSION_PARSING_FAILED';
  platform: Platform;
  submissionId: string;
  reason: string;
  raw: unknown;
}

export type SubmissionEvent =
  | SubmissionStartedEvent
  | SubmissionJudgingEvent
  | SubmissionResultReceivedEvent
  | SubmissionNormalizedEvent
  | SubmissionParsingFailedEvent
  | SubmissionCaptureFailedEvent;

export type SubmissionEventListener = (event: SubmissionEvent) => void;
