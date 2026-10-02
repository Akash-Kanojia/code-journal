# Code Journal

A Chrome extension (Manifest V3) that automatically captures coding submissions from supported
coding platforms and keeps them in **your own GitHub repository**: every attempt, accepted or
not, as its own file and its own commit.

There is no Code Journal server. The extension talks only to the coding platform (as the page
already does) and to the GitHub repository you choose.

## Supported platforms

| Platform      | Status                                                                        |
| ------------- | ----------------------------------------------------------------------------- |
| LeetCode      | Supported (leetcode.com)                                                      |
| GeeksforGeeks | Supported (www.geeksforgeeks.org). See the limitation in [docs/platforms/gfg.md](docs/platforms/gfg.md) |
| CodeChef, Codeforces, HackerRank, … | Not implemented. The adapter architecture is ready for them |

## Features

- **Captures every attempt**: Accepted, Wrong Answer, TLE, MLE, Compile Error, Runtime Error, …
- **Exact submitted code**, taken from the submit request itself and never from the editor afterwards.
- Problem, language, status, runtime, memory, test counts, failing testcase and error output,
  when the platform exposes them. Missing data stays missing; nothing is made up.
- **Local first**: each submission is stored in IndexedDB before any network sync, so a GitHub
  outage or a browser restart never loses an attempt.
- **GitHub sync**: one submission = one commit, written directly through the GitHub API.
- **Retry queue** with exponential backoff, rate-limit awareness and a manual "Retry failed".
- **Duplicate protection**: repeated polls, re-renders or a crash mid-sync never create a second
  file or commit for the same attempt.
- **Popup** with connection status, repository/branch/directory settings, sync counts and recent
  submissions.
- **Platform adapters**: LeetCode and GFG specifics are isolated under `src/platforms/`.

## How it works

```text
Coding platform page
  └─ MAIN-world page script     wraps fetch/XHR, forwards only submission endpoints' bodies
       └─ content script        platform adapter → normalized CodingSubmission
            └─ background worker
                 ├─ IndexedDB      submissions + sync queue (source of truth, dedup)
                 └─ GitHub API     tree → commit → fast-forward ref, one commit per attempt
```

- Content scripts never see GitHub credentials. They can send exactly one message type
  (`SUBMISSION_CAPTURED`), which the worker validates.
- The GitHub token lives in the extension's own IndexedDB. Web pages and content scripts cannot
  read it. It is never logged.
- Platform details: [docs/platforms/leetcode.md](docs/platforms/leetcode.md),
  [docs/platforms/gfg.md](docs/platforms/gfg.md).

## Development

Requires Node.js 20+ (developed with Node 24).

```bash
npm install
npm run build          # typecheck + bundle everything into dist/
npm run typecheck
npm test
npm run lint
npm run format:check   # npm run format to fix
```

To bake a GitHub OAuth client id into the build (optional, see below):

```bash
GITHUB_CLIENT_ID=Ov23liXXXXXXXXXXXXXX npm run build
```

## Chrome installation

1. `npm run build`
2. Open `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the `dist/` directory

After rebuilding, click the reload icon on the extension's card and **reload any open
LeetCode/GFG tabs**. Chrome does not re-inject content scripts into tabs that were already open.

## Firefox installation

Firefox 140+ (desktop). The bundles are the same as Chrome's; only the manifest differs. Firefox runs
the background as an event page and needs an add-on id.

1. `npm run build:firefox` (or `GITHUB_CLIENT_ID=… npm run build:firefox`). This writes `dist-firefox/`.
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on…** and select `dist-firefox/manifest.json`
4. Open `about:addons` → Code Journal → **Permissions** and make sure access to leetcode.com,
   geeksforgeeks.org, github.com and api.github.com is allowed. Firefox may leave MV3 host
   permissions for the user to grant.
5. Reload any open LeetCode/GFG tabs.

Temporary add-ons are removed when Firefox quits. For a permanent install, either sign it as an
unlisted add-on (`npx web-ext sign -s dist-firefox --channel unlisted` with AMO API keys) and
install the `.xpi`, or use Firefox Developer Edition/Nightly with `xpinstall.signatures.required`
set to `false` in `about:config`. Background logs: `about:debugging` → Code Journal → **Inspect**.

## GitHub setup

Code Journal uses the **GitHub OAuth Device Flow** with your own GitHub OAuth App.

Why not the usual redirect flow? Exchanging a redirect code for a token needs the OAuth App's
*client secret*, and an extension cannot keep a secret: anything in the bundle is public.
Without a backend, the device flow is the standard secret-free OAuth option. It needs only the
public client id. You approve access on github.com, and no Personal Access Token is pasted
anywhere.

### 1. Create an OAuth App (once)

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
   (<https://github.com/settings/applications/new>).
2. Application name: `Code Journal` (anything).
3. Homepage URL: any URL, e.g. your fork's repository URL.
4. Authorization callback URL: required by the form but unused by the device flow, e.g. `https://github.com`.
5. Click **Register application**.
6. Check **Enable Device Flow** and save.
7. Copy the **Client ID**. You do not need a client secret.

