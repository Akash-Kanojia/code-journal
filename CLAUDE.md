# Code Journal

## 1. Project Overview

Build a browser extension called **Code Journal** that captures coding-problem submissions from online coding platforms and publishes a complete historical record to a user's remote Git repository.

Initial supported platforms:

- LeetCode
- GeeksforGeeks (GFG)

The architecture must be platform-independent so additional platforms such as CodeChef, Codeforces, HackerRank, etc. can be added later without modifying the core submission model.

The extension should capture **every submission**, not only successful submissions.

For every submission, capture as much information as the platform exposes:

- Platform
- Problem ID
- Problem title
- Problem URL
- Difficulty
- Programming language
- Exact submitted source code
- Submission timestamp
- Submission status
- Runtime
- Memory
- Number of tests passed
- Number of tests
- Failed testcase
- Expected output
- Actual output
- Compilation/runtime error
- Submission ID
- Any other useful submission metadata

Every submission should be preserved as a separate historical attempt.

---

# 2. Core Product Goal

The primary workflow is:

```text
User solves problem
       ↓
Clicks Submit
       ↓
Platform evaluates submission
       ↓
Code Journal detects submission
       ↓
Capture submission metadata + source code
       ↓
Normalize into CodingSubmission
       ↓
Persist locally
       ↓
Push to configured remote Git repository
```

The system must preserve failed attempts.

Example:

```text
Problem #1477

Attempt 1
Wrong Answer
17 / 21 tests

Attempt 2
Time Limit Exceeded
21 / 21 tests

Attempt 3
Accepted
21 / 21 tests
```

All three submissions must remain available.

---

# 3. Important Architectural Principle

Do NOT build the application around LeetCode-specific concepts.

The core must operate on a normalized platform-independent model.

Use:

```ts
Platform;
PlatformAdapter;
CodingSubmission;
Problem;
SubmissionMetrics;
SubmissionStatus;
```

LeetCode and GFG should be adapters implementing the same interface.

Future platforms should be addable by implementing another adapter.

---

# 4. Recommended Technology

Use:

- TypeScript
- Chrome Extension Manifest V3
- Vite
- Vitest
- ESLint
- Prettier

Use React only for the extension UI/settings popup.

Do not introduce a backend initially.

The architecture should be:

```text
Browser Extension
       │
       ├── Content scripts
       │
       ├── Background service worker
       │
       ├── Platform adapters
       │
       ├── Local storage
       │
       └── Git provider integration
```

---

# 5. High-Level Architecture

```text
                        Browser
                           │
                           ▼
                 ┌───────────────────┐
                 │ Content Script     │
                 │                   │
                 │ Detect submission │
                 │ Read page state   │
                 └─────────┬─────────┘
                           │
                           ▼
                 ┌───────────────────┐
                 │ Platform Adapter  │
                 │                   │
                 │ LeetCode / GFG    │
                 └─────────┬─────────┘
                           │
                           ▼
                 ┌───────────────────┐
                 │ CodingSubmission  │
                 │                   │
                 │ normalized model  │
                 └─────────┬─────────┘
                           │
                ┌──────────┴──────────┐
                ▼                     ▼
        ┌──────────────┐      ┌──────────────┐
        │ Local Store  │      │ Git Provider │
        │              │      │              │
        │ IndexedDB    │      │ GitHub       │
        └──────────────┘      └──────────────┘
```

---

# 6. Repository Structure

Use this structure:

