# GeeksforGeeks Integration

Investigated on **2026-10-01** against `https://www.geeksforgeeks.org/problems/key-pair5616/1`
("Two Sum - Pair with Given Sum").

**Limitation of the investigation:** submitting on GFG requires a signed-in account, and no
signed-in session was available. Clicking Submit while signed out opens the login modal and sends
no request (observed). The submission flow below was therefore derived from GFG's **shipped client
JavaScript** (the code that builds the requests and renders the result), and the public
endpoints were called directly. Field names come from that code; real response *values* were not
observed. The fixtures in `tests/platforms/gfg/fixtures/` are reconstructed accordingly (see the
fixtures README). This is the first thing to confirm with a real account (see "Verifying with a
real account" below).

Everything here is **undocumented GFG behaviour** and may change without notice.

## Page Structure

| Finding                                                                                     | Source            |
| ------------------------------------------------------------------------------------------- | ----------------- |
| Next.js app; route `/problems/[probResource]/[probType]`, e.g. `/problems/key-pair5616/1`    | `__NEXT_DATA__`   |
| Problem data: `props.pageProps.initialState.problemData.allData.probData` with `id` (number, e.g. `703092`), `problem_name`, `slug`, `difficulty`, `extra.problem_languages` (`["cpp","java","python3","csharp","javascript"]`) | `__NEXT_DATA__` (observed) |
| State management is Redux Toolkit / RTK Query; requests go through `fetchBaseQuery` (`fetch`, `credentials: "include"`) | client code |
| API base: `https://practiceapiorigin.geeksforgeeks.org` + `/api/latest/` for submissions; `https://practiceapi.geeksforgeeks.org/api/latest/` for reads | client code constants |
| Like LeetCode, `__NEXT_DATA__` describes the first page loaded and can be stale after SPA navigation | assumption, handled defensively |

## Submit Detection

Buttons: **Compile & Run** and **Submit**. Detection does not use the DOM: Code Journal observes the
page's network requests (same approach as LeetCode), so keyboard shortcuts, re-renders and
SPA navigation do not matter.

```http
POST https://practiceapiorigin.geeksforgeeks.org/api/latest/problems/{slug}/submit/compile/
Content-Type: multipart/form-data   (FormData)

source=https://www.geeksforgeeks.org
request_type=solutionCheck
userCode=<the code in the editor's editable region>
language=cpp
(+ optional batch_slug / track_slug query parameters, track fields for batch problems)
```

Response (client code reads these):

```json
{ "results": { "submission_id": "…" } }
```

or, when GFG refuses to evaluate, `{ "errorMessage": "…" }` (no submission id).

**Compile & Run** uses `/problems/{slug}/compile-sub-id/` with `request_type` `testSolution`,
`expectedOutput` or `compileOutput`, and polls different result endpoints
(`/problems/submission/compile-run/result/`, `/problems/submission/compile-output`). These do not
match Code Journal's patterns and are ignored (unit-tested and checked in the live page).

## Result Retrieval

The page polls (FormData body):

```http
POST https://practiceapiorigin.geeksforgeeks.org/api/latest/problems/submission/submit/result/
sub_id=<submission_id>  sub_type=solutionCheck  pid=<problem id>
```

The response fields are top level. `status` drives polling:

| `status`               | Meaning                                    | Code Journal                     |
| ---------------------- | ------------------------------------------ | -------------------------------- |
| `QUEUED`, `PICKED`     | waiting / running                          | `SUBMISSION_JUDGING`             |
| `calculated`           | judged; score being computed               | final result                     |
| `SUCCESS`              | judged                                     | final result                     |
| `FAILED`               | GFG could not evaluate ("servers busy")    | `SUBMISSION_CAPTURE_FAILED`, not stored |

The verdict is in `view_mode`:

| `view_mode`   | GFG shows                                    | `SubmissionStatus`                |
| ------------- | -------------------------------------------- | --------------------------------- |
| `correct`     | "Problem Solved Successfully"                | `accepted`                        |
| `wrong_p`     | "Wrong Answer" with failing input/outputs    | `wrong_answer`                    |
| `wrong_cp`    | "Wrong Answer … multiple test-cases"         | `wrong_answer`                    |
| `compilation` | "Compilation Error" + `message.error`         | `compile_error`                   |
| `runtime`     | TLE if `view_cases.TLE`, else Runtime Error  | `time_limit_exceeded` / `runtime_error` |
| `optimize`    | "Time Limit Exceeded"                        | `time_limit_exceeded`             |
| other         | raw JSON                                     | `unknown`                         |

Other fields read by GFG's client: `total_test_cases`, `test_cases_processed`, and `message.{execution_time,
file_input, file_output, code_output, error, exec_time.actual_exec_time, time_upper_bound}`,
`view_cases.{TLE, segfault}`.

## Submission ID

`results.submission_id` from the submit response; repeated as `sub_id` in every poll request body.
This correlates code ↔ result, so several submissions in flight never mix.

## Source Code

The `userCode` field of the submit **request body** — exactly what GFG judged. It is the editable
part of the solution (GFG appends its own driver code server-side). The editor is never read.

## Problem Metadata

`GET https://practiceapi.geeksforgeeks.org/api/latest/problems/{slug}/` (public, no cookies needed;
verified, with `credentials: "omit"`, from the page origin):

