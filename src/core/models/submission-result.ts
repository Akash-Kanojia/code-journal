export const SUBMISSION_STATUSES = [
  'accepted',
  'wrong_answer',
  'time_limit_exceeded',
  'memory_limit_exceeded',
  'output_limit_exceeded',
  'compile_error',
  'runtime_error',
  'unknown',
] as const;

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export function isSubmissionStatus(value: unknown): value is SubmissionStatus {
  return typeof value === 'string' && (SUBMISSION_STATUSES as readonly string[]).includes(value);
}

export interface TestCaseResult {
  input?: string;
  expected?: string;
  actual?: string;
}

/**
 * Every field is optional: platforms expose different information,
 * and anything not provided by the platform must stay undefined.
 */
export interface SubmissionMetrics {
  runtimeMs?: number;
  memoryBytes?: number;
  testsPassed?: number;
  testsTotal?: number;
  failedTestCase?: TestCaseResult;
}
