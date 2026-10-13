import type { ProblemReference } from '../../core/models/problem';
import type { ObservationRule } from '../shared/network-observer';
import { parseSubmissionDetailsResponse, type LeetCodeSubmissionDetails } from './parsers/details';
import {
  parseNextDataQuestion,
  parseQuestionResponse,
  toProblemReference,
} from './parsers/question';

export const LEETCODE_ORIGIN = 'https://leetcode.com';
export const LEETCODE_CHANNEL = 'code-journal:leetcode';

export type LeetCodeRequest =
  { kind: 'submit'; slug: string } | { kind: 'check'; submissionId: string };

const SUBMIT_PATH = /^\/problems\/([^/]+)\/submit\/?$/;
// Numeric ids only: "Run" results use `runcode_…` ids and must not match.
const CHECK_PATH = /^\/submissions\/detail\/(\d+)\/(?:v\d+\/)?check\/?$/;

/** Identifies the LeetCode requests that belong to the submission lifecycle. */
export function classifyLeetCodeRequest(url: URL, method: string): LeetCodeRequest | undefined {
  if (url.origin !== LEETCODE_ORIGIN) {
    return undefined;
  }
  const verb = method.toUpperCase();
  const submit = verb === 'POST' ? SUBMIT_PATH.exec(url.pathname) : null;
  if (submit?.[1] !== undefined) {
    return { kind: 'submit', slug: decodeURIComponent(submit[1]) };
  }
  const check = verb === 'GET' ? CHECK_PATH.exec(url.pathname) : null;
  if (check?.[1] !== undefined) {
    return { kind: 'check', submissionId: check[1] };
  }
  return undefined;
}

/** Network observer rule: forward submit (with its body, which holds the code) and check polls. */
export function leetCodeObservationRule(url: URL, method: string): ObservationRule | undefined {
  const request = classifyLeetCodeRequest(url, method);
  return request === undefined ? undefined : { captureRequestBody: request.kind === 'submit' };
}

export function problemUrl(slug: string): string {
  return `${LEETCODE_ORIGIN}/problems/${encodeURIComponent(slug)}/`;
}

const QUESTION_QUERY = `query codeJournalQuestion($titleSlug: String!) {
  question(titleSlug: $titleSlug) { questionId questionFrontendId title titleSlug difficulty }
}`;

// Only the fields needed to recover a submission; no user fields are requested.
// Only the user's own submission data; no user fields are requested. Field names validated
// against leetcode.com's schema (2026-10-04).
const DETAILS_QUERY = `query codeJournalSubmission($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) {
    code timestamp statusCode runtimeDisplay totalCorrect totalTestcases
    lastTestcase expectedOutput codeOutput compileError runtimeError
    lang { name }
    question { questionId questionFrontendId title titleSlug difficulty }
  }
}`;

// All of the user's submissions, newest first, 20 per page.
const HISTORY_QUERY = `query codeJournalHistory($offset: Int!, $limit: Int!, $lastKey: String) {
  submissionList(offset: $offset, limit: $limit, lastKey: $lastKey) {
    lastKey hasNext
    submissions { id titleSlug statusDisplay lang timestamp isPending }
  }
}`;

export const HISTORY_PAGE_SIZE = 20;

/** An HTTP failure while importing history; `retryAfterMs` is set for rate limiting (429). */
export class LeetCodeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(`LeetCode returned HTTP ${String(status)}`);
    this.name = 'LeetCodeHttpError';
  }
}

export interface LeetCodeApiDeps {
  fetch: typeof fetch;
  timeoutMs?: number;
}

export interface ProblemLookupDeps extends LeetCodeApiDeps {
  /** Returns the text of the page's `__NEXT_DATA__` script, if present. */
  readNextData: () => string | undefined;
}

function postGraphql(
  deps: LeetCodeApiDeps,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<Response> {
  return deps.fetch(`${LEETCODE_ORIGIN}/graphql/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operationName, query, variables }),
    signal: AbortSignal.timeout(deps.timeoutMs ?? 5000),
  });
}

async function graphql(
  deps: LeetCodeApiDeps,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<string | undefined> {
  const response = await postGraphql(deps, operationName, query, variables);
  return response.ok ? response.text() : undefined;
}

/** Like `graphql`, but HTTP failures throw `LeetCodeHttpError` so callers can back off. */
async function graphqlOrThrow(
  deps: LeetCodeApiDeps,
  operationName: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<string> {
  const response = await postGraphql(deps, operationName, query, variables);
  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after');
    const seconds =
      retryAfter !== null && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
    throw new LeetCodeHttpError(
      response.status,
      seconds === undefined ? undefined : seconds * 1000,
    );
  }
  return response.text();
}

/** One page of the signed-in user's submission history (`text` is the raw response). */
export function fetchHistoryPage(
  offset: number,
  lastKey: string | undefined,
  deps: LeetCodeApiDeps,
): Promise<string> {
  return graphqlOrThrow(deps, 'codeJournalHistory', HISTORY_QUERY, {
    offset,
    limit: HISTORY_PAGE_SIZE,
    lastKey: lastKey ?? null,
  });
}

/** Code and result of one submission, for the history import. Throws on HTTP failure. */
export async function fetchSubmissionRecord(
  submissionId: string,
  deps: LeetCodeApiDeps,
): Promise<LeetCodeSubmissionDetails | undefined> {
  const text = await graphqlOrThrow(deps, 'codeJournalSubmission', DETAILS_QUERY, {
    submissionId: Number(submissionId),
  });
  return parseSubmissionDetailsResponse(text);
}

/**
 * Resolves problem metadata for a slug. Never rejects: falls back to `__NEXT_DATA__`
 * (only if it describes the same slug), then to a reference containing just the slug.
 */
export async function lookupProblem(
  slug: string,
  deps: ProblemLookupDeps,
): Promise<ProblemReference> {
  const url = problemUrl(slug);
  try {
    const text = await graphql(deps, 'codeJournalQuestion', QUESTION_QUERY, { titleSlug: slug });
    const question = text === undefined ? undefined : parseQuestionResponse(text);
    if (question?.titleSlug === slug) {
      return toProblemReference(url, slug, question);
    }
  } catch {
    // Fall through to page data.
  }
  const nextData = deps.readNextData();
  const fromPage = nextData === undefined ? undefined : parseNextDataQuestion(nextData);
  return toProblemReference(url, slug, fromPage);
}

/**
 * Fetches the stored code and metadata of one of the user's submissions. Used only to
 * recover a submission whose submit request was missed (page refreshed while judging,
 * extension reloaded). Returns undefined on any failure.
 */
export async function fetchSubmissionDetails(
  submissionId: string,
  deps: LeetCodeApiDeps,
): Promise<LeetCodeSubmissionDetails | undefined> {
  try {
    const text = await graphql(deps, 'codeJournalSubmission', DETAILS_QUERY, {
      submissionId: Number(submissionId),
    });
    return text === undefined ? undefined : parseSubmissionDetailsResponse(text);
  } catch {
    return undefined;
  }
}
