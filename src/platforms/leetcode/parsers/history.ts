import type { CodingSubmission } from '../../../core/models/coding-submission';
import { isCompleteProblem } from '../../../core/models/problem';
import type { SubmissionStatus, TestCaseResult } from '../../../core/models/submission-result';
import {
  isRecord,
  omitUndefined,
  parseJson,
  readCount,
  readId,
  readString,
  type JsonRecord,
} from '../../shared/json';
import { problemUrl } from '../leetcode-api';
import type { LeetCodeSubmissionDetails } from './details';
import { parseRuntimeMs } from './metrics';
import { toProblemReference } from './question';
import { mapLeetCodeStatus } from './status';

/** One row of GraphQL `submissionList` (no code: that needs `submissionDetails`). */
export interface HistoryItem {
  id: string;
  titleSlug?: string;
  statusDisplay?: string;
  lang?: string;
  /** ISO-8601, from `timestamp` (Unix seconds). */
  submittedAt?: string;
  isPending: boolean;
}

export interface HistoryPage {
  items: HistoryItem[];
  hasNext: boolean;
  lastKey?: string;
}

/** Unix seconds (number or numeric string) → ISO-8601. */
export function unixSecondsToIso(value: unknown): string | undefined {
  const seconds = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : undefined;
}

/** Parses a `submissionList` response. Rows without an id are dropped; undefined when signed out. */
export function parseHistoryPage(text: string): HistoryPage | undefined {
  const json = parseJson(text);
  if (!isRecord(json) || !isRecord(json.data) || !isRecord(json.data.submissionList)) {
    return undefined;
  }
  const list = json.data.submissionList;
  // Signed out, LeetCode answers with `submissions: null`.
  if (!Array.isArray(list.submissions)) return undefined;
  const rows = list.submissions as unknown[];
  const items = rows.flatMap((row): HistoryItem[] => {
    if (!isRecord(row)) return [];
    const id = readId(row.id);
    if (id === undefined) return [];
    const item: HistoryItem = {
      id,
      isPending: row.isPending === true || readString(row.isPending)?.toLowerCase() === 'pending',
    };
    const titleSlug = readString(row.titleSlug);
    const statusDisplay = readString(row.statusDisplay);
    const lang = readString(row.lang);
    const submittedAt = unixSecondsToIso(row.timestamp);
    if (titleSlug !== undefined) item.titleSlug = titleSlug;
    if (statusDisplay !== undefined) item.statusDisplay = statusDisplay;
    if (lang !== undefined) item.lang = lang;
    if (submittedAt !== undefined) item.submittedAt = submittedAt;
    return [item];
  });
  const page: HistoryPage = { items, hasNext: list.hasNext === true };
  const lastKey = readString(list.lastKey);
  if (lastKey !== undefined) page.lastKey = lastKey;
  return page;
}

function failedTestCase(record: JsonRecord, status: SubmissionStatus): TestCaseResult | undefined {
  if (status === 'accepted' || status === 'compile_error') return undefined;
  const testCase = omitUndefined({
    input: readString(record.lastTestcase),
    expected: readString(record.expectedOutput),
    actual: readString(record.codeOutput),
  });
  return Object.keys(testCase).length > 0 ? testCase : undefined;
}

export type HistoryNormalizeResult =
  { ok: true; submission: CodingSubmission } | { ok: false; reason: string };

/**
 * Builds a submission from a history row and its `submissionDetails`. Memory is left out:
 * the history API's memory value/unit has not been verified, and a rounded display string
 * ("15 MB") is not an exact figure.
 */
export function normalizeHistorySubmission(
  item: HistoryItem,
  details: LeetCodeSubmissionDetails,
): HistoryNormalizeResult {
  const { record } = details;
  const language = details.language ?? item.lang;
  if (language === undefined) return { ok: false, reason: 'Submission language is unknown' };
  const submittedAt = details.submittedAt ?? item.submittedAt;
  if (submittedAt === undefined) return { ok: false, reason: 'Submission time is unknown' };
  const slug = details.question?.titleSlug ?? item.titleSlug;
  if (slug === undefined) return { ok: false, reason: 'Problem is unknown' };
  const problem = toProblemReference(problemUrl(slug), slug, details.question);
  if (!isCompleteProblem(problem)) {
    return { ok: false, reason: 'Problem id or title is unavailable' };
  }

  const status = mapLeetCodeStatus(record.statusCode, item.statusDisplay);
  const submission: CodingSubmission = {
    id: item.id,
    platformSubmissionId: item.id,
    platform: 'leetcode',
    problem,
    language,
    code: details.code,
    status,
    submittedAt,
    metrics: omitUndefined({
      runtimeMs: parseRuntimeMs(record.runtimeDisplay),
      testsPassed: readCount(record.totalCorrect),
      testsTotal: readCount(record.totalTestcases),
      failedTestCase: failedTestCase(record, status),
    }),
    raw: { source: 'history', statusDisplay: item.statusDisplay, details: record },
  };
  const error = readString(record.compileError) ?? readString(record.runtimeError);
  if (error !== undefined) submission.error = error;
  return { ok: true, submission };
}
