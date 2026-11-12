# Privacy · 隐私 · プライバシー

Version 0.2.4 preview · 2026-11-12

**Popup drafts:** management form drafts and navigation are retained in extension `storage.session` for the current browser session. Drafts stay in this browser and are not published. Connection outcomes are retained in local extension state so closing the popup does not hide a failed attempt.

**X session access:** the background session provider reads X’s `twid` and `ct0` cookies, not `auth_token`. Those cookie values are used only in request memory, never written to local/session storage or returned to the UI. Chrome sends the ordinary authentication cookies back to X when fetching X with credentials. The packaged public web-client Bearer constant is not a user credential. Session material is sent only to X (x.com); numeric account ID and handle are retained locally as binding identifiers.

## English

**Local data:** imported accounts and numeric IDs, reasons, evidence links, enabled/disabled state, exceptions, subscription URLs, connected numeric account ID and handle, capture results, settings, queue, cooldown and activity are kept in this browser's extension storage. Chrome Sync is not used. The extension has no telemetry, analytics or developer server.

**Import behavior:** local imports become enabled without a separate review step; explicitly re-importing matching disabled entries enables them again. Importing does not enable the global automatic-blocking switch, resume a paused queue, remove exceptions or upload entries. When automatic blocking is already enabled and the queue is running, eligible imported entries with numeric IDs can be processed using the connected X account.

**Read-only subscriptions:** the official subscription is enabled by default, includes a packaged starting copy, and requires GitHub Raw read permission for updates. The extension reads it and any additional public JSON URLs without credentials. It has no GitHub write or public-list upload feature, does not accept a PAT, and does not send local entries to maintainers. Subscription hosts receive normal request information, such as the outbound IP address. Only maintainers with repository write access can publish changes.

**Subscription request frequency:** a fresh installation uses the packaged 523-account list without an immediate GitHub fetch. Automatic refresh uses a locally persisted 30-day deadline; browser restart, extension reload and X connection do not trigger a fetch before it is due. Older installations migrate from saved `lastSync` plus 30 days. Manual refresh and actively adding a subscription fetch immediately; manual refresh moves the next automatic deadline to 30 days later. A failed fetch retains the cached list and waits 30 days for another automatic attempt. This reduces requests, not the visibility of the outbound IP address. New list changes may arrive a month later, or longer while offline or after failures. It does not change the separate X request interval.

**Published starting list:** the owner authorized sharing 523 imported blocking preferences as public handle/ID pairs. These are not independently verified findings of abuse, and no reasons or evidence have been fabricated. The selected public pairs are included in the repository and package; original working exports, private notes, settings and session data are not included. Subscriber imports and edits remain local.

**X access:** native blocking uses X’s web internal API through the signed-in session. It no longer clicks profile menus. The extension checks numeric identities and reads back the blocking relationship before recording success. A browser X login is required; no X password, developer API key or GitHub PAT is entered into the extension. This is not developer OAuth authorization. X can change these internal endpoints. Content scripts still support local hiding and optional visible-list capture.

**Private backups:** JSON and CSV downloads occur only when requested and contain local entries. There is no shareable-public export. Backups can contain private accounts and evidence; keep them outside public repositories and release packages. These exports do not back up all settings, subscriptions or logs.

**Control and deletion:** pause blocking, disable content hiding or remove subscriptions. Removing an entry or subscription does not undo completed X blocks. Uninstalling clears extension storage; downloaded files and existing X blocks remain until you remove them yourself.

## 简体中文

账号和数字 ID、理由、证据链接、启用或停用状态、白名单例外、订阅地址、绑定数字账号 ID 和用户名、采集结果、设置、队列、冷却和操作记录保存在当前浏览器扩展存储，不使用 Chrome Sync。没有遥测、统计分析或开发者服务端。

本地导入后直接启用，无需额外审核；主动重新导入匹配的已停用条目会重新启用。导入不会打开全局自动拉黑开关、恢复暂停队列、移除例外或上传条目。若自动拉黑已开启且队列正在运行，带数字 ID 并符合条件的导入条目可以通过已连接的 X 账号自动处理。

官方订阅默认启用，附带初始名单副本，并需要 GitHub Raw 读取权限获取更新。它和额外添加的公开 JSON 都通过不带认证信息的请求读取。扩展没有 GitHub 写入、公共名单上传功能，不接收 PAT，也不把本地条目发送给维护者。订阅主机会收到出口 IP 等普通请求信息；只有有仓库写权限的维护者能够发布修改。

首次安装使用包内 523 条名单，不立即请求 GitHub。自动刷新按本地持久保存的 30 天期限执行；未到期时，重启浏览器、重载扩展和连接 X 不会触发订阅请求。旧版按已保存的 `lastSync` 加 30 天迁移。手动刷新和主动添加订阅立即联网，手动刷新将下一次自动期限推迟到 30 天后。请求失败保留缓存，30 天后再自动尝试。这减少请求次数，不隐藏出口 IP；新名单变更可能延迟一个月，离线或请求失败时更久。X 请求的独立间隔不受影响。

