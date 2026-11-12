# Guga Abuser Blocker · 0.1.0

[English](README.en.md) · [日本語](README.ja.md)

面向 Guga 同好的 Chrome / Edge 扩展：导入并审核账号名单，订阅社区名单，在 X 隐藏匹配内容，并按你的设置执行 X 原生拉黑。界面支持中文、日文、英文。首次使用不附带账号名单，自动拉黑默认关闭。


## 仓库与订阅

[下载 v0.1.0 测试版](https://github.com/ZOC698/guga-abuser-blocker/releases/tag/v0.1.0) · [公开名单](lists/guga-blocklist.json) · [名单维护流程](CONTRIBUTING.md)

**公开名单目前为 0 条，尚无屏蔽效果，等待第一批审核通过的账号。** 私人待审核候选不上传到此仓库。数字 ID 后续补齐，当前先支持用户名。

在扩展的「名单订阅」中粘贴固定地址：

```text
https://raw.githubusercontent.com/ZOC698/guga-abuser-blocker/main/lists/guga-blocklist.json
```


## 安装

1. 解压发行包，保留整个文件夹。
2. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
3. 打开「开发者模式」，选择「加载已解压的扩展程序」，选中直接包含 `manifest.json` 的 **extension** 文件夹。
4. 刷新已经打开的 X 标签页。点击扩展图标进入管理界面；可在侧栏切换语言。

需要 Chromium 120 或更新版本。这是本地加载版，尚未上架浏览器商店。更新时替换扩展文件并在扩展管理页点击重新加载，然后刷新 X。

## 导入你的名单

在「账号库」导入 TXT、CSV 或 JSON，或粘贴 `@用户名`。先预览，再导入。**所有文件导入和页面采集结果都进入待审核状态**，即使文件写有 `approved` 也不会直接生效。选择你已核实的 Guga 相关账号，补充理由和证据，再点击「批准所选」。不要把完整私人屏蔽名单直接作为社区名单。

也可先打开 [X 的 Blocked accounts](https://x.com/settings/blocked/all)，回到账号库启动采集，结束后点击「导入采集结果」。自动滚动只收集 X 实际加载的账号；停止滚动或显示空闲不代表已经导出全部名单。每次新采集建立新的账号绑定快照。

## 订阅与拉黑

1. 在「订阅」添加可信维护者提供的公开 GitHub Raw JSON 链接，并允许访问 `raw.githubusercontent.com`。订阅不需要 GitHub 账号、PAT 或 X API 密钥。
2. 订阅即信任该名单的条目，订阅条目无需逐条本地审核。可手动刷新；浏览器运行且设备唤醒时，也会约每 6 小时检查更新。
3. 打开已登录的 X，在「设置与帮助」连接要使用的 X 账号。
4. 开启「自动 X 拉黑」后，现有及后续新增的有效条目进入队列。也可在「动态」中手动启动队列。操作间隔至少 30 秒，可调到 300 秒；保持浏览器运行和专用 X 标签页打开。

本地内容隐藏与 X 原生拉黑是独立功能。允许名单优先于订阅，排除未来的隐藏和拉黑；移除订阅、移除条目或加入允许名单**不会解除已经完成的 X 拉黑**。在 X 自行解除。队列可随时暂停；已经提交给 X 的操作无法撤回。

## 分享给日美同好

在账号库导出「可分享 JSON」，得到 `guga-blocklist.json`。它只包含**已批准的本地条目**，排除允许名单；不会转发订阅来源条目。先检查文件，再手动上传到你维护的公开 GitHub 仓库，将该文件的 Raw 链接发给订阅者，例如：

```text
https://raw.githubusercontent.com/ZOC698/guga-abuser-blocker/main/lists/guga-blocklist.json
```

以后用新的可分享 JSON 更新同一路径，订阅者下次刷新时取得更新。插件没有自动上传或仓库写入功能。**私人原始导出、私人备份和个人完整屏蔽名单不得打包到发行包或上传到公共仓库。** 名单中的理由与行为指控由维护者审核，不是插件自动查证的事实。

## 当前边界

- 0.1.0 使用本地模拟页面和测试验证逻辑；尚未验证已登录真实 X 上的完整拉黑流程。X 页面变动、账号切换、目标身份不明确或操作结果无法确认时会停止队列。先查看「动态」和 X 实际状态，再重试。
- 以当前用户名定位账号；提供数字 ID 时，原生拉黑会固定并核对该 ID，无法核对或不一致时停止。不会自动解析改名，也不保证仅凭用户名能识别账号转让。本地内容隐藏仍按用户名匹配。
- 鸟盾的纯数字 ID 文件不能直接导入，需先补充当前用户名。格式及限制见 [DATA_FORMAT.md](DATA_FORMAT.md)。
- 「私人备份 JSON」和 CSV 包含本地条目，不是全部设置/订阅/日志备份；重新导入仍需审核。卸载会清除扩展存储，不会撤销 X 拉黑。

灵感来自「推特鸟盾」的共享名单模式。原作者[商店页](https://chromewebstore.google.com/detail/twitter-bird-shield/igapbfjkbkmjcmgjmgfcegamhkfppdmg)描述了 GitHub 名单共享，[数据仓库](https://github.com/free-spirit-dev/bird-shield-blocking)提供分类数字 ID 文件。本扩展独立实现，没有复制其源码、图标或名单，也不声称双向格式兼容。

[隐私说明](PRIVACY.md) · [数据格式](DATA_FORMAT.md)
