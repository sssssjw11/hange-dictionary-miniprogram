# 微信开发工具与运行验收

应用内无需登录。开发工具的微信身份、Agent 连接授权、项目 AppID 是各自独立的条件，不会因为去掉应用登录页面就同时具备。

## 当前本地状态

2026-11-04，腾讯签名的开发工具 2.02.2609240，配套 `wechatide` skill CLI 0.3.11：

| 条件 | 已观察到的结果 |
| --- | --- |
| 本次 Codex 连接授权 | 原任务返回 `authorization_success`、`authorized: true` |
| 工具登录 | `check_wechatide_status` 返回 `loginExpired: true` |
| 项目 AppID | 公开配置为 `touristappid`；用户尚未提供实际 AppID |
| CLI 自动开窗 | 返回 `APPID_ERROR`：“不存在此 AppID 请检查后重新输入” |
| 旧版官方 CLI 备用入口 | `cli.bat open --project ...` 已连接授权后的本地端口，但同样返回 code 10、AppID 不存在 |
| 登录窗口 | 已实际打开扫码页，底部可见“游客模式”入口 |
| 模拟器与真机 | 尚未完成运行验收；编译或布局投影不计作运行验收 |

连接授权已经完成，不需要为同一次连接重复申请。登录请求虽然返回“Login window displayed”，其异步任务后续查询返回“Task not found”；没有把该返回当作登录完成，也没有在状态不明时重复发起登录。

## 没有 AppID 时

本机开发工具扫码页提供“游客模式”入口，可以由用户手动进入，再手动导入仓库根目录 `project.config.json` 所在的工程。源码的客户端目录为 `miniprogram/`，已包含生成后的解码库，不需要在工具中构建 npm。

本项目尚未实际验证游客模式下的完整启动、文件导入、录音或播放。若工具不接受该工程，应保留其实际错误；不要把其他项目的 AppID、随意生成的字符串或网上示例 ID 填入配置。

新版 `wechatide` CLI 要求真实可用的 AppID；`touristappid` 不能作为其自动开窗的有效项目身份。腾讯的[接入说明](https://docs.cloudbase.net/ai/cloudbase-ai-toolkit/tutorials/ai-develop-miniprogram)也明确列出这一条件。手动游客入口和 CLI 自动开窗应分别记录验收结果。

## 已有可用 AppID 时

先由用户完成开发工具扫码登录，确认该 AppID 属于当前工程或专用测试工程。再仅更新本地配置的 `appid` 字段，保留其余工程设置；公开分发继续使用占位配置。不要把 AppSecret、登录票据、CLI 令牌或 MCP Token 放进工程、日志、截图或公开仓库。

官方 CLI 可使用以下流程；`wechatide` 不在 PATH 时，使用本机安装目录里的入口绝对路径。以下命令不上传或发布代码：

```powershell
$dictionaryProject = (Get-Location).Path
wechatide -c codex check_wechatide_status --skill-version 0.3.11
# 仅在工具已登录、项目 AppID 有效后继续
wechatide -c codex open_project_window --project $dictionaryProject --window-mode liteMode
wechatide -c codex automation_runtime_info --project $dictionaryProject --action currentPage
```

若某一步返回需要用户交互的任务，记录原 taskId，查询原任务而非重复发起操作。工具登录、连接授权和隐私权限均由用户亲自处理。没有获得实际运行结果时，保留“未验收”状态。

## 运行验收清单

1. 启动及导航：首屏、五个 Tab、23 个页面、返回栈、重启后状态。
2. 完整牛津：一次选择同批三个私有 ZIP、校验与进度、中断重试、重启后离线查询、长词条分页、中文反查、移除后保留学习记录。
3. 学习记录：生词多重归属、笔记、分组练习、熟词回队列、连续播放、后台暂停及进度恢复。
4. 阅读与备份：点词、跨页批注、书签定位、完整备份分享与重新导入、失败时原数据保留。
5. 平台能力：相机和裁剪、麦克风、语音上传与播放、文件选择、软键盘、系统主题、安全区、小屏和平板。
6. 待配置服务：AI 和全文翻译明确显示待配置；离线查词不依赖模型服务。手机端网络另需有效 AppID、可访问服务和相应域名配置。

不要在获取这些实际证据前把状态改为“微信完全适配”。目前的其他检查及边界见 [验收记录](VERIFICATION.md) 与 [原 APK 功能对照](FEATURE_PARITY.md)。
