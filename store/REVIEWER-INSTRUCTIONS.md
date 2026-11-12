# Reviewer instructions

These instructions describe the current extension and a controlled test procedure. They do not report that a reviewer test or store submission has occurred. No developer credentials, cookies, tokens or private account exports are supplied or required.

## Review without sending a block request

1. Use a separate normal Chrome profile. Incognito is not supported. Install the submitted extension and open its toolbar popup. All five management panels are inside that popup.
2. Confirm **Automatic X blocking** is off and the queue is paused before any import or connection. A fresh installation has the built-in official subscription and 523 list entries, but no automatically executing block queue.
3. Inspect Overview, Account library, Subscriptions, Activity and Settings. Switch between English, Japanese and Chinese. The starting list is packaged, so merely opening the popup does not require an initial GitHub request.
4. In Subscriptions, **Refresh now** performs a credential-free HTTPS GET of the public JSON list. With automatic blocking still off, this does not send a block request. The next automatic deadline moves to 30 days later. Reloading or restarting before that deadline should not refresh it again.
5. Optional: sign in to an X account controlled by the reviewer, then choose **Connect X session**. This performs an authenticated read to verify the active account, and stores its numeric account ID/handle locally. Connection keeps automatic blocking off and the queue paused. It does not refresh GitHub or enable blocking.
6. To inspect local import/export without any X writes, keep the global switch off. Import a small list you control, inspect its numeric-ID editor, download a private backup, then remove the test entries. Imports enable entries but do not turn on the global switch or resume a paused queue.
7. To inspect content filtering, use an X page showing an account on a locally chosen list. Matching author content can be hidden and individually revealed. This DOM change is local and does not itself block the account on X. Optional visible-list capture starts only when requested on X's blocked-account settings page.

The X session reader accesses `twid` and `ct0`; it does not directly read `auth_token`. Cookie values remain in request memory. No GitHub token, developer X key or password is entered into the extension. No private data should be placed in screenshots or a support issue.

## Optional controlled new-block test

This section deliberately changes a real X account's blocking relationship. Use only a reviewer-controlled execution account and a separate target account owned by the reviewer, or a target whose owner has expressly agreed to the test. If those prerequisites or a verified target numeric ID are unavailable, skip this test and record it as unverified.

1. Start with a fresh isolated browser profile. Keep automatic blocking **off** and the queue **paused**.
2. In Subscriptions, remove the built-in official subscription and every other subscription. Remove all local demonstration entries. Confirm the Account library is empty and the queue has no pending targets. This is essential: enabling blocking with the default subscription present would enqueue the public list rather than a single test target.
3. Sign in to the execution account on X. Independently confirm on X that this account is not currently blocking the agreed target. Obtain and verify the target's current handle and exact numeric user ID; do not guess an ID or use a person from the public list as a test target.
4. Import only that one target as a local entry. Confirm its handle and numeric ID, confirm exactly one effective enabled target, and confirm no other subscriptions or entries have appeared. The import alone must leave the global switch off and the queue paused.
5. Connect the X session and verify that the popup displays the intended execution account. Then enable **Automatic X blocking**. Keep the browser running; no dedicated execution tab is required.
6. Observe the one target's result in Activity. The expected production sequence is an authenticated relationship read, one block POST if it was not already blocked, and an independent relationship readback. A completed job alone is not proof of a new POST: an already-blocked relationship can complete without a write.
7. Pause the queue and turn automatic blocking off after the result. Independently inspect the target on X to confirm the relationship. For cleanup, unblock the agreed target directly on X and remove the local test entry. The extension has no automatic-unblock function.
8. If authentication, target identity, rate limits or readback fail, stop and record the displayed bounded error. Do not repeatedly toggle or retry an uncertain operation to force a pass. Reconnection and retry require the original execution account and target identity to remain valid.

If network inspection is used to distinguish GET/POST/readback, record only route labels, status and outcome. Do not export authentication headers, cookie values or unredacted request logs into review notes or public issues.

## Evidence boundaries and expected limitations

Previous real-Chrome observations established an authenticated X Viewer connection and processing of existing blocked relationships. They did **not** independently establish a controlled new real-X block POST followed by relationship readback. Isolated tests cover the request sequence with synthetic data and intercepted responses; they are not live-X POST evidence. A successful execution of the controlled procedure above would be additional evidence, not something already established by these instructions. See [VERIFICATION.md](../VERIFICATION.md) for recorded test scope.

The extension uses X's web internal endpoints, which may change. It does not claim a public developer-OAuth integration or a partnership with X. Browser/cookie/account combinations beyond those actually tested remain unverified. A 30-day subscription interval reduces requests but can delay new list changes and does not hide the outbound IP address. Removing a subscription does not undo earlier X blocks.

## Useful public links

- [Project](https://github.com/ZOC698/guga-abuser-blocker)
- [Privacy policy](https://github.com/ZOC698/guga-abuser-blocker/blob/main/PRIVACY.md)
- [Public starting list](https://github.com/ZOC698/guga-abuser-blocker/blob/main/lists/guga-blocklist.json)
- [Issue tracker](https://github.com/ZOC698/guga-abuser-blocker/issues)

Chrome Web Store provides a [Test instructions tab](https://developer.chrome.com/docs/webstore/publish) for reviewer guidance. These instructions do not require disclosure of the maintainer's personal account credentials.
