# Public subscription list · 0.2.4

`guga-blocklist.json` is the source for the default enabled official subscription and its packaged starting copy. The initial 523 accounts were selected by the owner from imported blocking preferences and authorized for publication as minimal `{handle,id}` rows. Inclusion is not an independently verified finding of abuse. The extension only reads this file, accepts no PAT and cannot upload local data or modify the public branch. Only maintainers with GitHub write permission can publish changes; subscriber list PRs are not the publication workflow.

Version 0.2.4 starts with the packaged copy without immediately fetching GitHub, then automatically refreshes on a persisted 30-day deadline. Restart, reload and X connection do not fetch before it is due. Upgrades derive that deadline from saved `lastSync` plus 30 days. Manual refresh or actively adding a subscription fetches immediately; manual refresh postpones the next automatic refresh by 30 days. Failed fetches keep the cache and wait 30 days for the next automatic attempt. Newly published additions, corrections and removals can therefore take a month to reach automatic subscribers, or longer after downtime or failures. This reduces requests but does not hide subscribers' outbound IP addresses.

中文：初始 523 条是所有者授权公开的屏蔽偏好，不代表已独立核实虐待行为。只发布用户名和精确数字 ID，不编造理由或证据。维护者选定的条目无需额外批准状态；如明确写了 `pending` 或 `excluded`，仍会排除。

日本語：最初の 523 件は所有者が公開を許可したブロック設定であり、虐待行為の独立した確認結果ではありません。ユーザー名と正確な数値 ID のみを公開し、理由や根拠を捏造しません。選択した項目に追加の承認状態は不要ですが、明示された `pending`・`excluded` は除外します。

Only `handle` is required per public row; `id`, `reason` and `evidence` are optional. IDs must be strings, never numbers. Supplied reasons and HTTPS links are checked for format, not truth. The builder omits blank optional context and never fills it with invented content.

From the repository root, build an explicitly selected maintainer input kept **outside this repository**, then regenerate the packaged copy:

```sh
node scripts/build-list.mjs --input /absolute/path/to/selected-list.json
node scripts/validate-list.mjs lists/guga-blocklist.json
npm run sync:official
npm run check
npm run package
```

On Windows, quote paths containing spaces. `--output`, `--name` and `--updated-at` are optional. Supplying a UTC `--updated-at` gives reproducible output; rows are sorted by lowercase handle. The builder validates selected rows before replacing the public file, strips private metadata, rejects duplicate handles/IDs and refuses to overwrite its input. `--review` remains an input alias. The build and seed synchronization commands do not publish or upload. Do not edit `extension/lib/official-list.js` manually; the project check requires it to match this JSON.

Inspect the diff, then publish this file at the same path through the maintainer's repository access. The extension reads this fixed address:

```text
https://raw.githubusercontent.com/ZOC698/guga-abuser-blocker/main/lists/guga-blocklist.json
```

Verify that address returns the intended JSON before sharing it. Updating the file retains the subscription location; publishing does not push an immediate update to subscribers. Once a subscriber receives the changed list, removal prevents future list matches but does not reverse blocks already applied on X.

To remove an entry, remove it from the selected input or mark it `excluded`, rebuild and synchronize the packaged copy, then commit the resulting diff. Publish only the selected public fields; omit private notes, original working exports and access tokens. CI checks format and code, not whether an account has engaged in abuse.
