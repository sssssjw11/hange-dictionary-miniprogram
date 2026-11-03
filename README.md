# 涵词典 · 微信小程序

原生微信小程序词典，使用 **WXML / WXSS / JavaScript**，支持英文与短语查词、中文释义反查、完整长词条分页、生词本、笔记和历史记录。

无需登录，不获取头像、手机号、相机、录音或定位。生词本、笔记和历史只存微信本机缓存。全量词库服务仅接收查询词，不接收学习记录。

## 运行方式

### 1. 直接导入微信开发者工具

导入本仓库根目录，即包含 `project.config.json` 的目录。项目使用 `miniprogramRoot: miniprogram/`，服务端、文档和测试不会进入小程序代码包。客户端无运行时 npm 依赖，无需先构建 npm。

AppID 默认是 `touristappid`，用于无账号的本地工程调试。若当前工具不提供游客模式，使用自己的小程序测试号或 AppID。**真机预览、上传和发布需要你自己的有效 AppID**；仓库没有账号密钥或可用于发布的身份。

主界面有“查词 / 生词本 / 记录”三个原生 Tab，另有词条与阅读设置页面。公开代码内置 **97 个开源或原创词条和 195 条词形索引**。服务未连接时可查内置内容；已经从服务获取的完整词条可从缓存重看。

### 2. 启动全量词库服务

环境：Python 3.11+。在仓库根目录运行：

```powershell
python -m pip install -r server/requirements.txt
python server/app.py
```

默认只监听 `127.0.0.1:18748`。Windows 也可运行：

```powershell
.\start-local.ps1
```

服务使用自行配置的只读 SQLite 数据：

```text
server/data/                 # 整个目录被 Git 忽略
├── dictionary.db           # 可选，ECDICT + WordNet 的转换数据库
└── oxford/
    └── oxford.db           # 可选，自行提供的 MDX 转换数据库
```

在本项目原有本地工作区中，会自动复用相邻 `../output/` 中已转换的词库。克隆公开仓库后不会附带这些私有数据。也可以指定其他数据目录：

```powershell
python server/app.py --data-dir ./my-private-data
```

在小程序“阅读设置 → 全量词库服务”中保存服务地址并检查连接。微信开发者工具调试本机 HTTP 接口时，可临时勾选“不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书”；项目默认保留域名校验，正式配置应使用 HTTPS 和合法 request 域名。

手机预览不能使用电脑的 `127.0.0.1`。同一局域网调试可运行 `python server/app.py --host 0.0.0.0`，在手机小程序设置中填写电脑的局域网 IP，例如 `http://192.168.1.20:18748`；确保手机能访问该端口。正式使用应配置自己的 HTTPS 服务。

### 3. 导入自行提供的 MDX

本仓库不包含牛津正文、MDX、MDD、原 APK 或签名文件。可使用自己的本地资源进行转换：

```powershell
python -m pip install mdict-utils==1.3.14
python scripts/import_mdx.py ./my-dictionary/oald10.mdx
python server/app.py
```

导入会生成 `server/data/oxford/oxford.db`，保存全部正文及跳转索引，建立检索索引并检查数据库完整性；已有数据库不会被覆盖。可以通过 `--output` 指定新文件。仅有牛津数据库时也能查询，补充库为可选项；完整中文反查需要补充库，单独 MDX 的中文反查仅覆盖原创学习说明。

服务读取本地文件，不下载出版社内容。没有 MDD 时不显示缺失的音频、插图。Android 的系统离线 TTS 不能直接迁移到微信，本版未加入语音服务。

## 微信适配

- 原生页面、原生导航和 TabBar，使用 `rpx` 及安全区间距。
- 使用微信 `rich-text` 的节点数组，将原词库自定义标签转换为受支持节点。脚本、事件处理器、远程媒体不执行；文字、双语释义、例句和用法保留。
- 词条在服务端按完整节点分段；客户端每次只更新四段，分页可以访问全部正文。关联词通过原生按钮继续查询。
- `setData` 不传整份长词条，完整结果保留在逻辑层并缓存。以现有 `run` 词条为例，25 段分为 7 页，每次数据更新约 79 KB。
- 本地学习数据与查词缓存分开。查词缓存控制在约 4 MB、最多 30 条；过大的单词条不写缓存。清理查词缓存、清空历史均不删除生词本或笔记。
- 跟随系统 / 浅色 / 深色，三档阅读字号。
- JSON 生词本格式兼容本地 Android 版本；导入保留已有词条和笔记，不覆盖。同一次最多 2,000 条、1 MiB，超过缓存容量会明确失败并保持原数据。
- 用户主动操作时才选择、复制或分享备份文件；没有自动上传或账号同步。

## API

| 请求 | 用途 |
| --- | --- |
| `GET /api/health` | 当前配置的数据与服务状态 |
| `GET /api/suggest?q=subo` | 输入联想，优先牛津正文词条 |
| `GET /api/lookup?q=run` | 完整分义、例句、富文本节点、词形和关联词 |

返回 `kind: entry / matches / missing`。SQL 参数化，数据库以只读方式打开。默认访问日志不记录查询词。此服务不提供用户、生词本或支付接口。

Docker 可从仓库根目录构建，挂载自己的私有数据目录：

```sh
docker build -f server/Dockerfile -t hange-dictionary .
docker run --rm -p 127.0.0.1:18748:18748 -v /your/private/data:/data:ro hange-dictionary
```

镜像不会包含私有词库。对外使用时在服务前配置 HTTPS。

## 验证

Node.js 22+ 用于开发检查，客户端本身不依赖 Node：

```sh
npm ci --ignore-scripts
npm run check
npm test
python tests/test_server.py
```

`npm run check` 使用微信官方 `miniprogram-compiler` 的 wcc/wcsc 包装器检查 WXML/WXSS，并核对页面、图标、事件绑定、JavaScript 与代码包体积。测试包含官方 WXML 生成器的数据绑定和条件分支、学习记录持久化、备份合并与容量失败，以及长正文不丢失的转换检查。

有本地完整词库并启动服务后，可追加真实数据联调：

```powershell
$env:HANGE_TEST_API = 'http://127.0.0.1:18748'
npm test
```

没有私有词库时，公开 CI 会运行通用转换、存储及模板测试，跳过依赖私有数据的联调。**已做编译与模拟微信 API 的控制器测试，尚未在微信开发者工具模拟器或手机上运行**；这些检查不能替代微信客户端的真机验证。

微信官方参考：[代码包限制](https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages.html)、[网络域名配置](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)、[富文本节点](https://developers.weixin.qq.com/miniprogram/dev/component/rich-text.html)、[本地存储限制](https://developers.weixin.qq.com/miniprogram/dev/api/storage/wx.setStorageSync.html)。

## 许可与数据边界

原创源代码、图标和原创学习说明使用 MIT 许可。97 条内置内容来自 ECDICT、WordNet 及原创说明，分别保留 [ECDICT 声明](licenses/ECDICT-LICENSE.txt) 和 [WordNet 声明](licenses/WordNet-LICENSE.txt)。牛津内容不包含于本仓库，MIT 许可不覆盖牛津数据。私有数据库、APK、签名、开发者工具个人配置和运行记录均由 `.gitignore` 排除。
