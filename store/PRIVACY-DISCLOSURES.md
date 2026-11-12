# Privacy questionnaire evidence and open items

Prepared from the inspected 0.2.5 preview source and official Chrome Web Store documents on 2026-11-12. This is a submission worksheet describing the implemented encrypted-state storage and its protection limits. The complete isolated automated suite and installation of the actual store ZIP passed; see [verification](../VERIFICATION.md) for the test counts, migration cases and package evidence. Those checks do not establish every user's upgrade environment or a controlled new real-X block. No dashboard upload, questionnaire certification or approval has been completed by preparing this file.

Public policy candidate: <https://github.com/ZOC698/guga-abuser-blocker/blob/main/PRIVACY.md>. The existing page was anonymously readable during preparation. Local edits must be published before the public page reflects them.

## Confirmed data handling

The [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) explicitly requires disclosure even when processing and storage remain on the device. An absence of analytics or a developer server is not a basis for selecting “no user data.”

| Dashboard category | Source evidence | Proposed treatment |
| --- | --- | --- |
| Personally identifiable information | `extension/lib/x-session.js` derives the current numeric account ID; `extension/lib/x-api.js` checks the server's account ID and handle; `extension/background.js` stores the binding, imported accounts, exceptions and queue identities. | Confirmed. Declare usernames and numeric account identifiers. Do not claim collection of legal names, addresses or emails. |
| Authentication information | `extension/lib/x-session.js` reads `twid` and `ct0`; `extension/lib/x-api.js` uses the session for authenticated X requests. Chrome attaches its ordinary X authentication cookies. | Confirmed. Declare session authentication handling. Cookie values remain in request memory; `auth_token` is not directly read or persisted by the extension. No password is entered into the extension. |
| Website content | `extension/content.js` reads account links and author/blocked-list elements for local filtering and explicit collection. The API reads X account and relationship response data. | Confirmed. Declare account information obtained from X pages and responses. Do not claim collection of private-message bodies or full-page archives. |

## Categories to match to the live dashboard's definitions

The developer dashboard was not accessible during preparation, so the exact current category help text was not verified. Use the observed behavior below rather than guessing from a category name.

| Category | Actual behavior and decision rule |
| --- | --- |
| Web history | `extension/content.js` uses the current X URL and account links; `extension/background.js` finds and validates X tabs for optional capture. Declare this category if the dashboard includes current visited URLs or page interactions, as the official FAQ's broad browsing-activity definition does. State that this is limited to X/Twitter pages, is not a cross-site history collector, and does not use the history API. |
| User activity | Local records include extension actions and timestamps, such as connection, refresh and blocking outcomes. Declare if the dashboard includes these extension action records. No general mouse-position tracking, keystroke logging or cross-site click tracking was found. |
| Location | No geolocation API, IP lookup or location database is used. X and GitHub receive ordinary network metadata, including the outbound IP address. Disclose that network fact; do not claim the extension determines or stores location. Check whether the dashboard explicitly classifies this ordinary transport metadata under Location. |

Financial/payment information, health information and personal communications have no implemented collection purpose in the inspected source. Freeform user notes and imported files should not be described as a dedicated collector of every possible kind of sensitive information a user could type. The public privacy text must still accurately cover the notes and imports the extension actually stores.

## Transfers, storage and deletion

| Data | Destination / persistence |
| --- | --- |
| X session cookie values | Read for the current operation, used only in memory, sent only to X through authenticated HTTPS requests. Not stored in extension local/session storage or returned to the UI. |
| Target numeric IDs for enabled blocking | Sent to X for relationship reads and block requests. A local library is not an assurance that its selected targets are never sent to X. |
| Local library, reasons/evidence, exceptions, account binding, queue and activity | AES-GCM-256 ciphertext in extension IndexedDB, with a non-extractable Web Crypto key in the same store and a new random 12-byte IV for each write. No upload to GitHub or a maintainer. After successful migration, `storage.local` holds only a revision notification. |
| Popup drafts and navigation | Chrome's in-memory extension `storage.session`; no Chrome Sync. This area is not a durable backup. |
| Filtering projection | The content script receives only effective handles, language and the hiding setting. Full state is available only to the trusted extension management interface; capture progress returns count/status rather than the library. |
| Subscription URL and network metadata | The validated GitHub Raw JSON URL is requested with credentials omitted. The server receives ordinary network information. No list upload or PAT flow exists. |
| Private JSON/CSV backup | Written to a user-requested local download. It is not application-encrypted and survives uninstalling until the user deletes it. |
| Existing native X blocks | Stored by X. Deleting a local entry, subscription or extension does not unblock an account on X. |

