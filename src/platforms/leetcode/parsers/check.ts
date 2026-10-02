import { isRecord, parseJson, readId, readString, type JsonRecord } from '../../shared/json';

export interface LeetCodeCheckResponse {
  /** Judging state reported by LeetCode, e.g. "PENDING", "RUNNING_TESTS", "SUCCESS". */
  state: string;
  /** True once judging has produced a final result. */
  finished: boolean;
  submissionId?: string;
  raw: JsonRecord;
}

/**
 * Parses `GET /submissions/detail/{id}/v2/check/`.
 * Only lifecycle fields are interpreted here; the result itself is normalised later.
 */
export function parseCheckResponse(text: string): LeetCodeCheckResponse | undefined {
  const json = parseJson(text);
  if (!isRecord(json)) {
    return undefined;
  }
  const state = readString(json.state);
  if (state === undefined) {
    return undefined;
  }
  const response: LeetCodeCheckResponse = {
    state,
    // "SUCCESS" means judging finished, not that the submission was accepted.
    finished: json.finished === true || state === 'SUCCESS',
    raw: json,
  };
  const submissionId = readId(json.submission_id);
  if (submissionId !== undefined) {
    response.submissionId = submissionId;
  }
  return response;
}
