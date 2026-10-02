GeeksforGeeks fixtures (see `docs/platforms/gfg.md`).

- `problem-response.json` and `next-data.json`: trimmed from real responses observed on
  2026-10-01 (`GET practiceapi.geeksforgeeks.org/api/latest/problems/key-pair5616/` and the
  page's `__NEXT_DATA__`).
- Everything else is **reconstructed**, not captured: submitting on GFG requires a signed-in
  account, which was not available during the investigation. Field names and value sets
  (`status`, `view_mode`, `message.*`, `view_cases.*`, `results.submission_id`, …) are the
  ones GFG's own client code reads when rendering a result; the values are made up.
