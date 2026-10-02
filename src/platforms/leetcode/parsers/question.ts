import type { ProblemReference } from '../../../core/models/problem';
import { isRecord, parseJson, readId, readString } from '../../shared/json';

export interface LeetCodeQuestion {
  /** Internal id, as sent in the submit request's `question_id`. */
  questionId?: string;
  /** Displayed problem number, e.g. "1477". */
  questionFrontendId?: string;
  title?: string;
  titleSlug: string;
  difficulty?: string;
}

export function toQuestion(value: unknown): LeetCodeQuestion | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const titleSlug = readString(value.titleSlug);
  if (titleSlug === undefined) {
    return undefined;
  }
  const question: LeetCodeQuestion = { titleSlug };
  const questionId = readId(value.questionId);
  const questionFrontendId = readId(value.questionFrontendId);
  const title = readString(value.title);
  const difficulty = readString(value.difficulty);
  if (questionId !== undefined) question.questionId = questionId;
  if (questionFrontendId !== undefined) question.questionFrontendId = questionFrontendId;
  if (title !== undefined) question.title = title;
  if (difficulty !== undefined) question.difficulty = difficulty;
  return question;
}

/** Parses the GraphQL `question(titleSlug)` response body. */
export function parseQuestionResponse(text: string): LeetCodeQuestion | undefined {
  const json = parseJson(text);
  if (!isRecord(json) || !isRecord(json.data)) {
    return undefined;
  }
  return toQuestion(json.data.question);
}

/**
 * Extracts the question from the `__NEXT_DATA__` script text.
 * This data goes stale after client-side navigation, so callers must check `titleSlug`.
 */
export function parseNextDataQuestion(text: string): LeetCodeQuestion | undefined {
  const json = parseJson(text);
  if (!isRecord(json) || !isRecord(json.props) || !isRecord(json.props.pageProps)) {
    return undefined;
  }
  const state = json.props.pageProps.dehydratedState;
  if (!isRecord(state) || !Array.isArray(state.queries)) {
    return undefined;
  }
  for (const query of state.queries as unknown[]) {
    if (!isRecord(query) || !Array.isArray(query.queryKey)) continue;
    if (query.queryKey[0] !== 'questionDetail') continue;
    if (isRecord(query.state) && isRecord(query.state.data)) {
      return toQuestion(query.state.data.question);
    }
  }
  return undefined;
}

export function toProblemReference(
  url: string,
  slug: string,
  question?: LeetCodeQuestion,
): ProblemReference {
  const problem: ProblemReference = { platform: 'leetcode', url, slug };
  if (question?.titleSlug !== slug) {
    return problem;
  }
  if (question.questionFrontendId !== undefined) problem.id = question.questionFrontendId;
  if (question.title !== undefined) problem.title = question.title;
  if (question.difficulty !== undefined) problem.difficulty = question.difficulty;
  return problem;
}
