import type { ProblemReference } from '../../core/models/problem';
import type { ObservationRule } from '../shared/network-observer';
import { parseNextDataProblem, parseProblemResponse, toProblemReference } from './parsers/problem';

export const GFG_ORIGIN = 'https://www.geeksforgeeks.org';
export const GFG_CHANNEL = 'code-journal:gfg';
/** Public problem API used by the practice pages. */
export const GFG_API_BASE = 'https://practiceapi.geeksforgeeks.org/api/latest';

/** Hosts the practice page sends submissions to (observed: practiceapiorigin). */
const API_HOSTS = new Set(['practiceapiorigin.geeksforgeeks.org', 'practiceapi.geeksforgeeks.org']);

export type GfgRequest = { kind: 'submit'; slug: string } | { kind: 'result' };

// /api/{version}/problems/{slug}/submit/compile/ — "Compile & Run" uses /compile-sub-id/ instead.
const SUBMIT_PATH = /^\/api\/[^/]+\/problems\/([^/]+)\/submit\/compile\/?$/;
// Run results poll /problems/submission/compile-run/result/ and must not match.
const RESULT_PATH = /^\/api\/[^/]+\/problems\/submission\/submit\/result\/?$/;

/** Identifies the GFG requests that belong to the submission lifecycle. */
export function classifyGfgRequest(url: URL, method: string): GfgRequest | undefined {
  if (
    url.protocol !== 'https:' ||
    !API_HOSTS.has(url.hostname) ||
    method.toUpperCase() !== 'POST'
  ) {
    return undefined;
  }
  const submit = SUBMIT_PATH.exec(url.pathname);
  if (submit?.[1] !== undefined) {
    return { kind: 'submit', slug: decodeURIComponent(submit[1]) };
  }
  return RESULT_PATH.test(url.pathname) ? { kind: 'result' } : undefined;
}

/** Both requests carry form bodies we need: the code (submit) and the submission id (result). */
export function gfgObservationRule(url: URL, method: string): ObservationRule | undefined {
  return classifyGfgRequest(url, method) === undefined ? undefined : { captureRequestBody: true };
}

export function problemUrl(slug: string): string {
  return `${GFG_ORIGIN}/problems/${encodeURIComponent(slug)}/1`;
}

export interface ProblemLookupDeps {
  fetch: typeof fetch;
  /** Returns the text of the page's `__NEXT_DATA__` script, if present. */
  readNextData: () => string | undefined;
  timeoutMs?: number;
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
    const response = await deps.fetch(`${GFG_API_BASE}/problems/${encodeURIComponent(slug)}/`, {
      credentials: 'omit',
      signal: AbortSignal.timeout(deps.timeoutMs ?? 5000),
    });
    if (response.ok) {
      const problem = parseProblemResponse(await response.text());
      if (problem?.slug === slug) {
        return toProblemReference(url, slug, problem);
      }
    }
  } catch {
    // Fall through to page data.
  }
  const nextData = deps.readNextData();
  const fromPage = nextData === undefined ? undefined : parseNextDataProblem(nextData);
  return toProblemReference(url, slug, fromPage);
}
