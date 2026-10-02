import type { CodingSubmission } from '../../../core/models/coding-submission';
import { isCompleteProblem, type ProblemReference } from '../../../core/models/problem';
import type {
  SubmissionMetrics,
  SubmissionStatus,
  TestCaseResult,
} from '../../../core/models/submission-result';
import {
  isRecord,
  omitUndefined,
  parseJson,
  readCount,
  readString,
  type JsonRecord,
} from '../../shared/json';

export type GfgResultPhase =
  /** Still queued or running ("QUEUED", "PICKED", …). */
  | 'judging'
  /** Judged: "SUCCESS", or "calculated" (judged, score being computed). */
  | 'final'
  /** GFG could not evaluate the submission ("FAILED", e.g. servers busy). */
  | 'evaluation_failed';

export interface GfgResultResponse {
  /** GFG's `status` value, e.g. "QUEUED", "SUCCESS". */
  state: string;
  phase: GfgResultPhase;
  raw: JsonRecord;
}

const FINAL_STATES = new Set(['SUCCESS', 'CALCULATED']);

/**
 * Parses `POST …/problems/submission/submit/result/`. The result fields are top level
 * (`status`, `view_mode`, `message`, `total_test_cases`, …); a `results` wrapper is
 * accepted too, since the page itself reads `data.results || data` on related endpoints.
 */
export function parseResultResponse(text: string): GfgResultResponse | undefined {
  const json = parseJson(text);
  if (!isRecord(json)) return undefined;
  const raw = readString(json.status) === undefined && isRecord(json.results) ? json.results : json;
  const state = readString(raw.status);
  if (state === undefined) return undefined;
  const upper = state.toUpperCase();
  const phase: GfgResultPhase = FINAL_STATES.has(upper)
    ? 'final'
    : upper === 'FAILED'
      ? 'evaluation_failed'
      : 'judging';
  return { state, phase, raw };
}

function messageOf(raw: JsonRecord): JsonRecord {
  return isRecord(raw.message) ? raw.message : {};
}

/**
 * `view_mode` drives GFG's own result rendering:
 * correct → accepted; wrong_p / wrong_cp → wrong answer; compilation → compile error;
 * runtime → runtime error, or TLE when `view_cases.TLE` is set; optimize → TLE.
 */
export function mapGfgStatus(raw: JsonRecord): SubmissionStatus {
  const viewMode = readString(raw.view_mode)?.toLowerCase();
  const viewCases = isRecord(raw.view_cases) ? raw.view_cases : {};
  switch (viewMode) {
    case 'correct':
      return 'accepted';
    case 'wrong_p':
    case 'wrong_cp':
      return 'wrong_answer';
    case 'compilation':
      return 'compile_error';
    case 'runtime':
      return viewCases.TLE === true || viewCases.TLE === 1
        ? 'time_limit_exceeded'
        : 'runtime_error';
    case 'optimize':
      return 'time_limit_exceeded';
    default:
      return 'unknown';
  }
}

/**
 * `message.execution_time`. GFG shows it without a unit; it is in seconds (e.g. "0.12").
 * Values with an explicit "ms"/"s" unit are converted accordingly.
 */
export function parseExecutionTimeMs(value: unknown): number | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) && value >= 0 ? value * 1000 : undefined;
  if (typeof value !== 'string') return undefined;
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds)?$/i.exec(value.trim());
  if (match?.[1] === undefined) return undefined;
  const number = Number(match[1]);
  const ms = match[2]?.toLowerCase() === 'ms' ? number : number * 1000;
  return Math.round(ms * 1000) / 1000;
}

/** GFG error text is HTML (the page decodes it before display). */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

function parseFailedTestCase(
  message: JsonRecord,
  status: SubmissionStatus,
): TestCaseResult | undefined {
  if (status === 'accepted' || status === 'compile_error') return undefined;
  const testCase = omitUndefined({
    input: readString(message.file_input),
    expected: readString(message.file_output),
    actual: readString(message.code_output),
  });
  return Object.keys(testCase).length > 0 ? testCase : undefined;
}

export function parseGfgMetrics(raw: JsonRecord, status: SubmissionStatus): SubmissionMetrics {
  const message = messageOf(raw);
  const total = readCount(raw.total_test_cases);
  const processed = readCount(raw.test_cases_processed);
  const hasTests = status !== 'compile_error' && total !== undefined && total > 0;
  // GFG labels `test_cases_processed` as "Test Cases Passed" only for correct / wrong answers.
  const passedIsMeaningful = status === 'accepted' || status === 'wrong_answer';
  return omitUndefined({
    runtimeMs: status === 'accepted' ? parseExecutionTimeMs(message.execution_time) : undefined,
    testsTotal: hasTests ? total : undefined,
    testsPassed:
      hasTests && passedIsMeaningful && processed !== undefined
        ? Math.min(processed, total)
        : undefined,
    failedTestCase: parseFailedTestCase(message, status),
  });
}

export function parseGfgError(raw: JsonRecord): string | undefined {
  const error = readString(messageOf(raw).error);
  const text = error === undefined ? undefined : htmlToText(error);
  return text === '' ? undefined : text;
}

/** What was known about a submission when it was submitted. */
export interface GfgSubmissionContext {
  submissionId: string;
  problem: ProblemReference;
  language?: string;
  code?: string;
  detectedAt: string;
}

export type NormalizeResult =
  { ok: true; submission: CodingSubmission } | { ok: false; reason: string };

/** Combines a final result with its submit-time context. Never fabricates missing fields. */
export function normalizeGfgResult(
  raw: JsonRecord,
  context: GfgSubmissionContext,
): NormalizeResult {
  if (context.code === undefined) {
    return { ok: false, reason: 'Submitted code was not captured' };
  }
  if (context.language === undefined) {
    return { ok: false, reason: 'Submission language is unknown' };
  }
  const { problem } = context;
  if (!isCompleteProblem(problem)) {
    return { ok: false, reason: 'Problem id or title is unavailable' };
  }
  const status = mapGfgStatus(raw);
  const submission: CodingSubmission = {
    id: context.submissionId,
    platform: 'gfg',
    problem,
    language: context.language,
    code: context.code,
    status,
    submittedAt: context.detectedAt,
    metrics: parseGfgMetrics(raw, status),
    platformSubmissionId: context.submissionId,
    raw,
  };
  const error = parseGfgError(raw);
  if (error !== undefined && status !== 'accepted') {
    submission.error = error;
  }
  return { ok: true, submission };
}
