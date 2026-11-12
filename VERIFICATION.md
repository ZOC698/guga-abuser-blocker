# Verification · 0.2.0 preview · 2026-11-12

The complete local 0.2.0 run passed **137 tests, 0 failures, 0 skipped**: 114 unit tests, 21 content-browser tests, one unpacked-extension integration test and one real browser cookie-transport test. Syntax, linked assets, CSP, manifest permissions and the empty public-list schema also passed. These results do not establish authenticated compatibility with the current X service.

## Production execution

The service worker now uses the X web internal API. It reads only `twid` and `ct0` through Chrome's cookie API, keeps their values in request memory, and uses a packaged public web-client Bearer identifier. The browser attaches ordinary authentication cookies to requests sent to X. The provider does not read `auth_token`, write cookies or expose session values to the popup.

Connecting uses authenticated `account/settings.json`, then verifies its handle and numeric ID through `users/show.json` against the session account. Each block job must already contain a numeric target ID. A handle-only row waits as `needs_id`; the queue does not silently resolve a handle and block its current owner. The queue reads the relationship, posts `user_id` to `blocks/create.json` when necessary, and independently reads back the relationship before recording success. Account identity and target identity remain decimal strings throughout.

The old content-script block/probe/verify handlers and native-menu clicks have been removed. There is no DOM fallback and no execution tab. The content script retains handle-based content hiding, explicit reveal, account identity for optional capture, and visible blocked-list capture. Direct posts and ordinary reposts are filtered by the original author. Inner quoted authors and unlisted accounts are not guaranteed to be covered; handle changes require a current list.

## Queue and session regressions

Tests use the actual API adapter and session provider with synthetic cookies and bounded intercepted responses. They cover account changes and logout; missing permissions/cookies; authenticated identity mismatch; rejected, malformed, oversized and timed-out responses; 401/403/429/5xx and legacy error codes; target unavailability; and failed or false relationship readback. Responses never log raw server text or session credentials.

The final guard runs after the last session read and before dispatch. Pause, allowlist and approval changes in that interval prevent a POST. Write-budget reservation happens once. Cookie state and network dispatch cannot be made atomic by an extension; detected changes fail closed, and a submitted write can become uncertain.

Interrupted or uncertain jobs retain their original execution account ID and target ID, even after list replacement or account switching. Retry first reads that original relationship. A withdrawn target is not written again; absent relationships retire the old task, while a confirmed relationship records the original identity. Old-account tasks do not enter another account's execution queue.

Budgets and cooldown deadlines survive worker restart, reconnect and popup closure. The local policy is at least 30 seconds between jobs, at most 30 reserved writes per 15 minutes, and a 2-minute batch pause after each 10 reserved writes. These are local limits, not a claim about X's actual quota. HTTP 429 honors future Retry-After/reset deadlines with a conservative fallback. Authentication failures disable automatic execution and require reconnection. A failed or uncertain write is never blindly repeated. Legacy 0.1.x bindings require a new verified connection; in-flight legacy jobs become uncertain immediately.

## Browser evidence

The unpacked production extension runs in an isolated Chromium profile with 523 synthetic pending rows and synthetic X cookies. Its service worker performs authenticated-settings/identity reads, a numeric-ID block request and relationship readback through the real production code. X responses are intercepted; no live X requests or private-file reads occur. The test confirms zero execution tabs, no native-menu dependency, private-only exports, all five popup panels in Chinese/Japanese/English, numeric-ID editing and draft recovery. Request interception occurs before some browser Cookie processing, so it is not treated as wire-level cookie evidence.

A separate loopback HTTP test runs a minimal temporary MV3 extension without the cookies permission. A local server seeds synthetic HttpOnly Lax and Strict cookies, then observes the actual POSTs: credentials=include carries both and credentials=omit carries neither. The same assertions pass after closing and restarting the persistent browser profile without reseeding. The measured launches do not disable ThirdPartyStoragePartitioning. Non-loopback proxy requests are rejected locally. This proves the measured Chromium transport behavior, not Secure/None cookie behavior, every browser privacy configuration or real X acceptance.

A separate UI fixture covers the old-handle reconnection notice, numeric-account history scoping, all four cooldown reasons, needs_id editing, invalid-session controls, exact 25-digit IDs and 450 × 580 layout in all three languages, with zero page errors or extra management windows.

## Remaining release gates

The attempt to update and inspect the existing Chrome installation stopped before reload: the browser-control tool could not confidently identify the current browser URL and ended control. Therefore 0.2.0 is **not verified as reloaded in that installation**, and no live API connection, real block or unblock was executed during this migration. The earlier 0.1.2 DOM connection check is not API evidence.

Authenticated real-X acceptance of these internal routes, controlled-account block/readback testing, Edge-specific behavior, restrictive cookie policies and browser-store acceptance remain unverified. X can change these routes or their required headers. The public subscription list is currently empty; no claim is made that it already protects viewers from unreviewed accounts. New/unlisted accounts, quoted or reuploaded content can evade a list-based tool.

This is a developer-load preview, not a broadly validated release. Private review data stays outside the repository and package. Public subscriptions remain read-only: no PAT, upload, public export or candidate-submission command exists.

## Rerun

Use Node 20 or later. Run `npm run check`, `npm run validate:list` and `npm run test:unit`. Install the pinned test dependency with `npm ci --ignore-scripts`, install Chromium using `npx playwright install chromium`, then run the mandatory `npm run test:browser`. An existing isolated test installation can be selected with `PLAYWRIGHT_MODULE` and `GAB_CHROMIUM_PATH`. The required browser command fails when dependencies are missing; a skipped test is not a pass. Normal extension users do not need Node, Codex or a terminal.

Platform references: [Chrome network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [cookies API](https://developer.chrome.com/docs/extensions/reference/api/cookies), [storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies), [MV3 worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), and [Playwright extension testing](https://playwright.dev/docs/chrome-extensions).
