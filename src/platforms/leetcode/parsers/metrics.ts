import type {
  SubmissionMetrics,
  SubmissionStatus,
  TestCaseResult,
} from '../../../core/models/submission-result';
import { omitUndefined, readCount, readString, type JsonRecord } from '../../shared/json';

const NOT_AVAILABLE = 'N/A';

/**
 * Parses `status_runtime` ("3 ms", "1.2 s"). LeetCode reports "N/A" for non-accepted results.
 * `display_runtime` is deliberately not used: it is "0" on Wrong Answer, which is not a real runtime.
 */
export function parseRuntimeMs(statusRuntime: unknown): number | undefined {
  if (typeof statusRuntime !== 'string') return undefined;
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s)$/i.exec(statusRuntime.trim());
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  const value = Number(match[1]);
  return match[2].toLowerCase() === 's' ? value * 1000 : value;
}

/**
 * `memory` is in bytes. It is only trusted when LeetCode displays memory
 * (`status_memory` is not "N/A"); on failed results it is a partial figure, and 0 on Compile Error.
 */
export function parseMemoryBytes(memory: unknown, statusMemory: unknown): number | undefined {
  if (typeof statusMemory !== 'string' || statusMemory.trim() === NOT_AVAILABLE) return undefined;
  return typeof memory === 'number' && Number.isFinite(memory) && memory > 0 ? memory : undefined;
}

/**
 * Failed testcase from `last_testcase` / `expected_output` / `code_output`.
 * Empty strings are dropped: LeetCode uses "" both for "no output" and "not applicable".
 */
export function parseFailedTestCase(
  raw: JsonRecord,
  status: SubmissionStatus,
): TestCaseResult | undefined {
  if (status === 'accepted' || status === 'compile_error') return undefined;
  const testCase = omitUndefined({
    input: readString(raw.last_testcase) ?? readString(raw.input),
    expected: readString(raw.expected_output),
    actual: readString(raw.code_output),
  });
  return Object.keys(testCase).length > 0 ? testCase : undefined;
}

/** Compiler or runtime error text, preferring the full message. */
export function parseError(raw: JsonRecord): string | undefined {
  return (
    readString(raw.full_compile_error) ??
    readString(raw.compile_error) ??
    readString(raw.full_runtime_error) ??
    readString(raw.runtime_error)
  );
}

export function parseMetrics(raw: JsonRecord, status: SubmissionStatus): SubmissionMetrics {
  return omitUndefined({
    runtimeMs: parseRuntimeMs(raw.status_runtime),
    memoryBytes: parseMemoryBytes(raw.memory, raw.status_memory),
    testsPassed: readCount(raw.total_correct),
    testsTotal: readCount(raw.total_testcases),
    failedTestCase: parseFailedTestCase(raw, status),
  });
}
