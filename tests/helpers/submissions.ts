import type { CodingSubmission } from '../../src/core/models/coding-submission';

let sequence = 0;

/** A realistic normalized LeetCode submission; override any field. */
export function leetCodeSubmission(overrides: Partial<CodingSubmission> = {}): CodingSubmission {
  sequence++;
  const id = overrides.id ?? String(1000000000 + sequence);
  return {
    id,
    platformSubmissionId: id,
    platform: 'leetcode',
    problem: {
      platform: 'leetcode',
      id: '1477',
      title: 'Find Two Non-overlapping Sub-arrays Each With Target Sum',
      slug: 'find-two-non-overlapping-sub-arrays-each-with-target-sum',
      url: 'https://leetcode.com/problems/find-two-non-overlapping-sub-arrays-each-with-target-sum/',
      difficulty: 'Medium',
    },
    language: 'javascript',
    code: `// attempt ${id}\nvar minSumOfLengths = function(arr, target) {};\n`,
    status: 'wrong_answer',
    submittedAt: new Date(Date.UTC(2026, 8, 28, 12, 0, sequence)).toISOString(),
    metrics: { testsPassed: 17, testsTotal: 21 },
    raw: { status_code: 11 },
    ...overrides,
  };
}

export function gfgSubmission(overrides: Partial<CodingSubmission> = {}): CodingSubmission {
  return leetCodeSubmission({
    platform: 'gfg',
    problem: {
      platform: 'gfg',
      id: '703092',
      title: 'Two Sum - Pair with Given Sum',
      slug: 'key-pair5616',
      url: 'https://www.geeksforgeeks.org/problems/key-pair5616/1',
      difficulty: 'Easy',
    },
    language: 'cpp',
    ...overrides,
  });
}
