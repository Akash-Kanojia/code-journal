import { isRecord, parseJson, readString } from '../../shared/json';
import { toQuestion, type LeetCodeQuestion } from './question';

/** Recovered from GraphQL `submissionDetails`, used when the submit request was not observed. */
export interface LeetCodeSubmissionDetails {
  code: string;
  /** Language slug, e.g. "cpp". */
  language?: string;
  /** ISO-8601, from `timestamp` (Unix seconds). */
  submittedAt?: string;
  question?: LeetCodeQuestion;
}

/** Parses the `submissionDetails` GraphQL response; undefined if it carries no code. */
export function parseSubmissionDetailsResponse(
  text: string,
): LeetCodeSubmissionDetails | undefined {
  const json = parseJson(text);
  if (!isRecord(json) || !isRecord(json.data) || !isRecord(json.data.submissionDetails)) {
    return undefined;
  }
  const details = json.data.submissionDetails;
  if (typeof details.code !== 'string') {
    return undefined;
  }
  const result: LeetCodeSubmissionDetails = { code: details.code };
  const language = isRecord(details.lang) ? readString(details.lang.name) : undefined;
  if (language !== undefined) result.language = language;
  const timestamp = Number(details.timestamp);
  if (Number.isFinite(timestamp) && timestamp > 0) {
    result.submittedAt = new Date(timestamp * 1000).toISOString();
  }
  const question = toQuestion(details.question);
  if (question !== undefined) result.question = question;
  return result;
}