```text
code-journal/
│
├── src/
│   │
│   ├── core/
│   │   ├── models/
│   │   │   ├── coding-submission.ts
│   │   │   ├── problem.ts
│   │   │   └── submission-result.ts
│   │   │
│   │   ├── adapters/
│   │   │   ├── platform-adapter.ts
│   │   │   └── adapter-registry.ts
│   │   │
│   │   ├── services/
│   │   │   ├── submission-service.ts
│   │   │   └── sync-service.ts
│   │   │
│   │   └── types/
│   │
│   ├── platforms/
│   │   ├── leetcode/
│   │   │   ├── leetcode-adapter.ts
│   │   │   ├── leetcode-content.ts
│   │   │   ├── leetcode-api.ts
│   │   │   └── parsers/
│   │   │
│   │   └── gfg/
│   │       ├── gfg-adapter.ts
│   │       ├── gfg-content.ts
│   │       ├── gfg-api.ts
│   │       └── parsers/
│   │
│   ├── github/
│   │   ├── github-client.ts
│   │   ├── github-auth.ts
│   │   └── github-repository.ts
│   │
│   ├── storage/
│   │   ├── storage.ts
│   │   └── indexed-db.ts
│   │
│   ├── background/
│   │   └── index.ts
│   │
│   ├── content/
│   │   └── index.ts
│   │
│   └── popup/
│       ├── App.tsx
│       └── ...
│
├── tests/
│   ├── core/
│   ├── platforms/
│   │   ├── leetcode/
│   │   └── gfg/
│   └── github/
│
├── public/
│   └── manifest.json
│
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── eslint.config.js
├── prettier.config.js
├── CLAUDE.md
└── README.md
```

Do not create all files immediately. Create them as each feature is implemented.

---

# 7. Core Data Model

Create a normalized model similar to:

```ts
type Platform = 'leetcode' | 'gfg';

type SubmissionStatus =
  | 'accepted'
  | 'wrong_answer'
  | 'time_limit_exceeded'
  | 'memory_limit_exceeded'
  | 'compile_error'
  | 'runtime_error'
  | 'runtime_error'
  | 'output_limit_exceeded'
  | 'unknown';

interface Problem {
  id: string;
  title: string;
  url: string;
  platform: Platform;
  difficulty?: string;
  slug?: string;
}

interface TestCaseResult {
  input?: string;
  expected?: string;
  actual?: string;
}

interface SubmissionMetrics {
  runtimeMs?: number;
  memoryBytes?: number;

  testsPassed?: number;
  testsTotal?: number;

  failedTestCase?: TestCaseResult;
}

interface CodingSubmission {
  id: string;

  platform: Platform;

  problem: Problem;

  language: string;

  code: string;

  status: SubmissionStatus;

  submittedAt: string;

  metrics: SubmissionMetrics;

  error?: string;

  raw?: unknown;
}
```

Do not assume a field exists on a platform.

If information cannot be obtained, leave it undefined.

Never fabricate data.

The `raw` field may contain platform-specific information useful for debugging.

---

# 8. Platform Adapter Interface

Create a generic interface.

For example:

```ts
interface PlatformAdapter {
  readonly platform: Platform;

  canHandle(url: string): boolean;

  initialize(): void;

  detectSubmit(): void;

  getSubmission(): Promise<CodingSubmission | null>;
}
```

The exact interface can be improved during implementation.

The important requirement is that core services should not know whether the submission came from LeetCode or GFG.

---

# 9. Submission Lifecycle

Model the lifecycle explicitly.

```text
IDLE
  ↓
SUBMIT_CLICKED
  ↓
SUBMISSION_DETECTED
  ↓
JUDGING
  ↓
RESULT_RECEIVED
  ↓
NORMALIZED
  ↓
STORED
  ↓
SYNCED
```

Potential failures:

```text
SUBMISSION_DETECTED
       ↓
CAPTURE_FAILED

RESULT_RECEIVED
       ↓
PARSING_FAILED

SYNCED
       ↓
GITHUB_SYNC_FAILED
```

A failed GitHub sync must not lose the submission.

---

# 10. LeetCode Adapter

Implement LeetCode first.

The adapter must:

1. Detect a submission attempt.
2. Identify the problem.
3. Capture the submitted source code.
4. Identify the submission ID if available.
5. Detect the judging state.
6. Detect the final result.
7. Capture metrics.
8. Capture failed testcase information where available.
9. Convert everything into `CodingSubmission`.

Do not rely exclusively on DOM selectors.

Prefer platform network/API data when available and reliable.

Use DOM observation as a fallback where appropriate.

Avoid brittle selectors tied to generated CSS class names.

