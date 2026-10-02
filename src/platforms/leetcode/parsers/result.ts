import type { CodingSubmission } from '../../../core/models/coding-submission';
import { isCompleteProblem, type ProblemReference } from '../../../core/models/problem';
import { readId, readString, type JsonRecord } from '../../shared/json';
import { parseError, parseMetrics } from './metrics';
import { mapLeetCodeStatus } from './status';

/** What was known about a submission when it was submitted. */
export interface LeetCodeSubmissionContext {
  submissionId: string;
  problem: ProblemReference;
  /** Language slug from the submit request. */
  language?: string;
  /** Exact code from the submit request. */
  code?: string;
  /** ISO-8601 time the submission was detected. */
  detectedAt: string;
}

export type NormalizeResult =
  { ok: true; submission: CodingSubmission } | { ok: false; reason: string };

/** Combines a final check response with its submit-time context. Never fabricates missing fields. */
export function normalizeCheckResult(
  raw: JsonRecord,
  context: LeetCodeSubmissionContext,
): NormalizeResult {
  const reportedId = readId(raw.submission_id);
  if (reportedId !== undefined && reportedId !== context.submissionId) {
    return {
      ok: false,
      reason: `Result is for submission ${reportedId}, expected ${context.submissionId}`,
    };
  }
  if (context.code === undefined) {
    return { ok: false, reason: 'Submitted code was not captured' };
  }
  const language = context.language ?? readString(raw.lang);
  if (language === undefined) {
    return { ok: false, reason: 'Submission language is unknown' };
  }
  const { problem } = context;
  if (!isCompleteProblem(problem)) {
    return { ok: false, reason: 'Problem id or title is unavailable' };
  }

  const status = mapLeetCodeStatus(raw.status_code, raw.status_msg);
  const submission: CodingSubmission = {
    id: context.submissionId,
    platform: 'leetcode',
    problem,
    language,
    code: context.code,
    status,
    submittedAt: context.detectedAt,
    metrics: parseMetrics(raw, status),
    platformSubmissionId: context.submissionId,
    raw,
  };
  const error = parseError(raw);
  if (error !== undefined) {
    submission.error = error;
  }
  return { ok: true, submission };
}
