import type { Platform } from '../types/platform';

export interface Problem {
  /** Platform-scoped identifier, e.g. LeetCode frontend question id "1477". */
  id: string;
  title: string;
  url: string;
  platform: Platform;
  difficulty?: string;
  slug?: string;
}

/**
 * What is known about a problem at the time a submission is detected.
 * Only `platform` and `url` are guaranteed; everything else may be unavailable.
 */
export type ProblemReference = Pick<Problem, 'platform' | 'url'> &
  Partial<Omit<Problem, 'platform' | 'url'>>;

/** True when the reference has everything a `Problem` requires. */
export function isCompleteProblem(problem: ProblemReference): problem is Problem {
  return problem.id !== undefined && problem.title !== undefined;
}
