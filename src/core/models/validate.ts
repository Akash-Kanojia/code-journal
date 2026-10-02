import { isPlatform } from '../types/platform';
import type { CodingSubmission } from './coding-submission';
import { isSubmissionStatus } from './submission-result';

type Loose = Record<string, unknown>;

function isRecord(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isOptionalString = (v: unknown): boolean => v === undefined || isString(v);
const isOptionalCount = (v: unknown): boolean =>
  v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0);

/**
 * Structural check for submissions arriving over extension messaging.
 * Messages from content scripts are treated as untrusted input.
 */
export function isCodingSubmission(value: unknown): value is CodingSubmission {
  if (!isRecord(value) || !isRecord(value.problem) || !isRecord(value.metrics)) return false;
  const { problem, metrics } = value;
  return (
    isString(value.id) &&
    value.id !== '' &&
    isPlatform(value.platform) &&
    problem.platform === value.platform &&
    isString(problem.id) &&
    problem.id !== '' &&
    isString(problem.title) &&
    isString(problem.url) &&
    isOptionalString(problem.slug) &&
    isOptionalString(problem.difficulty) &&
    isString(value.language) &&
    value.language !== '' &&
    isString(value.code) &&
    isSubmissionStatus(value.status) &&
    isString(value.submittedAt) &&
    !Number.isNaN(Date.parse(value.submittedAt)) &&
    isOptionalCount(metrics.runtimeMs) &&
    isOptionalCount(metrics.memoryBytes) &&
    isOptionalCount(metrics.testsPassed) &&
    isOptionalCount(metrics.testsTotal) &&
    (metrics.failedTestCase === undefined || isRecord(metrics.failedTestCase)) &&
    isOptionalString(value.error) &&
    isOptionalString(value.platformSubmissionId)
  );
}
