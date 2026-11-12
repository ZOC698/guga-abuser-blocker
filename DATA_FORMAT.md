# Guga list format · v1

Chinese: 文件导入一律待审核；公开订阅直接信任维护者的条目。数字 ID 必须保存为字符串，并同时提供当前用户名。

日本語: ファイル取り込みはすべて確認待ちになります。公開リストの購読は管理者の項目を信頼する操作です。数値 ID は文字列で保存し、現在のユーザー名も指定してください。

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

The extension treats subscription entries as approved because the user explicitly trusts the source. Imported `source`, `status` and `addedAt` fields are not trusted. Exported public lists contain approved local entries only, excluding allowlisted handles; subscribed entries are not republished. Reasons and evidence are curator submissions, not plugin-verified findings.

Public URLs must have this form:

```text
https://raw.githubusercontent.com/OWNER/REPO/BRANCH/path/list.json
```

Only this HTTPS host and `.json` files are accepted. Credentials, query strings, fragments and non-default ports are rejected. Use a public repository; no PAT is accepted or needed. The `name` and `updatedAt` metadata are descriptive, not signatures or a guarantee of freshness. Keep the same path for updates. Failed refreshes retain the last successfully loaded data; successful refreshes replace that source's entries. Deletions do not reverse completed native X blocks.

## Local imports

Supported inputs are newline-separated handles or X profile URLs, CSV, a JSON array, or a JSON object containing `entries`, `accounts` or `handles`. JSON entries accept `handle`, `screen_name` or `username`; optional numeric IDs accept `id` or `userId` as strings. Post URLs are not profile URLs.

CSV should begin with `handle`, `username` or `screen_name`, followed by optional columns such as `id,reason,evidence,status`. Quote cells containing commas or newlines. `evidence` can contain a JSON string array; exported CSV quotes it automatically. CSV export prefixes potentially executable spreadsheet formulas with an apostrophe, which may be visible when re-importing text fields.

Every local import becomes pending regardless of a supplied status. Duplicate handles within a file are collapsed, keeping the first occurrence. Existing local handles are kept rather than overwritten by a later import. Private JSON and CSV exports contain local entries only, not a complete state backup.

Limits: 4 MiB per imported or downloaded file; 20,000 input entries per file and 20,000 combined stored entries across local lists and subscriptions; at most 20 subscriptions. Browser storage quotas can impose a lower practical limit for large reasons or URLs.

## Identity and Bird Shield

The extension opens profiles by handle. Supplied IDs are pinned and checked before native blocking; a mismatch or inability to verify stops the action. It does not resolve renamed accounts automatically. Local feed filtering remains handle-based. Keep mappings current and review reassigned handles.

The original [Bird Shield blacklist directory](https://github.com/free-spirit-dev/bird-shield-blocking/tree/main/bird-shield-blocking/share/blacklist) contains plain text numeric IDs, one per line; [fraud.txt](https://github.com/free-spirit-dev/bird-shield-blocking/blob/main/bird-shield-blocking/share/blacklist/fraud.txt) is a directly inspected example. Those ID-only files are rejected until current handles are supplied. This release does not implement Bird Shield's complete synchronization format or automatically import its lists.

Never publish private source exports or backups. Generate and inspect Shareable JSON before uploading a curated public file.