Prefer:

- semantic attributes
- stable DOM structures
- URL
- GraphQL/API requests
- browser network observation where possible
- text/ARIA attributes only when necessary

Do not assume undocumented APIs are stable.

Isolate platform-specific API parsing inside:

```text
platforms/leetcode/leetcode-api.ts
platforms/leetcode/parsers/
```

---

# 11. Submission Detection

The extension must detect the user's Submit action.

Do not simply search for:

```ts
button.innerText === 'Submit';
```

as the final implementation.

Build a resilient submission detector.

Consider:

- DOM mutation
- event delegation
- stable attributes
- button state
- SPA navigation
- React rerenders
- multiple submit controls
- mobile/responsive UI
- page transitions

The detector should emit an internal event:

```ts
SUBMISSION_STARTED;
```

with enough context to associate the eventual result.

---

# 12. Submission ID

The submission ID should be treated as the primary identifier when available.

If the platform exposes a submission ID:

```ts
submission.id = platformSubmissionId;
```

If not, generate a deterministic/local ID using appropriate fields.

Do not use timestamps alone as the identity.

---

# 13. Exact Source Code

Capture the exact code submitted by the user.

Do not capture merely the current editor contents after judging unless it is guaranteed to be identical to the submitted code.

This matters because the user may edit the code while the submission is being evaluated.

The stored source should represent:

> The exact code associated with that submission attempt.

---

# 14. Metrics

Capture all metrics available from the platform.

Potential metrics:

```text
Runtime
Memory
Tests passed
Tests total
Failed testcase
Expected output
Actual output
Compiler error
Runtime error
```

Do not force a common representation where platforms expose different information.

Optional fields should remain optional.

---

# 15. GitHub Integration

GitHub should initially be the only remote Git provider.

Do not couple the core submission system directly to GitHub.

Create:

```ts
interface GitProvider {
    authenticate(): Promise<void>;

    getRepositories(): Promise<Repository[]>;

    createOrUpdateFile(...): Promise<void>;

    createCommit(...): Promise<void>;
}
```

GitHub will implement this interface.

This leaves room for GitLab/Bitbucket later.

---

# 16. Authentication

Use GitHub OAuth / GitHub App style authentication appropriate for a browser extension.

Do not hard-code tokens.

Do not expose access tokens to content scripts.

GitHub credentials must be handled by the background service worker.

Use the minimum required permissions/scopes.

Do not store tokens in page localStorage.

Use extension storage mechanisms appropriate for secrets.

The UI must provide:

```text
Connect GitHub
Disconnect GitHub
Connected account
Repository
Branch
Directory
```

---

# 17. GitHub Repository Layout

A submission should be stored in a deterministic structure.

Suggested structure:

```text
code-journal/
│
├── leetcode/
│   └── 1477-find-two-non-overlapping-subarrays/
│       ├── 001.js
│       ├── 002.js
│       ├── 003.js
│       └── metadata.json
│
└── gfg/
    └── some-problem/
        ├── 001.cpp
        └── metadata.json
```

Alternatively, use:

```text
submissions/
    leetcode/
    gfg/
```

Choose one consistent convention during implementation.

The directory structure must be platform-independent at the core level.

---

# 18. Submission Metadata

Each attempt should have metadata.

Example:

```json
{
  "submissionId": "123456789",
  "attempt": 3,
  "platform": "leetcode",
  "problemId": "1477",
  "title": "Find Two Non-overlapping Sub-arrays Each With Target Sum",
  "language": "javascript",
  "status": "accepted",
  "submittedAt": "2026-09-28T19:20:00Z",
  "metrics": {
    "runtimeMs": 287,
    "memoryBytes": 58400000,
    "testsPassed": 21,
    "testsTotal": 21
  }
}
```

Do not duplicate huge source code inside metadata.

Source code should remain in its own file.

---

# 19. Git Commit Strategy

Every submission should create a separate commit.

Example:

```text
LeetCode #1477 - Attempt 1 - Wrong Answer
LeetCode #1477 - Attempt 2 - Time Limit Exceeded
LeetCode #1477 - Attempt 3 - Accepted
```

