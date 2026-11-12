# Verification · 0.1.2 preview · 2026-11-12

This document distinguishes local evidence from live-X compatibility. The final combined 0.1.2 run passed **104 tests, 0 failures, 0 skipped** on 2026-11-12: 70 unit tests and 34 browser tests (including the browser-suite parent test).

## Current execution boundary

The default queue still uses the X DOM adapter. A read-only profile probe obtains the numeric ID, which is durably pinned before the first click. A successful operation must survive a full profile reload with account, target ID and blocked-state checks. This is page readback, not an independent server API confirmation. The internal-API adapter is separately mock-tested and has not replaced the queue executor or acquired a production session provider.

The subscriber UI offers only private JSON / CSV backup. Public export, repository creation, upload instructions and public publishing controls have been removed. Backend rejection of public export and unrecognized upload/push commands passed tests too; hiding a button alone does not enforce that boundary. Public list maintenance uses the maintainer CLI and GitHub write permissions.

Local numeric IDs can be filled or corrected; corrections of existing IDs require review again, and known IDs cannot be cleared. Import feedback shows new, updated and duplicate counts. Private source data is not published or included in release tests.

## Completed UI checks

An isolated Chromium 148.0.7778.96 browser loaded the actual options and popup scripts with mocked extension messages and synthetic entries. All three languages navigated every panel without page errors. The probe confirmed private-only export choices, absence of publishing controls, import updated counts, exact 25-digit ID strings, rejection of clearing a known ID before sending a message, invalid-ID form rejection, corrected-ID submission, private download, an 800-pixel layout and unique DOM IDs. No external page requests occurred.

This isolated UI probe does not validate X authentication. The separate unpacked-extension integration test exercised the actual service worker, production worker-tab creation, a simulated block and reload readback, Chinese/Japanese/English, ID editing and private downloads. It used 523 synthetic pending entries, zero private-file reads and zero unexpected external requests. Manifest-linked assets, JavaScript syntax, CSP and the empty public-list schema also passed.

The 0.1.2 popup mounts the same management controller directly into a 450 × 580 view. The integration test visits all five panels in each language, checks document overflow, confirms there is no open-dashboard control or extra management tab, binds the fixture account, restores import/subscription drafts after reload, and downloads a private backup. A separate UI probe covers editor drafts, pending connection state, persisted connection failure, subscription permission gestures and repeated-click suppression. Drafts use session storage, not public repository writes.

New identity fixtures cover empty account-button text, compact navigation, misleading handles in display names, profile/avatar conflicts, another user's profile, absent login navigation, delayed page rendering, SPA account changes, and a switch immediately before confirmation. Background fixtures cover explicit tab selection, current-window fallback, invalid/non-X/incognito/worker tabs, missing-receiver recovery, navigation races, concurrent connection requests and a closed popup's response callback. The old-version marker fixture tests marker compatibility and same-version deduplication; it does not model every surviving old observer after an extension update.

Unit and content fixtures cover ID enrichment/correction/rename, persistent allowlist ID pins, legacy handle history, conflicting sources, pre-click durable pins, lost replies, final-ID changes, failed reload readback, normal/suspended/restarted worker state, oversized atomic subscription rejection and oversized legacy backup/cleanup recovery. Missing browser dependencies make the required `test:browser` command fail; CI runs that command explicitly.

The existing local Chrome installation was reloaded through its Extensions UI, which displayed version 0.1.2. On an already-open, signed-in X tab with an empty account-button text and a structured avatar handle, the actual toolbar popup connected successfully and displayed the matching account. The popup remained open and switched from Overview to Settings inside the same popup. The automatic-blocking switch remained off; no real X block or unblock was sent. This is a real local connection check, not proof of a complete live block workflow. The screenshot is kept outside the public repository to avoid publishing a user's account identifier.

## Covered categories

- Syntax, manifest-linked assets, CSP, public-list validation and dependency-free unit tests.
- Actual options/popup rendering in Chinese, Japanese and English, navigation after removal of publishing elements, private downloads, import updated feedback and numeric-ID editing/validation.
- Isolated unpacked-extension queue fixtures, reload readback, account/ID mismatches, uncertain outcomes, storage failures and worker/alarm recovery.
- Independent internal-API request/response fixtures; these cannot establish live X authorization.

See the current test-run output for completed checks. A test skipped for missing browser dependencies is not a pass. Historical 0.1.0 fixture tests and read-only inspection of a real X page are background evidence, not proof that this revised release works in every environment.

## Not established

A complete authenticated block workflow on real X across Chrome and Edge, languages, account states, browser versions and privacy settings remains unverified. No real block/unblock is performed merely to validate the documentation or UI. Local fixture success does not guarantee compatibility with X's current page or internal endpoints.

This is a developer-load preview. Browser-store acceptance and a published GitHub release are separate actions and are not established by passing tests. Private review data stays outside the repository and release package.

## Rerun

Use Node 20 or later. Run `npm run check`, `npm run validate:list` and `npm run test:unit`. For required browser fixtures run `npm ci --ignore-scripts`, `npx playwright install chromium`, and `npm run test:browser`. Alternatively set `PLAYWRIGHT_MODULE` and optionally `GAB_CHROMIUM_PATH` to an existing isolated test installation. `npm test` includes all tests, but optional browser suites can skip when invoked directly without Playwright; use the required command before release. The runtime extension has no npm dependencies.

Platform references: [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [MV3 worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [tab identity](https://developer.chrome.com/docs/extensions/reference/api/tabs), and [Playwright extension testing](https://playwright.dev/docs/chrome-extensions). Tests use the full Chromium channel for headless extension support, following the Playwright guidance.
