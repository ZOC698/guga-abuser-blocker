# Privacy · 隐私 · プライバシー

Version 0.1.0 · 2026-11-12

## English

**Stored locally:** imported accounts, reasons, evidence URLs, review status, exceptions, subscription URLs, connected account handle, capture results, settings, queue and activity records are stored in this browser's extension storage. They are not synchronized through Chrome Sync. The extension has no telemetry, analytics, developer server or automatic upload feature.

**Network access:** X pages are read and adjusted to hide matching content, identify the signed-in account and perform the requested native block actions. These actions use the existing signed-in page; the extension does not read or export cookies, passwords or authentication tokens. The browser still sends its ordinary X session data to X when it operates that page. Adding a subscription grants optional access to `raw.githubusercontent.com`; the extension fetches only the public list URLs you add, without credentials. GitHub receives normal network request information such as your IP address. The extension does not request a PAT.

**Sharing:** export files are saved only when requested. Shareable JSON contains approved local entries and their reasons/evidence, excluding exceptions. It does not contain subscription entries, queue records or logs. Uploading that file to a public repository makes its contents public. Full local JSON/CSV exports can contain private entries: never include those files or original private exports in a release or public repository.

**Control and deletion:** pause native blocking or disable content hiding in settings; remove subscriptions to stop their future use. Removing entries does not undo completed X blocks. Uninstalling clears extension storage, while downloaded files and X blocks remain until you remove them yourself. The private JSON export backs up local entries only, not the complete extension state.

## 简体中文

账号条目、理由、证据链接、审核状态、允许名单、订阅链接、连接的账号用户名、采集结果、设置、队列和日志保存在当前浏览器的扩展存储，不使用 Chrome Sync。没有统计分析、遥测、自建服务端或自动上传。

插件读取 X 页面以隐藏内容、识别当前账号并执行你启用的原生拉黑。不读取或导出 Cookie、密码、认证令牌；浏览器操作已登录页面时，仍正常向 X 发送自己的会话信息。添加订阅时申请 `raw.githubusercontent.com` 的可选权限，只获取你添加的公开名单链接，不携带认证信息。GitHub 会收到 IP 地址等普通请求信息，无需 PAT。

导出仅在你操作时发生。可分享 JSON 包含已批准本地条目及理由/证据，排除允许名单，不含订阅条目、队列或日志。上传到公开仓库后这些内容会公开。完整本地 JSON/CSV 和私人原始导出可能含有私人条目，不得放进发行包或公开仓库。

可暂停拉黑、关闭隐藏、删除订阅。删除条目不解除已有 X 拉黑；卸载清除扩展存储，但不会删除已下载文件或解除 X 拉黑。私人 JSON 仅备份本地条目，并非整个插件状态。

## 日本語

アカウント、理由、根拠 URL、確認状態、許可リスト、購読 URL、接続アカウントのユーザー名、収集結果、設定、キュー、履歴をこのブラウザーの拡張機能ストレージに保存します。Chrome Sync は使用しません。アクセス解析、テレメトリー、独自サーバー、自動アップロードはありません。

X の画面を読み取り、投稿の非表示、ログイン中のアカウントの確認、有効にしたブロック操作を行います。Cookie・パスワード・認証トークンを読み出したり書き出したりしません。ブラウザーはログイン済み画面の通常動作として X にセッション情報を送ります。購読の追加時に `raw.githubusercontent.com` の任意権限を求め、追加した公開リスト URL だけを認証情報なしで取得します。GitHub には IP アドレスなど通常のリクエスト情報が届きます。PAT は不要です。

書き出しはユーザー操作時のみ行います。共有用 JSON には許可リストを除く承認済みローカル項目と理由・根拠が含まれ、購読項目・キュー・履歴は含まれません。公開リポジトリにアップロードした内容は公開されます。個人の元データや完全なローカル JSON/CSV を配布パッケージや公開リポジトリに含めないでください。

ブロックの一時停止、非表示の無効化、購読の削除が可能です。項目を削除しても X ブロックは解除されません。アンインストールで拡張機能内のデータは消えますが、ダウンロード済みファイルや X ブロックは残ります。非公開 JSON はローカル項目のみのバックアップです。
