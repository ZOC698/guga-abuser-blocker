# Verification · 0.1.0 · 2026-11-12

Final combined test run: **25 passed, 0 failed, 0 skipped**. Manifest files, script syntax, linked assets and extension CSP checks passed.

Repository preparation added seven public-list pipeline tests. The updated dependency-free suite passed **21/21** (14 existing plus seven new). Building from the private review worklist produced zero public entries, as intended; public schema validation passed without numeric IDs.

Verified in an isolated Chromium instance with the actual unpacked Manifest V3 extension loaded:

- Import the supplied 523-entry file; all 523 remain pending and the public export is empty.
- Switch Chinese, Japanese and English; search, select, approve, edit reason/evidence and download a private export.
- Bind the simulated signed-in account, enable auto-blocking, execute one approved fixture account through the persisted queue, observe the simulated blocked UI, save its numeric ID, pause and reload.
- Open the popup and check the 800-pixel layout for horizontal overflow. No page errors occurred.

Unit/browser fixtures additionally cover subscription replacement and failed refresh retention, account and ID mismatches, conflicting source IDs, interrupted/cancelled actions, allowlist precedence, capture-session isolation, biography mentions, recycled DOM nodes, CSV escaping, input validation, source privacy boundaries and queue-cap preservation.

Real X was inspected read-only in the user's existing Chrome session: the signed-in account control, profile header, actions menu selector and numeric-ID unblock button were observed. The current blocked-account cards do not expose numeric IDs on their nested Blocked buttons, so collection may return handles only. No actual X block/unblock was executed. Full live authenticated blocking remains unverified; fixture success does not guarantee compatibility with every current X layout or language.

The extension is a developer-load preview release, with no browser-store listing. It has not been installed into the user's everyday browser. Source code and the public subscription file are maintained at [ZOC698/guga-abuser-blocker](https://github.com/ZOC698/guga-abuser-blocker). The private review data is outside the repository and excluded from the release ZIP.

To rerun: Node 20+, `npm test` for unit tests; install a development-only `playwright` package or set `PLAYWRIGHT_MODULE`, and optionally `GAB_CHROMIUM_PATH`, for the browser tests. Browser test suites explicitly skip when Playwright is unavailable. Run `npm run check` for the package checks. The runtime extension itself has no npm dependencies.