This allows Git history to represent the user's actual problem-solving process.

If a push fails, queue the submission for retry.

Do not silently discard submissions.

---

# 20. Local Storage

Use IndexedDB rather than relying entirely on `chrome.storage`.

Store:

- submission records
- sync state
- GitHub configuration
- pending sync queue
- extension settings

Example:

```ts
interface SyncState {
  status: 'pending' | 'synced' | 'failed';
  attempts: number;
  lastAttemptAt?: string;
  error?: string;
}
```

The system should support:

```text
Submission captured
      ↓
Stored locally
      ↓
GitHub push
      ↓
Success → synced

Failure → pending
```

This guarantees that temporary network/GitHub failures do not lose user data.

---

# 21. Popup UI

Do not build the full UI initially.

Eventually provide:

### Dashboard

```text
Code Journal

GitHub
✓ Connected

Repository
akash/code-journal-data

Pending
2 submissions

Today
5 submissions

This week
17 submissions
```

### Settings

```text
GitHub Account
Repository
Branch
Submission directory

Auto Sync
[ON]

Capture failed testcases
[ON]
```

### Submission History

```text
#1477
Attempt 3
Accepted
287 ms
21 / 21 tests
Synced ✓
```

---

# 22. Error Handling

Errors must be explicit.

Examples:

```text
Submission capture failed
GitHub authentication expired
GitHub repository unavailable
GitHub rate limit reached
Failed to parse platform response
Network unavailable
```

Never silently swallow errors.

Provide structured logging.

Use a debug prefix:

```text
[CodeJournal]
[CodeJournal:LeetCode]
[CodeJournal:GitHub]
[CodeJournal:Storage]
```

---

# 23. Testing Strategy

Use Vitest.

Prioritize unit tests for:

### Core

- status normalization
- submission serialization
- ID generation
- path generation
- attempt numbering

### LeetCode

- problem extraction
- submission result parsing
- runtime parsing
- memory parsing
- test count parsing
- failed testcase parsing
- status mapping

### GFG

Same categories.

### GitHub

Mock GitHub API requests.

Do not make tests depend on live LeetCode/GFG pages.

Store representative HTML/API response fixtures.

---

# 24. Platform Fixtures

Create fixtures for real platform responses where legally and technically appropriate.

Example:

```text
tests/platforms/leetcode/fixtures/
├── accepted.json
├── wrong-answer.json
├── tle.json
├── compile-error.json
└── runtime-error.json
```

Tests should verify that all fixtures normalize into the expected `CodingSubmission`.

---

# 25. Important Security Requirements

Never:

- expose GitHub tokens to content scripts
- send GitHub tokens to LeetCode/GFG
- store tokens in page localStorage
- log tokens
- include tokens in error messages
- commit tokens to the repository

Content scripts should communicate with the background service worker through `chrome.runtime.sendMessage`.

The background worker owns authentication and GitHub operations.

---

# 26. Privacy

The extension processes source code and submission information.

Make the behavior explicit.

The user should know:

```text
Your submitted code and submission metadata
will be sent to your configured Git repository.
```

No submission data should be sent to a Code Journal-owned backend.

Initial architecture should be:

```text
User
 ↓
Browser Extension
 ↓
User's GitHub Repository
```

No Code Journal server.

---

# 27. Development Phases

Implement in the following order.

## Phase 1 — Foundation

- Project setup
- TypeScript
- Vite
- Manifest V3
- Core models
- Platform adapter interface
- Logging
- Test framework

Acceptance criteria:

```text
Extension loads successfully.
Content script executes.
Background worker executes.
Unit tests pass.
```

---

## Phase 2 — LeetCode Detection

Implement:

- LeetCode adapter
- Submit detection
- Problem extraction
- Submission lifecycle

Acceptance criteria:

```text
Click Submit
      ↓
Extension detects it
      ↓
Submission ID/result can be associated
```

---

## Phase 3 — LeetCode Submission Capture

Implement:

