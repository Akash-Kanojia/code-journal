# LeetCode Integration

Investigated on **2026-09-28** against `https://leetcode.com` while logged in, using a C++ solution to
"1. Two Sum". Five real submissions were observed: Compile Error, Wrong Answer, Runtime Error,
Time Limit Exceeded, Accepted. The **Run** button was also observed, for contrast.

Method: an in-page recorder wrapped `window.fetch`, `XMLHttpRequest` and `WebSocket` and logged URLs,
request bodies and response bodies. It did not read request headers, cookies or tokens. Sanitised
response fixtures (with fake submission IDs) are in `tests/platforms/leetcode/fixtures/`.

Everything below is **undocumented LeetCode behaviour** and may change without notice.

## Page Structure

| Finding                                                                                                            | Source                                 |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| Next.js app; the problem route is `/problems/[slug]/[[...tab]]` (e.g. `/problems/two-sum/description/`)            | `__NEXT_DATA__.page`                   |
| After a submit the URL changes client-side to `/problems/{slug}/submissions/{submissionId}/`                        | `location` (SPA navigation)            |
| Problem data is embedded in `<script id="__NEXT_DATA__">` under `props.pageProps.dehydratedState.queries[queryKey[0] === "questionDetail"].state.data.question` | DOM / page state |
| That question object has `questionId` (internal), `questionFrontendId` (the displayed number), `title`, `titleSlug`, `difficulty`, `isPaidOnly`, `codeSnippets[].langSlug`, … | page state |
| **`__NEXT_DATA__` goes stale.** After client-side navigation between problems it still describes the first problem loaded | page state (verified with `next.router.push`) |
| Editor is Monaco (`window.monaco`), but LeetCode keeps its own copy of the code (see Source Code)                   | page state                             |
| Submit button: `<button data-e2e-locator="console-submit-button" aria-label="Submit">`                             | DOM                                    |
| Run button: `<button data-e2e-locator="console-run-button" aria-label="Run">`                                      | DOM                                    |

`questionId` and `questionFrontendId` are **not the same**. For "1477. Find Two Non-overlapping
Sub-arrays Each With Target Sum", `questionId` is `"1573"` and `questionFrontendId` is `"1477"`. The
user-facing problem number is `questionFrontendId`.

## Submit Detection

There are at least two ways to submit:

1. Clicking the Submit button (`data-e2e-locator="console-submit-button"`).
2. The keyboard shortcut **Cmd/Ctrl + Enter** in the editor. **No button click happens**, but the
   same network request is sent (observed).

So clicks and DOM state can't be the source of truth for detecting submissions. The reliable signal
is the submit **network request** (below), which all submit paths share. The click and `data-e2e-locator`
are only useful as an optional early hint and are not used by the adapter.

## Submission Creation

Source: network request (`fetch`, not XHR).

```http
POST /problems/{titleSlug}/submit/
Content-Type: application/json

{"lang": "cpp", "question_id": "1", "typed_code": "class Solution { ... }"}
```

- `lang` is the language slug (`cpp`, `python3`, `java`, …), the same values as `codeSnippets[].langSlug`.
- `question_id` is the **internal** `questionId`, not the displayed number.
- `typed_code` is the exact source LeetCode judges.

Response (HTTP 200):

```json
{ "submission_id": 2156310297 }
```

The **Run** button uses a different endpoint and must be ignored:

```http
POST /problems/{titleSlug}/interpret_solution/
{"lang": "...", "question_id": "...", "typed_code": "...", "data_input": "..."}
→ {"interpret_id": "runcode_1790618047.3461432_XXXXXXXXXX", "test_case": "..."}
```

## Submission ID

Source: the JSON response of `POST /problems/{slug}/submit/`, field `submission_id` (a number).

- It's available **as soon as the submit request returns**, before judging starts.
- It appears again as a string in every final check response (`"submission_id": "2156310297"`)
  and in the SPA URL `/problems/{slug}/submissions/{id}/`.
- Run requests use `interpret_id` values with a `runcode_` prefix, which never collide with numeric
  submission IDs.

## Result Retrieval

Source: **HTTP polling** with `fetch`. WebSocket, DOM and GraphQL are not involved.

```http
GET /submissions/detail/{submissionId}/v2/check/
```

This is polled about every 0.5–1 s. Intermediate responses (observed):

```json
{"state": "PENDING"}
{"state": "RUNNING_TESTS"}
```

