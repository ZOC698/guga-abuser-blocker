# Guga Abuser Blocker · 0.2.3 preview

[简体中文](README.zh-CN.md) · [日本語](README.ja.md)

A Chrome / Edge extension to reduce exposure to accounts on the Guga community’s maintained block list, with English, Japanese and Chinese interfaces. Coverage follows that list; unlisted accounts may still appear. Subscribe to a maintainer's public list, keep personal exceptions, and enable automatic blocking on your signed-in X account. Local imports and private backups are also supported. Automatic blocking starts off.

**Subscriptions are read-only. The extension cannot upload, publish or propose entries to the public repository, and does not accept a GitHub PAT.** Local imports, enable/disable choices and edits stay in your browser. The maintainer publishes the shared list separately.

## Repository and subscription

[Releases](https://github.com/ZOC698/guga-abuser-blocker/releases) · [Public list](lists/guga-blocklist.json) · [Maintainer workflow](CONTRIBUTING.md)

The built-in official subscription contains 523 accounts selected by the list owner from their imported blocking preferences. Inclusion is not an independently verified finding of abuse. Published entries contain only the current handle and exact numeric ID; no reason or evidence has been invented. The extension includes a packaged copy and refreshes it from this stable URL:

```text
https://raw.githubusercontent.com/ZOC698/guga-abuser-blocker/main/lists/guga-blocklist.json
```

## Install and subscribe

1. Extract the extension package and keep its folder. Open `chrome://extensions` or `edge://extensions`, enable **Developer mode**, and load the **extension** folder containing `manifest.json` directly.
2. Sign in to X in this browser profile. Click the extension toolbar icon to open all five management panels inside the popup.
3. The official subscription is already enabled and includes a packaged starting list. Installation requests read access to `raw.githubusercontent.com` for updates; there is no list URL to paste. Subscribers need no terminal, Codex, GitHub account, PAT or X developer API key.
4. Choose **Connect X session**. The background checks the signed-in browser session and binds its numeric account ID. **After upgrading from 0.1.x, reconnect before enabling blocking.** This is not developer OAuth authorization.
5. Enable **Automatic X blocking**. Enabled entries with numeric IDs enter the background queue. Keep the browser running; a dedicated X profile tab is no longer needed. The default request interval is at least 30 seconds, adjustable up to 300 seconds.

The session must remain signed in. Account/session changes or authentication failures require reconnecting. A rate limit, request budget or network delay can create a persistent cooldown shown in the popup; closing the popup or restarting the worker does not bypass it.

Requires Chromium 120 or later. This is a developer-load preview; real-X compatibility has not been established across Chrome and Edge environments. Subscription refresh runs manually or approximately every six hours while the browser can run. Sleep, shutdown and scheduling can delay work. After updating files, reload the extension and refresh X tabs for content hiding.

## Your private library

Preview and import TXT, CSV or JSON, or paste handles in **Account library**. Importing enables those local entries immediately, with no separate review or approval step. Explicitly re-importing a matching disabled entry enables it again, regardless of the file’s saved status. When automatic blocking is on and the queue is running, eligible entries with numeric IDs are processed automatically. Importing does not turn on the global switch, resume a paused queue, remove exceptions or publish data.

Use **Edit** to add or correct a numeric X ID, saved as a string of 1–25 digits. Correcting an existing ID disables the entry until you enable it again; filling a missing ID preserves its enabled/disabled state. A known ID cannot be cleared. Current handles are still required. Import feedback distinguishes new entries, updated entries and duplicates. See [Data format](DATA_FORMAT.md) for merge rules.

To scan an existing block list, open [X Blocked accounts](https://x.com/settings/blocked/all), start collection in the library, then import the results. Only accounts rendered by X are collected. An idle scan does not prove completeness.

Private JSON and CSV downloads contain local entries only, not all settings, subscriptions or activity. Re-importing a backup enables its local entries, including matching entries you previously disabled; it does not restore disabled status from the file. Keep private backups outside public repositories and release packages.

## Blocking and current limits

Version 0.2.3 sends background requests to X’s web internal API using the browser’s signed-in session. It reads back the blocking relationship through that API before recording success; the queue no longer clicks profile menus. These private web endpoints are different from the documented developer OAuth API and can change without notice.

Every native block requires an existing numeric target ID. A handle-only enabled entry waits as **Needs numeric ID**, without sending a block request. Add an ID to a local entry, or wait for the subscription maintainer to supply it. No automatic handle-to-ID lookup is performed by the queue. IDs and the connected numeric account identity are checked around execution; content hiding still matches handles.

The popup retains draft forms and navigation for the browser session. Connection results, queue state and cooldowns are persisted separately so closing the popup does not discard their outcome.

Exceptions override future hiding and blocking. Removing a subscription or entry, or adding an exception, does not undo existing X blocks; unblock on X yourself. Pause the queue at any time, but a submitted action cannot be recalled. Inspect Activity and X before retrying an uncertain result.

A complete authenticated workflow on real X across browsers, languages and account states remains unverified. Local fixture tests establish only the cases they simulate; see [Verification](VERIFICATION.md).

## Public list maintenance

Only maintainers with GitHub write access can publish through the separate CLI workflow in [CONTRIBUTING.md](CONTRIBUTING.md). The owner has authorized publication of the initial 523 entries as blocking preferences; no additional approval status, reason or evidence is required. The subscriber extension has no public export, upload, repository creation or list-submission feature. It cannot modify the public branch. This project does not use subscriber list PRs as a publication workflow. Personal exceptions and local edits do not change the shared file.

This is an independent implementation inspired by Twitter Bird Shield's shared-list approach. It does not bundle Bird Shield code, icons or lists, and does not claim full format compatibility or equivalent reliability.

[Privacy](PRIVACY.md) · [Data format](DATA_FORMAT.md)
