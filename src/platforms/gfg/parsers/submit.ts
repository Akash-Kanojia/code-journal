import { isRecord, parseJson, readId, readString } from '../../shared/json';

export interface GfgSubmitRequest {
  /** Language id, e.g. "cpp", "python3". */
  language?: string;
  /** The exact code the user submitted (the editable part, without GFG's driver code). */
  userCode?: string;
  /** "solutionCheck" for Submit. */
  requestType?: string;
}

/** Reads the FormData body of `POST …/problems/{slug}/submit/compile/`. */
export function parseSubmitRequest(form: Record<string, string> | undefined): GfgSubmitRequest {
  if (form === undefined) return {};
  const request: GfgSubmitRequest = {};
  const language = readString(form.language);
  const requestType = readString(form.request_type);
  if (language !== undefined) request.language = language;
  if (requestType !== undefined) request.requestType = requestType;
  // Kept even when empty: it is still exactly what was submitted.
  if (typeof form.userCode === 'string') request.userCode = form.userCode;
  return request;
}

export type GfgSubmitResponse = { ok: true; submissionId: string } | { ok: false; reason: string };

/** `{ results: { submission_id } }` on success; `{ errorMessage }` when GFG rejects the submission. */
export function parseSubmitResponse(text: string): GfgSubmitResponse {
  const json = parseJson(text);
  if (!isRecord(json)) return { ok: false, reason: 'Submit response is not JSON' };
  const results = isRecord(json.results) ? json.results : undefined;
  const submissionId = readId(results?.submission_id) ?? readId(json.submission_id);
  if (submissionId !== undefined) return { ok: true, submissionId };
  const message = readString(json.errorMessage) ?? readString(json.message);
  return {
    ok: false,
    reason:
      message === undefined
        ? 'Submit response did not contain a submission id'
        : `GFG rejected the submission: ${message}`,
  };
}

/** Reads the FormData body of `POST …/problems/submission/submit/result/`. */
export function parseResultRequest(form: Record<string, string> | undefined): {
  submissionId?: string;
  problemId?: string;
} {
  const result: { submissionId?: string; problemId?: string } = {};
  const submissionId = readId(form?.sub_id);
  const problemId = readId(form?.pid);
  if (submissionId !== undefined) result.submissionId = submissionId;
  if (problemId !== undefined) result.problemId = problemId;
  return result;
}