The final response has `"state": "SUCCESS"` and `"finished": true`, plus the full result (see Metrics).
`state: "SUCCESS"` means *judging finished*, not *accepted*.

Run results are polled at `/submissions/detail/runcode_…/check/` (without `v2`), so they are also easy to exclude.

After the final result the page also calls GraphQL `submissionDetails(submissionIdV2: $id)`, which
returns the same result data plus `code`, `timestamp` (Unix **seconds**), `lang { name verboseName }`
and `question { questionId titleSlug }`. A same-origin `fetch` to `/graphql/` worked without extra
headers. It also returns `user` fields, which Code Journal must not request.

Code Journal uses `submissionDetails(submissionId: Int!)` **only for recovery** (see below). The
query validates against the live schema (checked 2026-10-01: introspection is disabled, but
validation errors distinguish unknown fields/arguments). The fields requested are
`code timestamp lang { name } question { questionId questionFrontendId title titleSlug difficulty }`.

Problem metadata can be looked up by slug with the GraphQL `question(titleSlug)` query (verified):

```graphql
query questionTitle($titleSlug: String!) {
  question(titleSlug: $titleSlug) { questionId questionFrontendId title titleSlug difficulty }
}
```

## Source Code

Source: the `typed_code` field of the submit **request body**.

This is the only source that is *guaranteed* to be the submitted code. During the investigation the
Monaco model was replaced with `model.setValue(...)` and Submit was clicked immediately. LeetCode
submitted the **previous** code, because it syncs its own copy of the code from the editor with a
delay. So Monaco can be out of sync with what is submitted, and the editor must not be used as the
code source.

Secondary source: GraphQL `submissionDetails.code`, which is the code LeetCode stored after the
fact (useful to reconcile or recover).

## Metrics

Source: the final `/submissions/detail/{id}/v2/check/` response. Fields observed:

| Field                                  | Example (Accepted)          | Notes                                                           |
| -------------------------------------- | --------------------------- | --------------------------------------------------------------- |
| `status_code` / `judger_status_code`   | `10`                        | Observed: 10 AC, 11 WA, 14 TLE, 15 RE, 20 CE. MLE/OLE codes **not observed** |
| `status_msg`                           | `"Accepted"`                | `"Wrong Answer"`, `"Time Limit Exceeded"`, `"Runtime Error"`, `"Compile Error"` |
| `status_runtime`                       | `"3 ms"`                    | `"N/A"` for every non-accepted result                           |
| `display_runtime`                      | `"3"`                       | Missing on Compile Error; `"0"` on WA/RE even though the runtime isn't meaningful |
| `elapsed_time`                         | `19`                        | ms of judge wall time (4008 on TLE); not the reported runtime   |
| `memory`                               | `14968000`                  | **bytes** (number); present even on WA/RE/TLE; `0` on CE        |
| `status_memory`                        | `"15 MB"`                   | `"N/A"` for non-accepted                                        |
| `runtime_percentile` / `memory_percentile` | `67.932` / `28.9961`    | `null` for non-accepted                                         |
| `total_correct` / `total_testcases`    | `65` / `65`                 | `null` on Compile Error                                         |
| `compare_result`                       | `"1111…"`                   | Per-test pass bitstring                                         |
| `lang` / `pretty_lang`                 | `"cpp"` / `"C++"`           |                                                                 |
| `question_id`                          | `"1"`                       | internal id                                                     |
| `task_finish_time`                     | `1790618031134`             | Unix **ms**, judging finished (not the submit time)             |
| `compile_error` / `full_compile_error` | —                           | Compile Error only                                              |
| `runtime_error` / `full_runtime_error` | —                           | Runtime Error only                                              |

## Failed Testcase

Source: final check response. **Exposed to the browser** for Wrong Answer, Runtime Error and Time Limit
Exceeded (observed):

| Field             | Example (WA)            |
| ----------------- | ----------------------- |
| `last_testcase`   | `"[2,7,11,15]\n9"`      |
| `input`           | `"[2,7,11,15]\n9"`      |
| `input_formatted` | `"[2,7,11,15], 9"`      |
| `expected_output` | `"[0,1]"`               |
| `code_output`     | `"[0,0]"`               |
| `std_output`      | `""` (user stdout)      |

On Accepted these fields are empty strings. On Compile Error they are absent. On TLE `code_output`
is empty and the testcase is the one being run when time ran out. Inputs are newline-separated raw
arguments. Very large testcases may be truncated by LeetCode; this was not observed here.

