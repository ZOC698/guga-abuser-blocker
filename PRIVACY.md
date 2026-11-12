# Privacy · 隐私 · プライバシー

Version 0.1.2 preview · 2026-11-12

**Popup drafts:** management form drafts and navigation are retained in extension `storage.session` for the current browser session. Drafts stay in this browser and are not published. Connection outcomes are retained in local extension state so closing the popup does not hide a failed attempt.

**Script recovery:** `scripting` is used only to load the packaged content script and stylesheet into the selected X tab when its identity-message receiver is missing. It uses the existing X host permissions, does not read cookies, and does not retry block writes. The extension reads the Profile navigation and account avatar identifiers to verify the selected account.

## English

**Local data:** imported accounts and numeric IDs, reasons, evidence links, review status, exceptions, subscription URLs, connected account handle, capture results, settings, queue and activity are kept in this browser's extension storage. Chrome Sync is not used. The extension has no telemetry, analytics or developer server.

**Read-only subscriptions:** the extension reads the public GitHub Raw JSON URLs you add, without credentials. It has no GitHub write or public-list upload feature, does not accept a PAT, and does not send local entries to maintainers. GitHub receives normal request information, such as your IP address. Repository owners control publishing separately.

**X access:** the current queue reads and operates the signed-in X page, then reloads the target profile to check the observed result. It does not request your X password or developer API key. This DOM execution path does not read or export X authentication cookies or tokens; the browser sends its ordinary session information to X. The separate internal-API adapter is under independent validation and is not the default executor. Connecting an X account selects the queue's account; it is not developer OAuth authorization.

**Private backups:** JSON and CSV downloads occur only when requested and contain local entries. There is no shareable-public export. Backups can contain private accounts and evidence; keep them outside public repositories and release packages. These exports do not back up all settings, subscriptions or logs.

**Control and deletion:** pause blocking, disable content hiding or remove subscriptions. Removing an entry or subscription does not undo completed X blocks. Uninstalling clears extension storage; downloaded files and existing X blocks remain until you remove them yourself.

## 简体中文

账号和数字 ID、理由、证据链接、审核状态、白名单例外、订阅地址、绑定账号用户名、采集结果、设置、队列和操作记录保存在当前浏览器扩展存储，不使用 Chrome Sync。没有遥测、统计分析或开发者服务端。

订阅只有读取功能：以不带认证信息的请求读取你添加的公开 GitHub Raw JSON。扩展没有 GitHub 写入、公共名单上传功能，不接收 PAT，也不把本地条目发送给维护者。GitHub 会收到 IP 地址等普通请求信息；公共发布由仓库维护者独立控制。

当前队列读取并操作已登录的 X 页面，随后重新加载目标主页核对结果。无需提供 X 密码或开发者 API 密钥。该 DOM 执行路径不读取或导出 X 认证 Cookie 或令牌；浏览器仍正常向 X 发送会话信息。内部接口适配器单独验证中，尚非默认执行方式。「连接账号」用于选定队列账号，不是开发者 OAuth 授权。

私人 JSON / CSV 仅在用户主动导出时下载，包含本地条目，没有公共分享导出。私人备份可能包含账号及证据，不应放进公共仓库或发行包；它不是全部设置、订阅和日志的完整备份。

可以暂停拉黑、关闭隐藏或删除订阅。移除条目或订阅不解除已有 X 拉黑。卸载会清除扩展存储，但不会删除下载文件或解除 X 拉黑。

## 日本語

アカウントと数値 ID、理由、根拠リンク、確認状態、例外、購読 URL、接続アカウントのユーザー名、収集結果、設定、待機列、履歴をこのブラウザーの拡張機能ストレージに保存します。Chrome Sync、テレメトリー、アクセス解析、開発者サーバーは使用しません。

購読は読み取り専用です。追加した公開 GitHub Raw JSON を認証情報なしで取得します。GitHub 書き込みや公開リストのアップロード機能はなく、PAT を受け付けず、ローカル項目を管理者に送りません。GitHub には IP アドレスなど通常の通信情報が届きます。公開はリポジトリ管理者が別途管理します。

現在の待機列はログイン済みの X 画面を読み取り操作し、プロフィールを再読み込みして結果を確認します。X のパスワードや開発者 API キーの提供は不要です。この DOM 経路は X 認証 Cookie やトークンを読み出したり書き出したりしませんが、ブラウザーは通常のセッション情報を X に送ります。内部 API アダプターは別途検証中で、標準実行方式ではありません。アカウント接続は待機列の対象選択であり、開発者 OAuth 認可ではありません。

非公開 JSON / CSV は操作時だけダウンロードされ、ローカル項目を含みます。公開用書き出しはありません。個人のアカウントや根拠を含む可能性があるため、公開リポジトリや配布物には含めないでください。設定・購読・履歴の完全なバックアップではありません。

ブロックの一時停止、非表示の無効化、購読の削除ができます。項目・購読を削除しても X ブロックは解除されません。アンインストールで拡張データは消えますが、ダウンロード済みファイルと X ブロックは残ります。