Migration commits and decrypts the saved representation before removing the legacy `storage.local.state` record. Failure stops the dependent operation instead of replacing unreadable encrypted data with empty or default state. Deletion is a logical storage operation, not a promise to physically erase historical database pages, browser/device backups or exported files.

## Limited Use and disclosure

The code has no data-sale, advertising, data-broker or credit/lending feature. The privacy policy now states a commitment to follow the [Limited Use requirements](https://developer.chrome.com/docs/webstore/program-policies/limited-use) and to use data only for the disclosed purpose. This is a commitment, not evidence of a Google approval or a substitute for resolving implementation gaps.

The permission explanations and store description must match the product. The [privacy-field guide](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) asks for the single purpose, a justification for each permission, remote-code information and accurate data disclosures. The [disclosure policy](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements) also requires informed consent; the FAQ specifies prominent in-product disclosure. The inspected `connectHelp` and `officialReadyDesc` strings in `extension/lib/i18n.js` now explain, in English, Chinese and Japanese, that connecting reads the local X session cookies/account ID, uses them for account verification and user-enabled X requests, and does not send session information to GitHub or the maintainer. Connection leaves automatic blocking off; enabling it is a separate user action. This is implementation evidence for the in-product explanation, not a claim of store acceptance. Target-ID transmission and resulting blocks are also disclosed in the listing and privacy policy.

## At-rest encryption and key-protection limits

The official [User Data FAQ, question 9](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) includes the phrase:

> stored at rest using a strong encryption method

It gives RSA and AES as examples. The [main handling requirements](https://developer.chrome.com/docs/webstore/program-policies/policies#handling-requirements) also require secure data handling and modern cryptography for transmission. Version 0.2.5 implements AES-GCM-256 for persistent state in `extension/lib/state-store.js`, with a new cryptographically random 12-byte IV per write and an authenticated revision. The key is generated as non-extractable; key and ciphertext persist in the same extension IndexedDB. The extension uses HTTPS and does not persist its session-cookie values. Private JSON/CSV exports remain intentionally readable, unencrypted files requested by the user.

The implementation verifies the committed encrypted representation before deleting legacy plaintext. Existing encrypted data is authoritative; missing keys, authentication/decryption failures and required write failures stop operations rather than silently starting a new library. Background execution awaits durable queue and write-budget records before dispatching a block. A revision-notification failure after a successful commit does not turn that committed write into an operation that should be repeated.

A non-extractable key prevents ordinary export through Web Crypto; it does not establish OS-keystore protection. Keeping the key and ciphertext in one browser profile does not protect against a full profile copy, local malware or compromised extension code. Removing the old logical record is not verified physical erasure of historical database pages or backups. The [Chrome storage documentation](https://developer.chrome.com/docs/extensions/reference/api/storage) describes the in-memory session area used for drafts; this is distinct from the encrypted persistent state. These are concrete safeguards and explicit limits, not an official policy ruling, a claim of universal security or a full-suite verification result.

## Remote code

Proposed answer: **No**. Executable code and X query metadata are packaged. GitHub responses are parsed as validated JSON data, never evaluated as JavaScript. The [remote-code guidance](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code) distinguishes data such as JSON from remotely hosted executable JavaScript/WASM. Recheck the actual upload package if dependencies or update logic change.

## Submission record

- The public privacy URL was checked; later local edits are not a claim that it has been republished.
- The developer dashboard returned an access limitation during preparation; no questionnaire was completed or submitted.
- No payment, account verification, agreement acceptance, store upload or publish action is recorded here.
- Store acceptance and a controlled new real-X POST/readback remain separate from isolated fixture test results.