## Integration (implemented)

**Observe the page's own network traffic; don't scrape the DOM.**

```text
MAIN-world page script (leetcode-page.js, document_start)
  wraps window.fetch and XMLHttpRequest (platforms/shared/network-observer.ts), observes only:
    POST /problems/{slug}/submit/               → request body + response body
    GET  /submissions/detail/{numericId}/v2/check/ → response body
  never reads headers, cookies or credentials
        │ window.postMessage (channel "code-journal:leetcode")
        ▼
Isolated-world content script → LeetCodeAdapter
  validates message source/origin/shape
  parses with platforms/leetcode/parsers/*
  looks up problem metadata by slug (GraphQL question(titleSlug))
        │ SubmissionEvent (platform-independent)
        ▼
core SubmissionLifecycleTracker (content script)
  SUBMISSION_DETECTED → JUDGING → RESULT_RECEIVED → NORMALIZED → PERSISTED
        │ chrome.runtime.sendMessage(SUBMISSION_CAPTURED)
        ▼
background worker → IndexedDB (dedup by leetcode:<submission id>) → sync queue → GitHub
```

Why each piece:

- **MAIN world:** content scripts run in an isolated world and can't see the page's `fetch`.
  `chrome.webRequest` can see URLs and request bodies but **not response bodies**, and the
  submission ID and result live only in response bodies.
- **Clone before the page reads:** the wrapper must call `response.clone()` *before* the
  page gets the response. LeetCode reads the body right away, and a body that has already been
  read can't be cloned. An early build cloned one microtask too late and silently captured
  nothing on the live site; a regression test now covers this.
- **`document_start`:** the wrapper is installed before LeetCode's code runs. It was verified that
  LeetCode calls `window.fetch` each time rather than caching a reference, but installing early
  doesn't rely on that.
- **Slug from the submit URL + GraphQL lookup:** `__NEXT_DATA__` goes stale on SPA navigation, and the
  request only carries the internal id. The lookup gives `questionFrontendId`, `title` and
  `difficulty`. If it fails, the adapter uses `__NEXT_DATA__` **only if its slug matches**. Otherwise
  it reports the problem with just the fields it knows.

### Adapter boundary

The Phase 1 interface (`initialize()`, `detectSubmit()`, `getSubmission(): Promise<CodingSubmission | null>`)
assumed a pull model: "ask for the latest submission". The observed flow is push-based and
asynchronous: the ID arrives after the submit request, the result arrives several polls later, and
more than one submission can be in flight. The interface is therefore reduced to:

```ts
interface PlatformAdapter {
  readonly platform: Platform;
  canHandle(url: URL): boolean;
  start(listener: SubmissionEventListener): () => void; // returns stop()
}
```

The adapter emits platform-independent `SubmissionEvent`s:

- `SUBMISSION_STARTED` (with `submissionId` and problem)
- `SUBMISSION_JUDGING`
- `SUBMISSION_RESULT_RECEIVED`
- `SUBMISSION_CAPTURE_FAILED`

Phase 3 added `SUBMISSION_NORMALIZED` (carrying a `CodingSubmission`) and `SUBMISSION_PARSING_FAILED`
(carrying the reason and the raw result, so nothing is dropped). The core never sees LeetCode URLs
or payloads.

## Normalization (Phase 3)

`normalizeCheckResult` (`src/platforms/leetcode/parsers/result.ts`) combines the final check
response with what was captured at submit time. Fields LeetCode doesn't provide stay undefined.

| `CodingSubmission` field    | Source                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `id`                        | `submission_id` from the submit response; must match the check response's `submission_id` |
| `problem.id`                | `questionFrontendId` (displayed number) from the GraphQL lookup                          |
| `problem.title/difficulty/slug/url` | GraphQL lookup (slug from the submit URL)                                        |
| `language`                  | submit request `lang` (slug, e.g. `cpp`); falls back to check `lang`                     |
| `code`                      | submit request `typed_code`, never the editor                                            |
| `status`                    | `status_code` → status (10 AC, 11 WA, 12 MLE, 13 OLE, 14 TLE, 15 RE, 20 CE), then `status_msg`, else `unknown` |
| `submittedAt`               | local time the submit response was observed (neither response carries a submit time)  |
| `metrics.runtimeMs`         | `status_runtime` (`"3 ms"`, `"1.5 s"`); `"N/A"` → undefined. `display_runtime` is ignored |
| `metrics.memoryBytes`       | `memory` (bytes), only when `status_memory` isn't `"N/A"`                               |
| `metrics.testsPassed/Total` | `total_correct` / `total_testcases`; `null` → undefined                                |
| `metrics.failedTestCase`    | `last_testcase` (or `input`), `expected_output`, `code_output`; empty strings dropped; never for AC/CE |
| `error`                     | `full_compile_error` › `compile_error` › `full_runtime_error` › `runtime_error`          |
| `raw`                       | the entire final check response (percentiles, `pretty_lang`, `elapsed_time`, …)        |

