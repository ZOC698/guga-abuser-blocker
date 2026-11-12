# Verification · 0.2.1 · 2026-11-12

The complete local `npm test` run passed **152 tests, 0 failures, 0 skipped**: 129 unit tests, 21 content-browser tests, one unpacked-extension integration test and one real browser cookie-transport test.

The installed 0.2.1 extension also successfully connected to the signed-in X account in the existing real Chrome profile using the authenticated Viewer query. All 523 original private records were imported locally with exact numeric ID strings and retained `pending` review status. The public list remains empty. No real block or unblock was executed. The live connection and private import evidence is separate from the synthetic execution tests below.

## Production execution

The service worker now uses the X web internal API. It reads only `twid` and `ct0` through Chrome's cookie API, keeps their values in request memory, and uses a packaged public web-client Bearer identifier. The browser attaches ordinary authentication cookies to requests sent to X. The provider does not read `auth_token`, write cookies or expose session values to the popup.

Connecting makes one fixed GraphQL `Viewer` request to `x.com`. Only `data.viewer.user_results.result` can identify the authenticated server-side user: it must be a `User` with a valid handle and a `rest_id` exactly matching the numeric account identity read from the current session. The adapter checks the session before the request and again after the response. It does not substitute a requested target profile, search other response fields for an account, or fall back to another connection route.

The packaged read operations are `Viewer`, `UserByScreenName` and `UserByRestId`, with fixed query IDs, parameter schemas, feature flags and field toggles. User results support the modern `core.screen_name` and `relationship_perspectives.blocking` fields as well as the older `legacy` shape. Conflicting identities, handles or relationship fields are rejected; a relationship read requires an explicit boolean blocking value. Query metadata is bundled with the extension, not downloaded as executable code.

Each block job must already contain a numeric target ID. A handle-only row waits as `needs_id`; the queue does not silently resolve a handle and block its current owner. `UserByScreenName` remains a read-only lookup capability. Execution reads the target relationship with `UserByRestId`, posts `user_id` to the unchanged `blocks/create.json` endpoint when necessary, and independently repeats `UserByRestId` before recording success. Account identity and target identity remain decimal strings throughout.

The old content-script block/probe/verify handlers and native-menu clicks have been removed. There is no DOM fallback and no execution tab. The content script retains handle-based content hiding, explicit reveal, account identity for optional capture, and visible blocked-list capture. Direct posts and ordinary reposts are filtered by the original author. Inner quoted authors and unlisted accounts are not guaranteed to be covered; handle changes require a current list.

## Queue and session regressions

Tests use the actual API adapter and session provider with synthetic cookies and bounded intercepted responses. They cover account changes and logout; missing permissions/cookies; authenticated Viewer identity mismatch and incorrect response envelopes; rejected, malformed, oversized and timed-out responses; 401/403/404/429/5xx and legacy error codes; target unavailability; and failed or false relationship readback. Safe diagnostics retain HTTP status, bounded numeric X error codes and an allowlisted route label. They do not expose raw server text, request query strings or session credentials. Connection failures persist in the popup state and leave execution paused; reopening the popup or restarting the worker does not blindly retry a failed binding.

The final guard runs after the last session read and before dispatch. Pause, allowlist and approval changes in that interval prevent a POST. Write-budget reservation happens once. Cookie state and network dispatch cannot be made atomic by an extension; detected changes fail closed, and a submitted write can become uncertain.

Interrupted or uncertain jobs retain their original execution account ID and target ID, even after list replacement or account switching. Retry first reads that original relationship. A withdrawn target is not written again; absent relationships retire the old task, while a confirmed relationship records the original identity. Old-account tasks do not enter another account's execution queue.

Budgets and cooldown deadlines survive worker restart, reconnect and popup closure. The local policy is at least 30 seconds between jobs, at most 30 reserved writes per 15 minutes, and a 2-minute batch pause after each 10 reserved writes. These are local limits, not a claim about X's actual quota. HTTP 429 honors future Retry-After/reset deadlines with a conservative fallback. Authentication failures disable automatic execution and require reconnection. A failed or uncertain write is never blindly repeated. Legacy 0.1.x bindings require a new verified connection; in-flight legacy jobs become uncertain immediately.

## Browser evidence

The unpacked production extension runs in an isolated Chromium profile with 523 synthetic pending rows and synthetic X cookies. Its service worker follows the exact sequence `Viewer → UserByRestId → blocks/create.json → UserByRestId` through the real production code. The test asserts fixed routes and origins, Viewer parameters, numeric target variables, one POST and independent relationship readback. The mocked user responses use the modern shape without `legacy`. X responses are intercepted; no live X requests or private-file reads occur in this test. It also confirms zero execution tabs, no native-menu dependency, private-only exports, all five popup panels in Chinese/Japanese/English, numeric-ID editing and draft recovery. Request interception occurs before some browser Cookie processing, so it is not treated as wire-level cookie evidence.

A separate loopback HTTP test runs a minimal temporary MV3 extension without the cookies permission. A local server seeds synthetic HttpOnly Lax and Strict cookies, then observes the actual POSTs: credentials=include carries both and credentials=omit carries neither. The same assertions pass after closing and restarting the persistent browser profile without reseeding. The measured launches do not disable ThirdPartyStoragePartitioning. Non-loopback proxy requests are rejected locally. This proves the measured Chromium transport behavior, not Secure/None cookie behavior, every browser privacy configuration or real X acceptance.

A separate UI fixture covers the old-handle reconnection notice, numeric-account history scoping, all four cooldown reasons, needs_id editing, invalid-session controls, exact 25-digit IDs and 450 × 580 layout in all three languages, with zero page errors or extra management windows.

## Live evidence and remaining release gates

The installed real Chrome 0.2.1 popup displayed the connected account after successful Viewer verification. The private local library contains the original 523 records with numeric IDs preserved as strings and all records still pending review. Neither this connection nor the ID import approved those records, published them, or performed a real block or unblock. Account names and private entries are intentionally omitted from this public report.

A controlled real-X POST followed by authenticated relationship readback remains unverified. Edge-specific behavior, other cookie policies and stores, and browser-store acceptance also remain unverified. The successful connection establishes behavior in the tested Chrome profile; it does not establish compatibility with every user's environment. The fixed GraphQL query IDs and metadata reflect the observed X web client at this date and may require an extension update when X changes them. These private web routes are not a stable developer API contract.

This remains a developer-load distribution with limited live validation. The public subscription list is empty; there is no claim that it already protects viewers from the private, unreviewed records. New or unlisted accounts, quoted content and reuploads can evade a list-based tool. Private review data stays outside the repository and package. Public subscriptions remain read-only: no PAT, upload, public export or candidate-submission command exists.

## Rerun

These commands are for maintainers. Use Node 20 or later. Run `npm run check`, `npm run validate:list` and `npm run test:unit`. Install the pinned test dependency with `npm ci --ignore-scripts`, install Chromium using `npx playwright install chromium`, then run the mandatory `npm run test:browser`. Run `npm test` with browser dependencies available for the combined suite. An existing isolated test installation can be selected with `PLAYWRIGHT_MODULE` and `GAB_CHROMIUM_PATH`. The required browser command fails when dependencies are missing; a skipped test is not a pass. Normal extension users do not need Node, Codex or a terminal.

Platform references: [Chrome network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [cookies API](https://developer.chrome.com/docs/extensions/reference/api/cookies), [storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies), [MV3 worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), and [Playwright extension testing](https://playwright.dev/docs/chrome-extensions).
