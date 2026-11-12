# Maintaining the Guga list · 0.2.3

The extension and the public subscription list live in this repository. This document is for maintainers with GitHub write access. Subscriber builds only read public lists: no public export, upload, PAT or candidate-submission feature is provided. They cannot modify the public branch. Subscriber list PRs are not the publication workflow. Working exports and private metadata stay outside the repository. Numeric IDs are optional in the format but required for native X blocking; preserve them as quoted decimal strings.

## Owner-selected publication

The owner has explicitly authorized publishing all 523 initial handle/ID mappings as imported blocking preferences. Inclusion is not an independently verified finding of abuse. The initial public rows contain only `handle` and `id`; there is no reason to fabricate allegations, profile descriptions or evidence links.

No approval flag, reason or evidence is required for a maintainer's explicitly selected input. Optional context is validated if supplied. For compatibility, statusless rows and `approved` rows are included, while explicitly `pending` or `excluded` rows are omitted. Unknown status values are errors. In extension backups, `approved` means locally enabled; it is not evidence of any account's behavior.

Only the maintainer's separate repository access publishes changes. Personal subscriber imports, exceptions and edits remain local, and a public GitHub repository does not grant ordinary readers write permission.

## Build the public file

Keep your working JSON outside the repository, with entries shaped like:

```json
{
  "entries": [
    {"handle": "example_account", "id": "1234567890123456789"}
  ]
}
```

Build the selected entries, regenerate the packaged copy, and validate before committing:

```sh
node scripts/build-list.mjs --input /absolute/path/to/selected-list.json --output lists/guga-blocklist.json
npm run validate:list
npm run sync:official
npm run check
npm run test:unit
git diff -- lists/guga-blocklist.json
npm run package
```

The builder strips private metadata, omits blank reasons and empty evidence arrays, and rejects malformed optional fields, duplicate identities and numeric IDs represented as numbers. It validates before replacing the output and refuses to overwrite its input. `--review` remains an alias for `--input`; no review gate is imposed. Inspect the exact diff before committing.

`lists/guga-blocklist.json` is the source of truth. `npm run sync:official` regenerates `extension/lib/official-list.js`; do not hand-edit the two copies independently. `npm run check` enforces equality. The packaged copy supplies initial data; the default enabled subscription reads future changes from the fixed GitHub Raw URL. Normal users only install, connect X and enable automatic blocking; they do not run these commands.

## Corrections and updates

Remove an entry from the selected input or explicitly mark it `excluded`, then rebuild and run `npm run sync:official`. Update the existing public file rather than creating a new subscription URL. The next successful subscriber refresh replaces that list's cached entries. Removing an entry does not undo a native X block that already happened; the subscriber can unblock on X.

Keep current handles and exact numeric ID mappings together. When an ID is known, keep it a string and confirm it belongs to the intended account. Never infer an ID from a handle.

## Development

Runtime code has no dependencies. Use Node 20 or later for `npm run check` and `npm run test:unit`. Optional Playwright browser tests are described in [VERIFICATION.md](VERIFICATION.md). The CI validates the public list, extension packaging, and unit tests; it does not operate a real X account.

Publish only the fields the owner has selected for sharing. Do not commit original working exports, private notes, browser profiles, tokens or screenshots containing private account data. CI validates format and code; it does not independently verify the behavior of listed accounts.
