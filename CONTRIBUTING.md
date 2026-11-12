# Maintaining the Guga list

The extension and the public subscription list live in this repository. This document is for authorized maintainers. Subscriber builds only read public lists: no public export, upload, PAT or candidate-submission feature is provided. Subscriber list PRs are not the publication workflow. Repository write permissions, not client-side controls, determine who can publish. Personal exports and the review worklist stay outside it. Numeric X IDs are optional for this first version; use current handles and add IDs later as quoted decimal strings.

## Review decisions

- `pending`: not reviewed, uncertain, or awaiting evidence. Never published.
- `approved`: the curator has checked the account, a specific Guga-related reason, and at least one supporting HTTPS link. Eligible for the public list.
- `excluded`: outside this list's scope, a mistaken match, or not supported by the available evidence. Never published.

A Guga-looking handle, language, nationality, politics, or presence in somebody's personal block list is not evidence of the account's behavior. Review the actual content. Keep unrelated personal preferences out of this community list. Reasons should describe observable content and avoid claims about the account owner's identity or motives.

Use public profile/post links as evidence; do not add private messages, personal contact information, credentials, or unrelated biographical information. A public profile link can identify a source, but the curator must actually inspect the relevant content before approving it.

## Build the public file

Keep your working JSON outside the repository, with entries shaped like:

```json
{
  "schema": "guga-blocklist/v1",
  "entries": [
    {"handle": "example_account", "status": "pending", "reason": "", "evidence": []}
  ]
}
```

After reviewing entries, build the subscription file:

```sh
node scripts/build-list.mjs --review /absolute/path/to/review-worklist.json --output lists/guga-blocklist.json
npm run validate:list
npm run test:unit
git diff -- lists/guga-blocklist.json
```

The builder publishes approved entries only and strips private review metadata. It refuses approved entries without a reason or evidence. Inspect the exact diff before committing. The repository's list rules are stricter than the extension's generic import format.

## Corrections and updates

Mark a mistaken entry excluded in your private worklist and rebuild. Update the existing public file rather than creating a new subscription URL. The next successful subscriber refresh replaces that list's cached entries. Removing an entry does not undo a native X block that already happened; the subscriber can unblock on X.

Handle changes and reassignment need review until stable numeric-ID mappings are added. When an ID is known, keep it a string and confirm it belongs to the intended account. Never infer an ID from a handle.

## Development

Runtime code has no dependencies. Use Node 20 or later for `npm run check` and `npm run test:unit`. Optional Playwright browser tests are described in [VERIFICATION.md](VERIFICATION.md). The CI validates the public list, extension packaging, and unit tests; it does not operate a real X account.

Do not commit a personal block export, private worklist, browser profile, token, screenshot containing private account data, or unreviewed candidate list.