### 2. Give the client id to the extension

Either build with `GITHUB_CLIENT_ID=<client id> npm run build`, or paste it into the popup under
**OAuth App client id**. The popup opens that field automatically when no id was built in.

### 3. Connect

1. Click the extension icon → (optionally untick **Allow private repositories**) → **Connect GitHub**.
2. A github.com tab opens. Enter the code shown in the popup and approve.
3. The popup shows **Connected as &lt;you&gt;**. You can close the popup during this; the
   background worker finishes the authorization.

Scopes: `repo` when private repositories are allowed (GitHub has no narrower OAuth scope that can
write private repositories), otherwise `public_repo`.

### 4. Choose where to write

1. Create a repository on GitHub if you do not have one (it may be empty).
2. In the popup pick the **Repository** and **Branch**, optionally a **Directory** (empty = the
   repository root), and click **Save**.

Submissions captured before this step wait in the local queue and sync once a repository is set.

**Disconnect GitHub** deletes the token from the extension. To revoke the grant on GitHub too, go to
Settings → Applications → Authorized OAuth Apps.

## Repository structure

```text
<directory>/
├── leetcode/
│   └── 1477-find-two-non-overlapping-sub-arrays-each-with-target-sum/
│       ├── 001.js
│       ├── 002.js
│       ├── 003.js
│       └── metadata.json
└── gfg/
    └── key-pair5616/
        ├── 001.cpp
        └── metadata.json
```

- LeetCode directories are `<problem number>-<slug>`. GFG directories use the problem's URL slug.
- Files are numbered in submission order. Extensions come from a central language table in
  `src/core/languages.ts`; unknown languages get `.txt`.
- An empty repository first gets a `README.md` ("Initialize Code Journal" commit), because GitHub's
  Git Data API cannot commit to a repository with no commits.

Git history, one commit per attempt:

```text
LeetCode #1477 - Attempt 3 - Accepted
LeetCode #1477 - Attempt 2 - Time Limit Exceeded
LeetCode #1477 - Attempt 1 - Wrong Answer
GFG - Two Sum - Pair with Given Sum - Attempt 1 - Wrong Answer
```

`metadata.json` describes the problem and every attempt, readable without the extension:

```json
{
  "version": 1,
  "platform": "leetcode",
  "problem": {
    "id": "1477",
    "title": "Find Two Non-overlapping Sub-arrays Each With Target Sum",
    "url": "https://leetcode.com/problems/find-two-non-overlapping-sub-arrays-each-with-target-sum/",
    "slug": "find-two-non-overlapping-sub-arrays-each-with-target-sum",
    "difficulty": "Medium"
  },
  "attempts": [
    {
      "attempt": 1,
      "file": "001.js",
      "submissionId": "1000000002",
      "status": "wrong_answer",
      "statusLabel": "Wrong Answer",
      "language": "javascript",
      "languageName": "JavaScript",
      "submittedAt": "2026-09-28T19:20:00.000Z",
      "testsPassed": 17,
      "testsTotal": 21,
      "failedTestCase": { "input": "[1,1,1]\n2", "expected": "2", "actual": "-1" }
    }
  ]
}
```

Source code is never duplicated into metadata, and raw platform payloads are not committed.
Long testcases and error messages are truncated to 2,000 characters in metadata.

## Sync behaviour

- Capture → IndexedDB → GitHub. An attempt is marked **synced** only after GitHub accepts the
  branch update.
