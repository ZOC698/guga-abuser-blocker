# Guga Abuser Blocker · 0.1.2 preview

[简体中文](README.zh-CN.md) · [日本語](README.ja.md)

A Chrome / Edge extension for the Guga community, with English, Japanese and Chinese interfaces. Subscribe to a maintainer's public list, keep personal exceptions, and enable automatic blocking on your signed-in X account. Local imports and private backups are also supported. Automatic blocking starts off.

**Subscriptions are read-only. The extension cannot upload, publish or propose entries to the public repository, and does not accept a GitHub PAT.** Local imports, approvals and edits stay in your browser. The maintainer publishes the shared list separately.

## Repository and subscription

[Releases](https://github.com/ZOC698/guga-abuser-blocker/releases) · [Public list](lists/guga-blocklist.json) · [Maintainer workflow](CONTRIBUTING.md)

The public list is currently empty and adds no blocking targets. Private review data is not published. Use this stable subscription URL:

```text
https://raw.githubusercontent.com/ZOC698/guga-abuser-blocker/main/lists/guga-blocklist.json
```

## Install and subscribe

1. Extract the extension package and keep its folder. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**, select **Load unpacked**, and choose the **extension** folder containing `manifest.json` directly. Refresh existing X tabs.
3. Click the toolbar icon. The complete dashboard opens inside the popup: overview, account library, subscriptions, activity and settings. In **Subscriptions**, add the public GitHub Raw JSON URL and grant access to `raw.githubusercontent.com`. No separate management tab, GitHub account, PAT or X API key is needed.
4. Open a signed-in X tab and choose **Connect X account** under **Settings & help**. This selects the account the queue may act on; it is not a developer OAuth grant.
5. Enable **Automatic X blocking**. Eligible entries are queued after refresh. Keep the browser and dedicated X tab open. Actions are at least 30 seconds apart, adjustable up to 300 seconds.

Requires Chromium 120 or later. This is a developer-load preview; real-X compatibility has not been established across Chrome and Edge environments. Refresh runs manually or approximately every six hours while the browser can run. Sleep, shutdown and scheduling can delay work. After updating files, reload the extension and refresh X tabs.

## Your private library

Preview and import TXT, CSV or JSON, or paste handles in **Account library**. New local entries start pending, regardless of an imported approval flag. Review them before approving them for your own hiding and blocking. Approval never publishes an entry.

Use **Edit** to add or correct a numeric X ID, saved as a string of 1–25 digits. Correcting an existing ID returns the entry to pending; filling a missing ID preserves its review status. A known ID cannot be cleared. Current handles are still required. Import feedback distinguishes new entries, updated entries and duplicates. See [Data format](DATA_FORMAT.md) for merge rules.

To scan an existing block list, open [X Blocked accounts](https://x.com/settings/blocked/all), start collection in the library, then import the results. Only accounts rendered by X are collected. An idle scan does not prove completeness.

Private JSON and CSV downloads contain local entries only, not all settings, subscriptions or activity. Re-imported new entries require review. Keep private backups outside public repositories and release packages.

## Blocking and current limits

The active blocking path operates X's page controls (DOM). After a block, it reloads the profile and checks the signed-in account, target identity and blocked control. This is a page readback, not independent server API confirmation. A separate internal-API adapter is being validated; it is not the default queue executor. X page changes can interrupt this workflow.

Supplied numeric IDs are checked before acting. A mismatch or an identity that cannot be verified stops the action. Handles alone cannot guarantee identity after renaming or reassignment, and content hiding remains handle-based. Numeric-ID-only Bird Shield files require current handle mappings.

Exceptions override future hiding and blocking. Removing a subscription or entry, or adding an exception, does not undo existing X blocks; unblock on X yourself. Pause the queue at any time, but a submitted action cannot be recalled. Inspect Activity and X before retrying an uncertain result.

A complete authenticated workflow on real X across browsers, languages and account states remains unverified. Local fixture tests establish only the cases they simulate; see [Verification](VERIFICATION.md).

## Public list maintenance

Only authorized maintainers publish through the separate CLI workflow in [CONTRIBUTING.md](CONTRIBUTING.md). The subscriber extension has no public export, upload, repository creation or list-submission feature. This project does not use subscriber list PRs as a publication workflow. GitHub repository permissions control who can write the shared file.

This is an independent implementation inspired by Twitter Bird Shield's shared-list approach. It does not bundle Bird Shield code, icons or lists, and does not claim full format compatibility or equivalent reliability.

[Privacy](PRIVACY.md) · [Data format](DATA_FORMAT.md)
