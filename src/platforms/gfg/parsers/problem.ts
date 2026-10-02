import type { ProblemReference } from '../../../core/models/problem';
import { isRecord, parseJson, readId, readString } from '../../shared/json';

export interface GfgProblem {
  /** Numeric problem id (`id`, also sent as `pid` when polling results). */
  id?: string;
  title?: string;
  slug: string;
  difficulty?: string;
}

function toProblem(value: unknown): GfgProblem | undefined {
  if (!isRecord(value)) return undefined;
  const slug = readString(value.slug);
  if (slug === undefined) return undefined;
  const problem: GfgProblem = { slug };
  const id = readId(value.id);
  const title = readString(value.problem_name);
  const difficulty = readString(value.difficulty) ?? readString(value.problem_level_text);
  if (id !== undefined) problem.id = id;
  if (title !== undefined) problem.title = title;
  if (difficulty !== undefined) problem.difficulty = difficulty;
  return problem;
}

/** Parses `GET practiceapi…/api/latest/problems/{slug}/` → `{ results: { id, problem_name, slug, difficulty } }`. */
export function parseProblemResponse(text: string): GfgProblem | undefined {
  const json = parseJson(text);
  return isRecord(json) ? toProblem(json.results) : undefined;
}

/**
 * Extracts the problem from `__NEXT_DATA__`
 * (`props.pageProps.initialState.problemData.allData.probData`). Can be stale after
 * client-side navigation, so callers must check the slug.
 */
export function parseNextDataProblem(text: string): GfgProblem | undefined {
  const json = parseJson(text);
  let node: unknown = json;
  for (const key of ['props', 'pageProps', 'initialState', 'problemData', 'allData', 'probData']) {
    node = isRecord(node) ? node[key] : undefined;
  }
  return toProblem(node);
}

export function toProblemReference(
  url: string,
  slug: string,
  problem?: GfgProblem,
): ProblemReference {
  const reference: ProblemReference = { platform: 'gfg', url, slug };
  if (problem?.slug !== slug) return reference;
  if (problem.id !== undefined) reference.id = problem.id;
  if (problem.title !== undefined) reference.title = problem.title;
  if (problem.difficulty !== undefined) reference.difficulty = problem.difficulty;
  return reference;
}
