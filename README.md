# Guga Abuser Blocker · 0.1.0

[简体中文](README.zh-CN.md) · [日本語](README.ja.md)

A Chrome / Edge extension for the Guga community. Review imported accounts, subscribe to community lists, hide matching content on X, and optionally block accounts on X. The interface supports English, Japanese and Chinese. No account list is bundled; automatic blocking starts off.


## Repository and subscription

[Download v0.1.0 preview](https://github.com/ZOC698/guga-abuser-blocker/releases/tag/v0.1.0) · [Public list](lists/guga-blocklist.json) · [Review workflow](CONTRIBUTING.md)

**The public list currently contains 0 accounts and has no blocking effect. It is awaiting its first reviewed release.** Private review candidates are not published here. Numeric IDs can be added later; current handles are supported.

Paste this stable URL into the extension’s Subscriptions page:

```text
https://raw.githubusercontent.com/ZOC698/guga-abuser-blocker/main/lists/guga-blocklist.json
```


## Install

1. Extract the release ZIP and keep the extracted folder.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode**, choose **Load unpacked**, and select the **extension** folder containing `manifest.json` directly.
4. Refresh existing X tabs. Open the extension icon to reach the dashboard; choose a language in the sidebar.

Requires Chromium 120 or later. This is an unpacked release, not a browser-store listing. To update, replace the extension files, reload it on the extensions page, and refresh X.

## Import and review

In **Account library**, preview and import TXT, CSV or JSON, or paste handles. **Every file import and captured account starts pending**, even if an imported file says `approved`. Select accounts you have reviewed, add relevant reasons and evidence, then choose **Approve selected**. Keep unrelated entries from your private block list out of the community list.

To collect from the webpage, open [X Blocked accounts](https://x.com/settings/blocked/all), return to the library, start a scan, then choose **Import collected**. Auto-scroll collects accounts that X actually renders. An idle scan does not prove that the whole list was loaded. A new scan starts a fresh snapshot bound to the scanned account.

## Subscribe and block

1. Add a trusted curator's public GitHub Raw JSON URL under **Subscriptions** and grant access to `raw.githubusercontent.com`. Subscribers need no GitHub account, PAT or X API key.
2. Subscribing trusts that list's entries without individual local review. Refresh manually or let the extension check about every six hours while the browser is running and the device is awake.
3. Open your signed-in X tab, then select **Connect X account** under **Settings & help**.
4. Enable **Automatic X blocking** to queue existing and newly eligible entries. You can also start the queue manually under **Activity**. Actions are at least 30 seconds apart, adjustable up to 300 seconds. Keep the browser and dedicated X tab open.

Local hiding and native X blocking are separate features. Exceptions override lists for future hiding and blocking. Removing a subscription or entry, or adding an exception, **does not undo existing X blocks**; unblock on X yourself. Pause the queue anytime; an action already submitted to X cannot be recalled.

## Publish a community list

Export **Shareable JSON** from the library. `guga-blocklist.json` includes only approved local entries, excludes exceptions, and does not republish subscribed entries. Inspect it, manually upload it to a public GitHub repository, and share its Raw URL:

```text
https://raw.githubusercontent.com/ZOC698/guga-abuser-blocker/main/lists/guga-blocklist.json
```

Update the same file path for future releases. The extension never uploads files or writes to GitHub. **Never bundle private source exports, private backups or your complete personal block list in a release or public repository.** Reasons and behavior allegations are reviewed by the curator; the extension does not establish them as facts.

## Current limits

- Version 0.1.0 is validated with local fixture pages and tests. A complete authenticated workflow on live X remains unverified. Page changes, account changes, unclear identity or an unconfirmed result stop the queue. Inspect **Activity** and X before retrying.
- Accounts are located by current handle. When a numeric ID is supplied, native blocking pins and checks it, stopping if it cannot be verified or does not match. There is no automatic rename resolution. Handles alone cannot guarantee identity after reassignment; local content hiding remains handle-based.
- Bird Shield's numeric-ID-only files need a current handle mapping before import. See [DATA_FORMAT.md](DATA_FORMAT.md).
- Private JSON and CSV exports cover local entries, not all settings, subscriptions or logs. Re-imported entries require review again. Uninstalling clears extension storage but does not undo X blocks.

Inspired by Twitter Bird Shield's shared-list approach. The author's [store page](https://chromewebstore.google.com/detail/twitter-bird-shield/igapbfjkbkmjcmgjmgfcegamhkfppdmg) describes GitHub sharing, and its [data repository](https://github.com/free-spirit-dev/bird-shield-blocking) contains categorized numeric ID files. This is an independent implementation: no source, icons or lists were copied, and full two-way format compatibility is not claimed.

[Privacy](PRIVACY.md) · [Data format](DATA_FORMAT.md)