```json
{ "results": { "id": 703092, "problem_name": "Two Sum - Pair with Given Sum", "slug": "key-pair5616", "difficulty": "Easy" } }
```

Fallback: `__NEXT_DATA__`, used only when its slug matches.

## Normalization

`normalizeGfgResult` (`src/platforms/gfg/parsers/result.ts`):

| `CodingSubmission` field | Source |
| ------------------------ | ------ |
| `id`, `platformSubmissionId` | `results.submission_id` |
| `problem.id/title/difficulty/slug/url` | problem API (`id`, `problem_name`, `difficulty`); URL `https://www.geeksforgeeks.org/problems/{slug}/1` |
| `language` | submit form `language` (`cpp`, `java`, `python3`, `csharp`, `javascript`, …) |
| `code` | submit form `userCode` |
| `status` | `view_mode` (table above) |
| `submittedAt` | local time the submit response was observed |
| `metrics.runtimeMs` | `message.execution_time`, **accepted only**. GFG shows it without a unit; treated as **seconds** (assumption) |
| `metrics.memoryBytes` | never: GFG's result exposes no memory figure |
| `metrics.testsTotal` | `total_test_cases` when > 0 (not for compile errors) |
| `metrics.testsPassed` | `test_cases_processed`, only for accepted / wrong answer, where GFG labels it "Test Cases Passed" |
| `metrics.failedTestCase` | `message.file_input` / `file_output` / `code_output` (non-accepted, non-compile) |
| `error` | `message.error`, converted from HTML to text |
| `raw` | the final result response |

Normalization fails explicitly (`SUBMISSION_PARSING_FAILED`) if the code, language, or problem
id/title is missing.

## Known Limitations

- **Not verified with a real submission** (see top). If GFG's actual response differs, the most
  likely failure is a `SUBMISSION_PARSING_FAILED` or an `unknown` status in the logs. The raw
  result is kept in the local record for diagnosis.
- `errorMessage` rejections (no submission id) are logged as capture failures and not stored, since
  their meaning (rate limit vs. compile problem) is unknown.
- Results for a submission whose submit request was not observed (page refreshed while judging,
  extension reloaded) cannot be recovered: GFG has no known endpoint returning a submission's
  code by id. LeetCode can recover these; GFG cannot.
- No memory metric; runtime only for accepted submissions, unit assumed to be seconds.
- Contest, batch and track problems use the same endpoints with extra query/body fields. They
  should work but were not investigated.
- Only `www.geeksforgeeks.org` is matched.

## Verifying with a real account

1. Load the extension, open a GFG problem, open DevTools → Console, filter `CodeJournal`.
2. Submit a wrong solution, then a correct one.
3. Expect `[CodeJournal:lifecycle] Submission normalized` with the right `status`, then
   `Submission persisted locally`. In the service worker console:
   `[CodeJournal:sync] Submission synced`.
4. In DevTools → Network, check that `submit/compile/` and `submit/result/` match the shapes
   above. If they differ, save a sanitized response as a fixture and adjust the parser.
