import { languageDisplayName } from '../languages';
import type { CodingSubmission } from '../models/coding-submission';
import type { Problem } from '../models/problem';
import type { SubmissionStatus, TestCaseResult } from '../models/submission-result';
import { isSubmissionStatus } from '../models/submission-result';
import type { Platform } from '../types/platform';
import { isPlatform } from '../types/platform';
import { STATUS_LABELS } from './layout';

export const METADATA_VERSION = 1;

/** Long testcase or error text is truncated in metadata; the full value stays in local storage. */
const MAX_TEXT_LENGTH = 2000;

export interface AttemptMetadata {
  attempt: number;
  file: string;
  submissionId: string;
  status: SubmissionStatus;
  statusLabel: string;
  language: string;
  languageName: string;
  submittedAt: string;
  runtimeMs?: number;
  memoryBytes?: number;
  testsPassed?: number;
  testsTotal?: number;
  failedTestCase?: TestCaseResult;
  error?: string;
}

export interface ProblemMetadata {
  version: number;
  platform: Platform;
  problem: { id: string; title: string; slug?: string; url: string; difficulty?: string };
  attempts: AttemptMetadata[];
}

function truncate(text: string): string {
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}… [truncated]` : text;
}

function truncateTestCase(testCase: TestCaseResult): TestCaseResult {
  const result: TestCaseResult = {};
  if (testCase.input !== undefined) result.input = truncate(testCase.input);
  if (testCase.expected !== undefined) result.expected = truncate(testCase.expected);
  if (testCase.actual !== undefined) result.actual = truncate(testCase.actual);
  return result;
}

function problemSummary(problem: Problem): ProblemMetadata['problem'] {
  const summary: ProblemMetadata['problem'] = {
    id: problem.id,
    title: problem.title,
    url: problem.url,
  };
  if (problem.slug !== undefined) summary.slug = problem.slug;
  if (problem.difficulty !== undefined) summary.difficulty = problem.difficulty;
  return summary;
}

export function attemptMetadata(
  submission: CodingSubmission,
  attempt: number,
  file: string,
): AttemptMetadata {
  const { metrics } = submission;
  const entry: AttemptMetadata = {
    attempt,
    file,
    submissionId: submission.platformSubmissionId ?? submission.id,
    status: submission.status,
    statusLabel: STATUS_LABELS[submission.status],
    language: submission.language,
    languageName: languageDisplayName(submission.language),
    submittedAt: submission.submittedAt,
  };
  if (metrics.runtimeMs !== undefined) entry.runtimeMs = metrics.runtimeMs;
  if (metrics.memoryBytes !== undefined) entry.memoryBytes = metrics.memoryBytes;
  if (metrics.testsPassed !== undefined) entry.testsPassed = metrics.testsPassed;
  if (metrics.testsTotal !== undefined) entry.testsTotal = metrics.testsTotal;
  if (metrics.failedTestCase !== undefined) {
    entry.failedTestCase = truncateTestCase(metrics.failedTestCase);
  }
  if (submission.error !== undefined) entry.error = truncate(submission.error);
  return entry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAttempt(value: unknown): value is AttemptMetadata {
  return (
    isRecord(value) &&
    typeof value.attempt === 'number' &&
    Number.isInteger(value.attempt) &&
    value.attempt > 0 &&
    typeof value.file === 'string' &&
    typeof value.submissionId === 'string' &&
    isSubmissionStatus(value.status)
  );
}

/**
 * Parses an existing metadata.json. Throws if the file exists but is not recognisable:
 * guessing would risk overwriting attempt files in the user's repository.
 */
export function parseProblemMetadata(text: string): ProblemMetadata {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('Existing metadata.json is not valid JSON');
  }
  if (
    !isRecord(json) ||
    !isPlatform(json.platform) ||
    !isRecord(json.problem) ||
    !Array.isArray(json.attempts)
  ) {
    throw new Error('Existing metadata.json has an unexpected format');
  }
  const attempts = (json.attempts as unknown[]).filter(isAttempt);
  if (attempts.length !== json.attempts.length) {
    throw new Error('Existing metadata.json contains unrecognised attempts');
  }
  return {
    version: typeof json.version === 'number' ? json.version : METADATA_VERSION,
    platform: json.platform,
    problem: json.problem as ProblemMetadata['problem'],
    attempts,
  };
}

export function nextAttemptNumber(metadata: ProblemMetadata | undefined): number {
  if (metadata === undefined) return 1;
  return metadata.attempts.reduce((max, a) => Math.max(max, a.attempt), 0) + 1;
}

export function findAttempt(
  metadata: ProblemMetadata | undefined,
  submission: CodingSubmission,
): AttemptMetadata | undefined {
  const submissionId = submission.platformSubmissionId ?? submission.id;
  return metadata?.attempts.find((a) => a.submissionId === submissionId);
}

/** Returns new metadata with the attempt appended; problem details are refreshed from the latest submission. */
export function withAttempt(
  existing: ProblemMetadata | undefined,
  submission: CodingSubmission,
  attempt: AttemptMetadata,
): ProblemMetadata {
  const attempts = [...(existing?.attempts ?? []), attempt].sort((a, b) => a.attempt - b.attempt);
  return {
    version: METADATA_VERSION,
    platform: submission.platform,
    problem: problemSummary(submission.problem),
    attempts,
  };
}

export function serializeMetadata(metadata: ProblemMetadata): string {
  return `${JSON.stringify(metadata, null, 2)}\n`;
}
