# Public subscription list

`guga-blocklist.json` is the stable subscription file. It is published only by authorized maintainers; the extension is a read-only subscriber, accepts no PAT and cannot upload local data. Subscriber list PRs are not the publication workflow. It remains empty. Local imports are enabled immediately for private use in 0.2.2, which does not publish them. An empty list is valid and adds no blocking targets. This repository does not contain the private source list.

中文：数字 ID 可随后补齐；先使用当前用户名。只有人工审核为 `approved`、填写明确原因并附至少一条 HTTPS 证据链接的账号，才可发布。`pending` 和 `excluded` 不会进入订阅文件。用户名可能改名或被重新使用，维护者需要更新映射。

日本語：数値 ID は後から追加できます。現在のユーザー名を使い、理由と HTTPS の根拠リンクを付けて確認済みとした項目だけ公開します。確認待ち・除外済みの項目は配信しません。ユーザー名変更や再利用は管理者による確認が必要です。

The publication validator is stricter than the extension's general import format: every published row requires a nonempty reason and at least one evidence link. A valid link is not proof that its claim is true; a maintainer must review the source. Numeric IDs are optional strings, never numbers.

From the repository root, build only publication-reviewed entries from a separate private review file kept **outside this repository**. A local extension backup's `approved` status means enabled for personal use and does not establish that publication review occurred:

```sh
node scripts/build-list.mjs --review /absolute/path/to/private-review.json
node scripts/validate-list.mjs lists/guga-blocklist.json
```

On Windows, quote paths containing spaces. `--output`, `--name` and `--updated-at` are optional. Supplying a UTC `--updated-at` gives reproducible output; rows are always sorted by lowercase handle. The builder validates every approved row before replacing the public file, strips private metadata, rejects duplicate handles/IDs and refuses to overwrite its private input. No network requests or upload occur.

After reviewing the diff, commit this file to the same path. Once the repository is published, subscribers use this fixed address:

```text
https://raw.githubusercontent.com/ZOC698/guga-abuser-blocker/main/lists/guga-blocklist.json
```

Verify that address returns the intended JSON before sharing it. Updating the file retains the subscription location. Removal prevents future list matches but does not reverse blocks already applied on X.

To remove an entry, mark its private record `excluded`, add a private note if needed, rebuild, then review and commit the resulting diff. Do not publish private notes, original imports, complete account block histories, or access tokens. CI checks public format and code only; it does not decide whether an account belongs in the list.