Normalization **fails explicitly** (`SUBMISSION_PARSING_FAILED`) rather than guessing when:

- the check response is for a different submission ID;
- the submitted code wasn't captured;
- the language is unknown;
- the problem's id or title is still unavailable after one retry of the lookup.

### Stability assessment

| Dependency                                   | Stability | Reason                                                         |
| -------------------------------------------- | --------- | -------------------------------------------------------------- |
| `POST /problems/{slug}/submit/` + `submission_id` | Medium  | Long-standing, used by the site itself; undocumented            |
| `/submissions/detail/{id}/v2/check/`         | Medium-low | Already versioned (`v2`); the matcher accepts any `v{n}` or none |
| Check-response field names                   | Medium    | Parsed defensively; unknown/missing fields stay undefined       |
| GraphQL `question(titleSlug)`                | Medium    | Undocumented; fallback exists                                   |
| `__NEXT_DATA__` shape                        | Low       | Framework internals, stale on SPA navigation; fallback only     |
| `data-e2e-locator` on buttons                | Medium    | Test hooks, but not used for detection                          |
| Generated CSS class names                    | Very low  | Not used                                                        |

### Verification

The built `dist/leetcode-page.js` was injected into a live `/problems/two-sum/` tab and a real
submission was made. It forwarded the submit request (with body) and every `v2/check` poll up to
the final result. Clicking **Run** first produced no messages. The isolated-world half (adapter →
lifecycle logs) is covered by unit tests; it needs the installed extension to verify end to end.

## Known Limitations

- Everything here is undocumented and can change; parsers must reject unexpected shapes and report
  `SUBMISSION_CAPTURE_FAILED` rather than guess.
- Both `fetch` and `XMLHttpRequest` are observed. Both endpoints were observed using `fetch`; the XHR
  hook is a safeguard. A WebSocket-based result would not be seen.
- `window.postMessage` is visible to all page scripts, so a page script could forge bridge messages.
  The adapter checks `event.source`, `origin` and message shape, but can't authenticate the
  sender. This is acceptable because the only data involved is the user's own LeetCode data on
  leetcode.com. Code Journal must still treat bridge data as untrusted input.
- **Recovery:** if a final check result arrives for a submission whose submit request was not seen
  (page refreshed while judging and the page resumed polling, or the extension was reloaded), the
  adapter fetches `submissionDetails` and uses LeetCode's **stored** code, language, timestamp and
  question. That is the judged code, so the exact-code guarantee holds. If LeetCode does not poll
  again after a refresh, nothing is observed and the attempt is missed. This was not verified live
  (no signed-in session); the recovery path is unit-tested.
- After an extension reload, already-open LeetCode tabs keep the old, orphaned content script
  (Chrome behaviour). Reload those tabs; the content script logs an error if it detects this.
- MLE and OLE results were not observed; their status codes/messages are unverified.
- Only leetcode.com was investigated; leetcode.cn is out of scope.
- Contest pages (`/contest/.../problems/...`) were not investigated.
- Submission time is not in the submit or check response. `submittedAt` is the local time the
  submit response was observed, typically well under a second after the click.
- `failedTestCase.actual` is dropped when `code_output` is empty, so "printed nothing" and "not
  reported" look the same.
- `PARSING_FAILED` / `CAPTURE_FAILED` events are logged in the page console but not persisted:
  without code or problem identity there is nothing meaningful to commit.
- Live end-to-end submissions with the installed extension have not been re-run since the
  2026-09-28 investigation (no signed-in session on 2026-10-01). The page-side fetch observer
  was verified against the live site on 2026-09-28 (it has since moved to
  `platforms/shared/network-observer.ts` with the same logic and regression tests); everything
  after it is covered by unit tests.
