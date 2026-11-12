# Chrome Web Store listing draft

Prepared from the inspected 0.2.5 preview implementation on 2026-11-12. These are editable submission materials, not evidence of a store upload, submission or approval. The store dashboard was not reached in this preparation session. The implemented encrypted storage and its limits are described in [Privacy disclosures](PRIVACY-DISCLOSURES.md); use [verification](../VERIFICATION.md) for the final tested release scope and match data categories to the actual dashboard definitions before submission.

## Shared listing fields

- Name: **Guga Abuser Blocker**
- Homepage: <https://github.com/ZOC698/guga-abuser-blocker>
- Support: <https://github.com/ZOC698/guga-abuser-blocker/issues>
- Public privacy policy: <https://github.com/ZOC698/guga-abuser-blocker/blob/main/PRIVACY.md>
- Reviewer instructions: [REVIEWER-INSTRUCTIONS.md](REVIEWER-INSTRUCTIONS.md)
- Publisher name, verified contact email, trader declaration and distribution choices: use the publisher's actual details in the dashboard; these materials do not supply or infer them.

The privacy URL was publicly readable during preparation. Publish any approved privacy edits before relying on that URL for a submission. A reachable URL does not itself establish policy compliance.

## English

Short description:

> Follow Guga community blocklists on X, hide matching posts and optionally block accounts automatically, with personal exceptions.

Detailed description:

Guga Abuser Blocker helps you reduce exposure to X accounts using lists you choose. It includes a starting list of 523 accounts and can hide posts by matching authors.

Connect your signed-in X session and enable automatic blocking to process numeric account IDs at a controlled pace. Automatic blocking starts off. You can pause the queue, keep personal exceptions, import local lists and download private backups. Importing a list enables its entries, but does not turn on automatic blocking or resume a paused queue.

Subscriptions are read-only. The packaged list works immediately without an initial GitHub fetch. Updates run automatically every 30 days, or when you request a refresh. Failed updates retain the cached list. New list changes may take a month or longer to arrive automatically. Your local lists are not uploaded to the public repository, and no GitHub account or token is needed.

The interface supports English, Japanese and Chinese. All management panels are available in the extension popup.

The extension reads X page account information to filter content and can collect a visible blocked-account list when requested. Connecting uses the browser's X session cookies; cookie values are not stored by the extension or sent to the maintainer. Enabled blocking sends target numeric IDs to X. The extension has no analytics or developer server and does not hide your outbound IP address.

Persistent settings and library data are encrypted locally with AES-GCM-256. The non-extractable key and ciphertext share this browser profile; this is not protection against a copied profile or local malware. Popup drafts stay in session memory, and private JSON/CSV exports are readable files. The privacy policy explains migration, failure handling and the storage boundaries.

Inclusion reflects the list owner's blocking preferences, not independently verified findings of abuse. This extension is independent of X and Twitter Bird Shield. It cannot cover every unwanted account or post. X may change its internal web interfaces. Removing a list or uninstalling the extension does not undo existing X blocks; unblock on X yourself.

## 简体中文

简短说明：

> 订阅 Guga 社区屏蔽名单，在 X 隐藏匹配内容，并按你的设置自动拉黑；支持私人导入和白名单例外。

详细说明：

Guga Abuser Blocker 帮助你按自己选择的名单减少看到不想接触的 X 账号。扩展内置 523 条初始名单，可以隐藏匹配作者的内容。

连接已登录的 X 会话并主动开启自动拉黑后，扩展会按数字账号 ID 逐步处理。首次安装时自动拉黑关闭。你可以暂停队列、保留个人例外、导入本地名单及下载私人备份。导入会启用条目，但不会自动打开全局拉黑开关或恢复暂停的队列。

订阅只有读取功能。首次安装使用包内名单，不立即请求 GitHub；之后每 30 天自动更新，也可以手动刷新。更新失败时保留缓存。新名单变更可能延迟一个月或更久自动到达。你的本地名单不会上传公共仓库，无需 GitHub 账号或令牌。

界面支持中文、日文和英文，所有管理面板均可在扩展弹窗内使用。

扩展读取 X 页面中的账号信息来过滤内容，也可以在你主动操作时采集页面显示的屏蔽名单。连接使用浏览器里的 X 会话 Cookie；扩展不保存 Cookie 值，也不发送给维护者。开启拉黑后，目标数字 ID 会发给 X。扩展没有统计分析或开发者服务端，也不会隐藏出口 IP。

持久设置和账号库使用 AES-GCM-256 在本机加密。不可导出密钥与密文位于同一浏览器配置，不能防止整个配置被复制或本机恶意软件。弹窗草稿留在会话内存，私人 JSON/CSV 导出是可读文件。隐私政策说明了迁移、失败处理和存储边界。

收录表示名单所有者的屏蔽偏好，不代表已独立核实存在虐待行为。本扩展独立于 X 和推特鸟盾，不能保证覆盖所有不想看到的账号或内容。X 的网页内部接口可能变化。移除名单或卸载扩展不会解除已有 X 拉黑，需要在 X 中自行解除。

## 日本語

短い説明：

> Guga コミュニティのリストで X の投稿を非表示にし、任意で自動ブロック。個人の例外とローカル取り込みに対応。

詳しい説明：

Guga Abuser Blocker は、自分で選んだリストを使い、見たくない X アカウントとの接触を減らす拡張機能です。523 件の初期リストを同梱し、該当する投稿者のコンテンツを非表示にできます。

