import type { SubmissionStatus } from '../../../core/models/submission-result';

/**
 * `status_code` values. 10, 11, 14, 15 and 20 were observed;
 * 12 (MLE) and 13 (OLE) are unverified.
 */
const BY_CODE: Readonly<Record<number, SubmissionStatus>> = {
  10: 'accepted',
  11: 'wrong_answer',
  12: 'memory_limit_exceeded',
  13: 'output_limit_exceeded',
  14: 'time_limit_exceeded',
  15: 'runtime_error',
  20: 'compile_error',
};

const BY_MESSAGE: Readonly<Record<string, SubmissionStatus>> = {
  accepted: 'accepted',
  'wrong answer': 'wrong_answer',
  'memory limit exceeded': 'memory_limit_exceeded',
  'output limit exceeded': 'output_limit_exceeded',
  'time limit exceeded': 'time_limit_exceeded',
  'runtime error': 'runtime_error',
  'compile error': 'compile_error',
};

/** Maps LeetCode's `status_code`, falling back to `status_msg`, then to "unknown". */
export function mapLeetCodeStatus(statusCode: unknown, statusMessage: unknown): SubmissionStatus {
  if (typeof statusCode === 'number') {
    const byCode = BY_CODE[statusCode];
    if (byCode !== undefined) return byCode;
  }
  if (typeof statusMessage === 'string') {
    const byMessage = BY_MESSAGE[statusMessage.trim().toLowerCase()];
    if (byMessage !== undefined) return byMessage;
  }
  return 'unknown';
}
