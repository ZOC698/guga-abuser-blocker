# Guga list format · v1 · extension 0.2.2

Chinese: 本地导入直接启用，无需审核；重新导入会重新启用匹配的已停用条目。公开订阅直接信任维护者的条目。数字 ID 必须保存为字符串，并同时提供当前用户名。

日本語: ローカル取り込みは確認操作なしですぐ有効になり、再取り込みは一致する無効項目も再び有効にします。公開リストの購読は管理者の項目を信頼する操作です。数値 ID は文字列で保存し、現在のユーザー名も指定してください。

## Public subscription JSON

Use UTF-8 JSON with `schema: "guga-blocklist/v1"` and an `entries` array. An empty valid list is:

```json
{
  "schema": "guga-blocklist/v1",
  "name": "Guga community blocklist",
  "updatedAt": "2026-11-12T00:00:00.000Z",
  "entries": []
}
```

Each entry is an object with these fields:

| Field | Meaning |
| --- | --- |
| `handle` | Required current X username, 1–15 ASCII letters, digits or underscores; optional leading `@`. Normalized to lowercase. |
| `id` | Optional X numeric user ID, a **string** of 1–25 decimal digits. JSON numbers are rejected to prevent precision loss. |
| `reason` | Optional curator-written explanation; retained up to 1,000 characters. |
| `evidence` | Optional array of HTTPS URLs without embedded credentials; up to 10 URLs. |

An illustrative entry below uses placeholders and is **not a recommendation to block any account**:

```json
{
  "handle": "example_account",
  "id": "1234567890123456789",
  "reason": "Replace with a reviewed, specific reason.",
  "evidence": []
}
```

The extension enables subscription entries because the user explicitly trusts the source. Imported `source`, `status` and `addedAt` fields are not trusted. The extension only reads public subscription files and does not export or upload public lists. The repository maintainer generates the public file with the separate CLI described in CONTRIBUTING.md. Public publication still requires the maintainer's evidence review; locally enabled entries are not automatically publication-approved. Reasons and evidence are curator submissions, not plugin-verified findings.

Public URLs must have this form:

```text
https://raw.githubusercontent.com/OWNER/REPO/BRANCH/path/list.json
```

Only this HTTPS host and `.json` files are accepted. Credentials, query strings, fragments and non-default ports are rejected. Use a public repository; no PAT is accepted or needed. The `name` and `updatedAt` metadata are descriptive, not signatures or a guarantee of freshness. Keep the same path for updates. Failed refreshes retain the last successfully loaded data; successful refreshes replace that source's entries. Deletions do not reverse completed native X blocks.

## Local imports

Supported inputs are newline-separated handles or X profile URLs, CSV, a JSON array, or a JSON object containing `entries`, `accounts` or `handles`. JSON entries accept `handle`, `screen_name` or `username`; optional numeric IDs accept `id` or `userId` as strings. Post URLs are not profile URLs.

CSV should begin with `handle`, `username` or `screen_name`, followed by optional columns such as `id,reason,evidence,status`. Quote cells containing commas or newlines. `evidence` can contain a JSON string array; exported CSV quotes it automatically. CSV export prefixes potentially executable spreadsheet formulas with an apostrophe, which may be visible when re-importing text fields.

Local imports are enabled immediately without a separate review step. An explicit re-import also enables matching disabled local entries, regardless of the supplied status. The internal entry values remain `approved` for enabled and `pending` for disabled; these names are retained for schema compatibility and are not evidence that an imported account was reviewed. Queue-job `pending` has a separate meaning: waiting to execute.

Duplicate inputs are reconciled by handle and numeric ID; conflicting IDs are rejected. Re-importing a known handle can fill a missing ID, preserves existing reasons and evidence, and enables that local entry. An imported matching numeric ID with a new handle can update that local mapping; it does not perform an online rename lookup. Import feedback reports imported, updated and duplicate counts; updated entries can also count as duplicates. Existing nonempty IDs cannot be silently replaced by import. Use the local entry editor to correct an ID; correcting an existing ID disables the entry, while filling a missing ID preserves its enabled/disabled state. Known IDs cannot be cleared.

Importing does not enable the global automatic-blocking switch, resume a paused queue or remove exceptions. Automatic processing requires an enabled entry, a verified connected account, an existing numeric target ID and an unpaused queue with automatic blocking enabled. Private JSON and CSV exports contain local entries only, not a complete state backup. Re-importing them enables matching local entries rather than restoring disabled status from the file.

Limits: 4 MiB per imported or downloaded file; 20,000 input entries per file and 20,000 combined stored entries across local lists and subscriptions; at most 20 subscriptions. Chrome storage.local has a 10 MiB quota in supported Chrome versions; combined queue, log and list storage can impose a lower practical limit than the entry count for large reasons or URLs.

## Identity and Bird Shield

Native API blocking uses the supplied numeric target ID. IDs are pinned and checked before blocking; a mismatch or inability to verify stops the action. It does not resolve renamed accounts automatically. Local feed filtering remains handle-based. Keep mappings current and check reassigned handles.

The original [Bird Shield blacklist directory](https://github.com/free-spirit-dev/bird-shield-blocking/tree/main/bird-shield-blocking/share/blacklist) contains plain text numeric IDs, one per line; [fraud.txt](https://github.com/free-spirit-dev/bird-shield-blocking/blob/main/bird-shield-blocking/share/blacklist/fraud.txt) is a directly inspected example. Those ID-only files are rejected until current handles are supplied. This release does not implement Bird Shield's complete synchronization format or automatically import its lists.

Private source exports and backups stay outside the repository. Only authorized maintainers build the public file with scripts/build-list.mjs from a separate publication-review file, inspect the diff and publish it through their repository access. A private backup's `approved` value means locally enabled and must not substitute for publication review. Subscriber uploads and list PRs are not part of the workflow.
