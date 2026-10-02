import { isRecord, parseJson, readId, readString } from '../../shared/json';

export interface LeetCodeSubmitRequest {
  /** Language slug, e.g. "cpp". */
  lang?: string;
  /** Internal question id (not the displayed problem number). */
  questionId?: string;
  /** The exact source code sent for judging. */
  typedCode?: string;
}

/** Parses the JSON body of `POST /problems/{slug}/submit/`. */
export function parseSubmitRequest(body: string | undefined): LeetCodeSubmitRequest {
  const json = parseJson(body);
  if (!isRecord(json)) {
    return {};
  }
  const request: LeetCodeSubmitRequest = {};
  const lang = readString(json.lang);
  const questionId = readId(json.question_id);
  if (lang !== undefined) request.lang = lang;
  if (questionId !== undefined) request.questionId = questionId;
  // Kept even when empty: it is still exactly what was submitted.
  if (typeof json.typed_code === 'string') request.typedCode = json.typed_code;
  return request;
}

/** Extracts `submission_id` from the submit response; undefined if absent or malformed. */
export function parseSubmitResponse(text: string): string | undefined {
  const json = parseJson(text);
  return isRecord(json) ? readId(json.submission_id) : undefined;
}
