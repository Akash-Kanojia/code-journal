Responses observed on leetcode.com on 2026-09-28 (see `docs/platforms/leetcode.md`).
Submission IDs are replaced with fake values; no user data, headers or cookies are included.
`next-data.json` is a trimmed subset of the page's `__NEXT_DATA__`.

Synthesized (not captured live), shaped after the observed responses:

- `check-memory-limit-exceeded.json`: MLE was not observed; status code 12 is unverified.
- `check-unknown-status.json`: an unrecognised status code/message, with most fields missing.
- `submission-details.json`: the `submissionDetails` GraphQL response. The query and field
  names were validated against leetcode.com's schema on 2026-10-01; the values are made up.

History import (`history-*.json`) is **synthesized**: the GraphQL queries and field names
(`submissionList`, `submissionDetails` with `statusCode`, `runtimeDisplay`, `totalCorrect`, …) were
validated against leetcode.com's schema on 2026-10-04 while signed out, but no real values were
observed. Value formats (e.g. `timestamp` as string vs number) are therefore handled both ways.