- submitted code
- language
- status
- runtime
- memory
- tests passed
- tests total
- failed testcase
- errors

Acceptance criteria:

A submission produces a valid:

```ts
CodingSubmission;
```

for:

- Accepted
- Wrong Answer
- TLE
- MLE
- Compile Error
- Runtime Error

where the platform exposes those values.

---

## Phase 4 — Local Persistence

Implement IndexedDB.

Acceptance criteria:

- Every submission is stored locally.
- Duplicate submissions are not accidentally created.
- Browser refresh does not lose submissions.
- Pending submissions survive extension restart.

---

## Phase 5 — GFG Adapter

Implement GFG using the same core interface.

Acceptance criteria:

```text
LeetCode → CodingSubmission
GFG      → CodingSubmission
```

without platform-specific logic leaking into core services.

---

## Phase 6 — GitHub Authentication

Implement GitHub authentication.

Acceptance criteria:

- User can connect GitHub.
- User can disconnect.
- Token is never exposed to content scripts.
- Account identity is displayed.
- Authentication errors are handled.

---

## Phase 7 — GitHub Sync

Implement:

```text
CodingSubmission
       ↓
GitHub file
       ↓
Git commit
```

Acceptance criteria:

Every captured submission can be pushed to the configured repository.

---

## Phase 8 — Retry Queue

Implement:

```text
Captured
   ↓
Local DB
   ↓
GitHub
   ↓
failure
   ↓
Pending Queue
   ↓
Retry
```

Acceptance criteria:

No submission is lost because of a temporary GitHub/network failure.

---

## Phase 9 — Popup UI

Implement:

- GitHub connection
- Repository selection
- Branch selection
- Directory configuration
- Sync status
- Submission history
- Settings

---

## Phase 10 — Additional Platforms

Only after LeetCode + GFG are stable.

Add platforms by implementing:

```ts
PlatformAdapter;
```

Do not modify the core submission pipeline.

---

# 28. Coding Standards

Use:

- strict TypeScript
- no `any` unless unavoidable
- small modules
- dependency inversion where useful
- platform-specific logic isolated under `platforms/`
- unit tests for parsers
- meaningful names
- no giant content script
- no giant background service worker

Avoid premature abstractions.

Do not build functionality that is not required by the current phase.

---

# 29. Important Implementation Rule

Before implementing platform-specific parsing, inspect the current platform behavior.

Do not assume:

- DOM structure
- API endpoint
- GraphQL schema
- response format
- CSS class names
- submission result format

First investigate the current page/network behavior.

Document findings in:

```text
docs/platforms/leetcode.md
docs/platforms/gfg.md
```

Include:

- submit detection mechanism
- submission ID source
- result source
- code source
- metrics source
- known limitations

---

# 30. Claude Code Workflow

Implement one phase at a time.

Before modifying code:

1. Inspect the repository.
2. Inspect existing architecture.
3. Identify the smallest change required.
4. Implement it.
5. Add/update tests.
6. Run tests.
7. Run TypeScript build.
8. Report what changed.
9. Do not move to the next phase automatically.

For each phase, provide:

```text
Implementation:
- files changed
- functionality added

Tests:
- tests added
- test result

Build:
- build result

Known limitations:
- ...
```

Do not rewrite unrelated code.

Do not introduce dependencies without explaining why they are necessary.

---

# 31. First Task

Start with **Phase 1 only**.

Implement:

1. Initialize the TypeScript/Vite Chrome Manifest V3 project.
2. Create the core domain models.
3. Create the `PlatformAdapter` interface.
4. Create the adapter registry.
5. Create background service worker.
6. Create generic content-script entry point.
7. Add Vitest.
8. Add ESLint/Prettier.
9. Add basic unit tests.
10. Ensure `npm run build` succeeds.
11. Ensure `npm test` succeeds.

Do NOT implement:

- GitHub OAuth
- GitHub API
- LeetCode parsing
- GFG parsing
- popup UI
- IndexedDB
- analytics

Those belong to later phases.

After Phase 1 is complete, stop and report the implementation before proceeding.
