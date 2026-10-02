import { fileExtension } from '../languages';
import type { CodingSubmission } from '../models/coding-submission';
import type { Problem } from '../models/problem';
import type { SubmissionStatus } from '../models/submission-result';
import { PLATFORM_INFO } from '../platform-info';

export const STATUS_LABELS: Readonly<Record<SubmissionStatus, string>> = {
  accepted: 'Accepted',
  wrong_answer: 'Wrong Answer',
  time_limit_exceeded: 'Time Limit Exceeded',
  memory_limit_exceeded: 'Memory Limit Exceeded',
  output_limit_exceeded: 'Output Limit Exceeded',
  compile_error: 'Compile Error',
  runtime_error: 'Runtime Error',
  unknown: 'Unknown Result',
};

export const METADATA_FILE = 'metadata.json';

/** Lowercase, `a-z0-9-` only, no leading/trailing/double dashes. */
export function toPathSegment(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

/** Normalises a user-entered base directory: no leading/trailing slashes, no `.`/`..` segments. */
export function normalizeBaseDirectory(directory: string): string {
  return directory
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    .join('/');
}

export function problemDirectoryName(problem: Problem): string {
  const { problemReference } = PLATFORM_INFO[problem.platform];
  const slug = toPathSegment(problem.slug ?? problem.title);
  const id = toPathSegment(problem.id);
  if (problemReference === 'number') {
    return slug === '' || slug === id ? id : `${id}-${slug}`;
  }
  return slug === '' ? id : slug;
}

/** `<base>/<platform>/<problem>` */
export function problemDirectory(baseDirectory: string, problem: Problem): string {
  const base = normalizeBaseDirectory(baseDirectory);
  const relative = `${problem.platform}/${problemDirectoryName(problem)}`;
  return base === '' ? relative : `${base}/${relative}`;
}

/** `001.cpp`, `002.py`, … */
export function attemptFileName(attempt: number, language: string): string {
  return `${String(attempt).padStart(3, '0')}.${fileExtension(language)}`;
}

/** e.g. "LeetCode #1477 - Attempt 3 - Accepted" or "GFG - Two Sum - Attempt 1 - Wrong Answer". */
export function commitMessage(submission: CodingSubmission, attempt: number): string {
  const info = PLATFORM_INFO[submission.platform];
  const problem =
    info.problemReference === 'number'
      ? `${info.shortName} #${submission.problem.id}`
      : `${info.shortName} - ${submission.problem.title}`;
  return `${problem} - Attempt ${String(attempt)} - ${STATUS_LABELS[submission.status]}`;
}