名单所有者已授权将 523 条导入屏蔽偏好以公开用户名/数字 ID 对分享。这不代表已独立核实虐待行为，不补写或编造理由、证据。选定的公开字段包含在仓库和安装包中，原始工作导出、私人备注、设置和会话数据不包含在内。订阅者的导入和编辑仍留在本地。

原生拉黑通过已登录会话调用 X 网页内部接口，不再点击用户主页菜单；核对数字身份并读回拉黑关系后才记录成功。需要在浏览器登录 X，无需向扩展输入 X 密码、开发者密钥或 GitHub PAT；这不是开发者 OAuth 授权，内部接口可能随 X 更新变化。内容脚本仍用于本地隐藏与可选的可见名单采集。

后台只读取 X 的 `twid` 和 `ct0` Cookie，不读取 `auth_token`。这些 Cookie 值仅在单次请求内存中使用，不写入 local/session 存储，也不传给界面。Chrome 会在向 X 发起带凭证请求时正常附带认证 Cookie。打包的公开网页客户端 Bearer 常量不是用户凭证。会话信息只发给 X（x.com）；数字账号 ID 和用户名作为绑定标识保存在本地。

私人 JSON / CSV 仅在用户主动导出时下载，包含本地条目，没有公共分享导出。私人备份可能包含账号及证据，不应放进公共仓库或发行包；它不是全部设置、订阅和日志的完整备份。

可以暂停拉黑、关闭隐藏或删除订阅。移除条目或订阅不解除已有 X 拉黑。卸载会清除扩展存储，但不会删除下载文件或解除 X 拉黑。

## 日本語

アカウントと数値 ID、理由、根拠リンク、有効・無効の状態、例外、購読 URL、接続アカウントの数値 ID とユーザー名、収集結果、設定、待機列、待機期限、履歴をこのブラウザーの拡張機能ストレージに保存します。Chrome Sync、テレメトリー、アクセス解析、開発者サーバーは使用しません。

ローカル取り込みは別の確認操作なしで有効になり、明示的な再取り込みは一致する無効項目も再び有効にします。取り込みは自動ブロックの全体設定をオンにせず、一時停止の解除、例外の削除、アップロードも行いません。自動ブロックがオンで待機列が動いていれば、数値 ID があり条件を満たす項目を接続中の X アカウントで自動処理できます。

公式購読は初めから有効で初期リストを同梱し、更新のため GitHub Raw の読み取り権限が必要です。公式および追加の公開 JSON は認証情報なしで取得します。GitHub 書き込みや公開リストのアップロード機能はなく、PAT を受け付けず、ローカル項目を管理者に送りません。購読先には出口 IP など通常の通信情報が届きます。書き込み権限を持つ管理者だけが変更を公開できます。

初回は同梱の 523 件を使い、すぐに GitHub へ取得リクエストを送りません。自動更新はローカルに保存した 30 日の期限に従い、期限前のブラウザー再起動・拡張機能の再読み込み・X 接続では取得しません。旧バージョンでは保存済みの `lastSync` の 30 日後を期限にします。手動更新と購読の新規追加ではすぐに通信し、手動更新は次の自動期限を 30 日後に延ばします。取得失敗時はキャッシュを維持し、30 日後に自動再試行します。リクエスト回数を減らす機能で、出口 IP は隠しません。新しい変更の反映は約 1 か月、オフラインや失敗時にはさらに遅れる場合があります。X リクエストの別の間隔は変わりません。

所有者は、取り込んだ 523 件のブロック設定を公開ユーザー名・数値 ID の組として共有することを許可しています。虐待行為が独立に確認されたという意味ではなく、理由や根拠は作成・捏造していません。選択した公開項目をリポジトリとパッケージに含め、元の作業用エクスポート、非公開メモ、設定、セッション情報は含めません。購読者の取り込みや編集はローカルに保存されます。

ブロックにはログイン済みセッションから X のウェブ内部 API を使用し、プロフィールのメニューはクリックしません。数値 ID とブロック関係を確認してから成功を記録します。ブラウザーでの X ログインは必要ですが、X パスワード・開発者キー・GitHub PAT を拡張機能に入力する必要はありません。開発者 OAuth 認可ではなく、内部 API は X の更新で変更される可能性があります。コンテンツスクリプトは非表示や任意の表示済み一覧収集に使用します。

バックグラウンドは X の `twid` と `ct0` Cookie だけを読み取り、`auth_token` は読み取りません。Cookie 値はリクエストのメモリー内だけで使用し、local/session ストレージへの保存や UI への返却はしません。Chrome は X への認証付き通信で通常の認証 Cookie を送信します。同梱する公開ウェブクライアントの Bearer 定数はユーザーの認証情報ではありません。セッション情報の送信先は X（x.com）だけで、数値アカウント ID とユーザー名は接続識別子としてローカルに保存します。

非公開 JSON / CSV は操作時だけダウンロードされ、ローカル項目を含みます。公開用書き出しはありません。個人のアカウントや根拠を含む可能性があるため、公開リポジトリや配布物には含めないでください。設定・購読・履歴の完全なバックアップではありません。

ブロックの一時停止、非表示の無効化、購読の削除ができます。項目・購読を削除しても X ブロックは解除されません。アンインストールで拡張データは消えますが、ダウンロード済みファイルと X ブロックは残ります。