ログイン中の X セッションを接続し、自動ブロックを有効にすると、数値アカウント ID を使って順に処理します。初期状態では自動ブロックはオフです。一時停止、個人の例外、ローカル取り込み、非公開バックアップに対応します。取り込みは項目を有効にしますが、自動ブロックの全体設定をオンにしたり、一時停止を解除したりしません。

購読は読み取り専用です。初回は同梱リストを使い、すぐに GitHub へ取得リクエストを送りません。その後は 30 日ごと、または手動で更新します。取得失敗時はキャッシュを維持します。新しい変更の自動反映は約 1 か月、状況によってはそれ以上遅れる場合があります。個人のリストを公開リポジトリへアップロードせず、GitHub アカウントやトークンも不要です。

日本語・英語・中国語に対応し、管理パネルはすべて拡張機能のポップアップ内で使えます。

コンテンツを非表示にするため X ページのアカウント情報を読み取り、操作時に表示済みのブロック一覧を収集できます。接続にはブラウザーの X セッション Cookie を使用します。拡張機能は Cookie の値を保存したり、管理者へ送信したりしません。ブロックを有効にすると、対象の数値 ID を X に送信します。アクセス解析や開発者サーバーはなく、出口 IP を隠す機能もありません。

永続設定と一覧を端末内で AES-GCM-256 により暗号化します。抽出不可の鍵と暗号文は同じブラウザープロファイルにあり、プロファイルのコピーやローカルのマルウェアは防げません。下書きはセッションのメモリー内に置き、非公開 JSON/CSV は読み取り可能なファイルとして書き出します。移行、失敗時の処理、保存の範囲はプライバシーポリシーに記載しています。

掲載は所有者のブロック設定を表し、虐待行為を独立に確認したという意味ではありません。X や Twitter 鳥盾とは独立した拡張機能で、すべての対象アカウントや投稿を防ぐことはできません。X のウェブ内部 API は変更される可能性があります。リストの削除やアンインストールでは既存の X ブロックは解除されません。解除は X で行ってください。

## Single purpose

Help users control which X accounts they see by applying user-chosen blocklists through local content filtering and an optional, account-bound automatic blocking queue. Imports, exceptions and read-only subscriptions support this same purpose.

## Permission justifications

These correspond to the current manifest. Recheck them if the manifest changes. The project does not request the `tabs`, `scripting`, `downloads` or `unlimitedStorage` permissions.

| Permission | Suggested dashboard explanation |
| --- | --- |
| `storage` | Supports migration of legacy local state, a revision-only local notification, and in-memory popup drafts/session markers. Persistent blocklist entries, exceptions, connected identity, queue/cooldown and the 30-day subscription deadline are encrypted in extension IndexedDB. Chrome Sync is not used. |
| `alarms` | Runs the persisted 30-day subscription schedule and wakes the paced blocking queue and interruption watchdog. Subscription requests are skipped before the saved deadline. |
| `cookies` | Reads only X's twid and ct0 cookies to verify the current account and authenticate user-enabled blocking. Cookie values remain in request memory and are sent only to X. The extension does not read auth_token. |
| `https://x.com/*` | Supports authenticated requests to X, author-based content hiding, and user-requested collection of the visible blocked-account list. |
| `https://twitter.com/*` | Supports content hiding and visible-list collection on legacy Twitter URLs. |
| `https://raw.githubusercontent.com/*` | Downloads the built-in and user-added public JSON subscriptions without credentials. Only validated JSON data is used; the extension never writes to GitHub. |

Remote code: **No**. All executable JavaScript and X query metadata are bundled in the extension. Subscription responses are parsed and validated as data; they are not executed. Ordinary JSON data is distinguished from remotely hosted executable code in the [official remote-code guidance](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code).

## Assets and localization

The [current listing guide](https://developer.chrome.com/docs/webstore/cws-dashboard-listing) requires a 128 × 128 store icon and at least one screenshot, up to five. The [image guide](https://developer.chrome.com/docs/webstore/images) accepts 1280 × 800 or 640 × 400 screenshots, with 1280 × 800 preferred. Screenshots must show the actual experience, with square corners and no outer padding. Use isolated demonstration data and no real account credentials or private library contents.

The store icon must be PNG. For square artwork, the image guide recommends a 96 × 96 subject with transparent space around it. The 440 × 280 small promotional tile, 1400 × 560 marquee tile and YouTube video are optional. Promotional tiles are not locale-specific.

The 0.2.5 classic Guga icon includes 16, 32, 48 and 128 pixel PNG sizes. The package now has `default_locale: en` and `_locales/en`, `_locales/ja` and `_locales/zh_CN` metadata. Each language has three actual 1280 × 800 screenshots: overview, subscriptions and settings, captured from a fresh isolated installation without a connected account or synthetic blocking statistics. The store materials directory is `guga-store-0.2.5` alongside the release ZIPs. The initial capture observed no page errors and no X or GitHub request. The separate 450 × 580 popup preview is for review, not a correctly sized store screenshot.

## Submission boundaries

Do not claim an approved store listing, verified abuse findings, an X partnership, guaranteed detection, hidden IP addresses, or universal browser compatibility. The current evidence establishes a real X connection and relationship reads, but does not independently establish a controlled new real-X block POST followed by readback. Mocked integration tests exercise that sequence; they are not real-X POST evidence. See [verification](../VERIFICATION.md) and the reviewer instructions for the distinction.

The examined [program policies](https://developer.chrome.com/docs/webstore/program-policies/policies) do not name this product or specifically prohibit a user-enabled block queue. That is not a prediction of approval. Accurate descriptions, consent, privacy handling, no harassment and no interference with third-party services still apply.