- Network errors, 5xx, rate limits, branch conflicts and permission/not-found errors are retried
  with exponential backoff (30 s, 1 min, 2 min, … capped at 1 h; GitHub's rate-limit reset time is
  honoured). After 10 failed retries, or on a request GitHub rejects as invalid, the attempt is
  marked **failed** until you click **Retry failed**.
- Attempts are committed strictly in submission order, so attempt numbers match the order you
  submitted.
- If GitHub rejects the token (revoked or expired), sync pauses without using up retries, and the
  popup asks you to reconnect.
- Retries use `chrome.alarms` (and a 15-minute safety alarm), so they survive the service worker
  stopping and browser restarts. Attempts interrupted mid-sync are re-queued when the worker
  starts. Before committing, the worker checks `metadata.json` for the submission id, so an attempt
  is never committed twice.

## Privacy and security

- Submitted code and submission metadata are sent **only** to your selected GitHub repository.
- Permissions: `storage`, `alarms`; host access only to `github.com` (device flow) and
  `api.github.com`. Content scripts run only on `leetcode.com` and `www.geeksforgeeks.org`.
- Page scripts forward only URL, method, status and bodies of the submission endpoints. They never
  forward headers or cookies.
- Logs never contain source code, tokens, cookies or auth headers.

## Troubleshooting

| Symptom | What to check |
| ------- | ------------- |
| Nothing is captured | Reload the LeetCode/GFG tab after installing or reloading the extension. In the page console, filter `CodeJournal`; you should see `Adapter started`. |
| "Extension was reloaded; reload the page" in the page console | The tab predates the extension reload. Reload the tab. |
| `Submission parsing failed` in the page console | The platform response changed, or the problem lookup failed. The reason is logged. Please file it with a sanitized response. |
| "Set a GitHub OAuth App client id first" | Paste your OAuth App client id in the popup or rebuild with `GITHUB_CLIENT_ID`. |
| "Device Flow is not enabled for this GitHub OAuth App" | Enable Device Flow in the OAuth App settings. |
| Repository missing from the list | Only repositories you can push to are listed. Private ones need "Allow private repositories" (reconnect after changing it). For organization repositories, the org may need to approve the OAuth App. |
| Pending count never goes down | Check that a repository and branch are saved and GitHub is connected. Then check the service worker console: `chrome://extensions` → Code Journal → *Inspect views: service worker*, filter `CodeJournal:sync`. |
| Failed submissions | Hover the item in the popup to see the error. Fix the cause (permissions, branch), then **Retry failed**. |

## Known limitations

- Platform integrations rely on undocumented, observed platform behaviour and can break when
  LeetCode or GFG change their APIs.
- **GFG was implemented from GFG's client code, without a real signed-in submission** (no account
  was available). LeetCode parsers are based on real captured responses.
- GFG exposes no memory figure, and its runtime is reported only for accepted solutions.
- If a page is refreshed while judging, LeetCode attempts are recovered from LeetCode's stored copy
  when the page reports the result. GFG attempts cannot be recovered.
- leetcode.cn, contest pages and GFG contest/batch flows were not investigated.
- Chrome 120+ and Firefox 140+ (desktop). The Firefox build passes `web-ext lint` but has not been exercised in Firefox yet.

## Project layout

```text
src/
  core/         platform-independent models, journal layout, sync + journal services, logger
  platforms/    shared/ (network observer, bridge), leetcode/, gfg/ — all platform specifics
  storage/      SubmissionStore / SecretStore interfaces + IndexedDB implementation
  github/       REST client, device-flow auth, GitProvider implementation
  background/   service worker: messaging, settings, alarms, wiring
  content/      content-script entry: picks the adapter, delivers submissions
  popup/        popup UI (plain TypeScript + DOM)
public/         manifest.json, popup.html, popup.css
tests/          Vitest suites with fixtures and an in-memory fake GitHub API
docs/platforms/ platform investigation notes
```

To add a platform: implement `PlatformAdapter` under `src/platforms/<name>/`, add the platform
to `PLATFORMS` and `PLATFORM_INFO`, register the adapter in `src/content/adapters.ts`, and add its
page script and match patterns to `vite.config.ts`, `package.json` and `public/manifest.json`.
