# Code Journal — Privacy Policy

_Last updated: 2026-10-04_

Code Journal is a browser extension that records your own coding-platform submissions and saves
them to a GitHub repository **you** choose. It has no server of its own: its developer receives
no data from it.

## What the extension reads

On **leetcode.com** and **www.geeksforgeeks.org** only, when you submit a solution, the extension
reads the submission traffic that the page itself exchanges with the platform:

- the source code you submitted and its programming language;
- the problem (number, title, URL, difficulty);
- the judging result (status, runtime, memory, test counts, failing test case, error output).

It does not read other pages, other requests, cookies, or request headers.

If you choose **Import past submissions**, the extension also requests your own submission
history from LeetCode (the list of your submissions and each one's code and result) from the
leetcode.com tab where you started it, using your existing LeetCode session.

## Where data is stored

- **On your device**, in the extension's own storage (IndexedDB and extension storage): your
  captured submissions, the sync queue, your settings, and your GitHub access token. Web pages and
  other extensions cannot read this storage.

## Where data is sent

- **GitHub** (github.com, api.github.com), and only:
  - to sign you in (GitHub OAuth device flow), and
  - to write your submissions (code file + `metadata.json`) as commits to the repository and
    branch you selected.
- **The coding platform you are using** (leetcode.com / geeksforgeeks.org): the extension may
  request public problem information (title, difficulty) or, on LeetCode, your own stored copy
  of a submission, in the same way the page itself does.

Nothing is sent to the developer of Code Journal or to any other party. There is no analytics,
tracking, or advertising.

## Your control

- **Disconnect GitHub** in the extension popup deletes the access token from your device. You can
  also revoke access on GitHub: Settings → Applications → Authorized OAuth Apps.
- Removing the extension deletes all of its local data.
- Data already committed to your GitHub repository is yours and is managed in GitHub.

## Contact

Questions or issues: https://github.com/Akash-Kanojia/code-journal/issues
