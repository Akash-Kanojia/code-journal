# Publishing

How to release Code Journal on **addons.mozilla.org (AMO)** and the **Chrome Web Store**.
Everything below the "Listing text" heading can be pasted into the store forms.

## 0. Once: prerequisites

1. **OAuth App owned by you.** Published builds embed your OAuth App's client id, so users only
   click "Connect GitHub". Use an **OAuth App** (client id `Ov23…`), not a GitHub App: GitHub App
   user tokens expire after 8 hours. In the app settings, enable **Device Flow**. Client ids are
   public; never ship the client secret, which is not needed.
2. **Firefox**: a Firefox account and AMO API credentials at
   <https://addons.mozilla.org/developers/addon/api/key/>.
3. **Chrome**: a Chrome Web Store developer account (one-time US$5) at
   <https://chrome.google.com/webstore/devconsole>.

Add-on id (Firefox): `code-journal@akash-kanojia`, set in `scripts/build-firefox.js`.
**Never change it after the first upload**: AMO ties the listing and updates to it.

## 1. Every release

1. Bump `"version"` in **both** `public/manifest.json` and `package.json` (stores reject a version
   they have seen; the packaging script refuses mismatched versions).
2. Run the checks and commit:
   ```bash
   npm test && npm run typecheck && npm run lint && npm run format:check
   git commit -am "Release x.y.z" && git push
   ```
3. Build the artifacts (written to `artifacts/`):
   ```bash
   export GITHUB_CLIENT_ID=Ov23…           # your OAuth App client id
   npm run package:source                  # source archive of the committed HEAD
   npm run package:firefox                 # code-journal-firefox-x.y.z.zip
   npm run package:chrome                  # code-journal-chrome-x.y.z.zip
   ```

### Firefox: self-distributed (unlisted)

Signed by Mozilla, installed from a file, not searchable on AMO:

```bash
export WEB_EXT_API_KEY=user:12345:67      # AMO "JWT issuer"
export WEB_EXT_API_SECRET=…               # AMO "JWT secret"
npm run sign:firefox
```

Then drag `artifacts/*.xpi` onto a Firefox window. Firefox keeps it installed across restarts.

### Firefox: public listing

1. <https://addons.mozilla.org/developers/addon/submit/distribution> → **On this site**.
2. Upload `artifacts/code-journal-firefox-x.y.z.zip`.
3. "Do you need to submit source code?" → **Yes**; upload
   `artifacts/code-journal-source-x.y.z.zip` and paste the reviewer notes below.
4. Fill the listing (text below), choose the **MIT** license, add a screenshot, and set the privacy
   policy to the contents of [`PRIVACY.md`](../PRIVACY.md).

Updates: upload a new version on the add-on's AMO page (same steps 2–3).

### Chrome Web Store

1. Developer console → **New item** → upload `artifacts/code-journal-chrome-x.y.z.zip`.
2. **Store listing**: text below, icon `public/icons/icon-128.png`, at least one 1280×800 screenshot.
3. **Privacy practices**: single purpose, permission justifications and data usage below; privacy
   policy URL: `https://github.com/Akash-Kanojia/code-journal/blob/main/PRIVACY.md`.
4. Submit for review.

## Screenshots (manual)

Stores need at least one; they can't be generated without a signed-in session. Suggested:
the popup connected with a repository selected and a few recent submissions; a GitHub repository
showing `leetcode/<problem>/001.*`, `002.*`, `metadata.json`; the commit history
("LeetCode #1477 - Attempt 1 - Wrong Answer" …). Chrome wants 1280×800 or 640×400 PNG/JPEG.

---

## Listing text

**Name:** Code Journal

**Summary (≤ 132 characters):**
Automatically saves every LeetCode and GeeksforGeeks submission — accepted or not — to your own GitHub repository.

**Description:**

> Code Journal keeps a complete history of your coding practice in a GitHub repository you own.
>
> Every time you submit a solution on LeetCode or GeeksforGeeks, Code Journal records the exact code
> you submitted together with the result: Accepted, Wrong Answer, Time Limit Exceeded, Compile
> Error, and so on, plus runtime, memory, test counts and the failing test case when the platform
> shows them. Each attempt becomes its own file and its own commit:
>
> leetcode/1477-find-two-non-overlapping-sub-arrays-each-with-target-sum/001.js, 002.js, 003.js, metadata.json
>
> LeetCode #1477 - Attempt 1 - Wrong Answer
> LeetCode #1477 - Attempt 2 - Time Limit Exceeded
> LeetCode #1477 - Attempt 3 - Accepted
>
> • Captures failed attempts too, not just accepted ones
> • Saves submissions locally first, so nothing is lost if GitHub or your network is down; failed syncs retry automatically
> • Sign in with GitHub; choose the repository, branch and folder
> • No Code Journal server, no tracking: your code goes only to your repository
>
> Open source: https://github.com/Akash-Kanojia/code-journal

**Category:** Firefox: **Web Development**. Chrome: **Developer Tools**.

**Support / homepage:** https://github.com/Akash-Kanojia/code-journal

## Notes for reviewers (AMO source-code submission)

> The extension is written in TypeScript and bundled with Vite (not minified).
> Requirements: Node.js 20+ and npm.
>
>     npm ci
>     GITHUB_CLIENT_ID=<same id as in the submitted build> npm run build:firefox
>
> The output in dist-firefox/ matches the submitted package (source maps excluded).
> The GitHub OAuth client id is public and is injected at build time; no secret is embedded.
>
> Behaviour: on leetcode.com / www.geeksforgeeks.org, a MAIN-world script (leetcode-page.js /
> gfg-page.js) wraps fetch/XMLHttpRequest and forwards only the bodies of the platform's
> submission endpoints to the content script via window.postMessage (never headers or cookies).
> The background script stores submissions in IndexedDB and commits them to the user's chosen
> GitHub repository via api.github.com. Sign-in uses GitHub's OAuth device flow.

## Permission justifications

| Permission | Justification |
| ---------- | ------------- |
| `storage` | Stores the user's settings (selected repository, branch, folder) and the pending sign-in state. |
| `alarms` | Retries failed GitHub syncs later with backoff, and resumes pending work after the browser restarts. |
| Host `https://github.com/*` | GitHub OAuth device-flow sign-in (`/login/device/code`, `/login/oauth/access_token`). |
| Host `https://api.github.com/*` | Lists the user's repositories and branches and writes submissions as commits. |
| Content scripts on `https://leetcode.com/*` | Detects the user's submissions and reads the submitted code and result from the page's own submission requests. |
| Content scripts on `https://www.geeksforgeeks.org/*` | Same, for GeeksforGeeks. |

**Single purpose (Chrome):** Save the user's own coding-platform submissions (code and result) to a
GitHub repository the user selects.

**Remote code:** None. All code is in the package; no remotely hosted scripts are executed.

## Data declarations

- **Firefox** (`data_collection_permissions` in the generated manifest): `websiteContent`. The
  submitted code comes from the coding platform page and is transmitted to GitHub, a third party
  chosen by the user. Nothing is transmitted to the developer.
- **Chrome Web Store "Data usage"**:
  - Data collected: **Website content** (submitted source code and results) and
    **Authentication information** (the GitHub access token, stored locally and used only with GitHub).
  - Certify: not sold to third parties; not used or transferred for purposes unrelated to the
    single purpose; not used for creditworthiness or lending.
