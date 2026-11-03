# 私有词库与本地服务

## 数据目录

```text
server/data/                  # Git 和 Docker 均排除
  dictionary.db              # 可选的 ECDICT / WordNet 补充数据库
  oxford/
    oxford.db                # 自己的 MDX 转换结果，查询时只读
    chinese.db               # 对应源指纹的中文反查索引
server/models/               # 可选的 Vosk 模型，排除于版本控制
server/runtime/              # 本地生成的语音文件，排除于版本控制
server/.optional-python/     # 可选私有依赖目录，排除于版本控制
output/                      # 离线分卷、测试报告、布局投影，全部排除
```

服务也接受 `--data-dir` 或 `HANGE_DICT_DATA_DIR`。原本地工作区可自动复用相邻 `../output/` 的已有数据；克隆 GitHub 仓库不会取得私有数据库。

## 微信完整离线包

将原始 MDX 逐条转换，保留所有正文和跳转；离线包对相同正文去重，建立分块随机访问索引、前缀联想和中文二字索引。单数据文件小于 48 MiB，当前完整数据解压约 126.4 MiB。三份 ZIP 分别解压到同一个暂存目录，核对所有大小及 SHA-256 后才提交。

本地用户文件与缓存文件的总额受微信容量限制。当前官方文档为 200 MB；本项目把词库生成预算限制在 180 MiB，实际包约 126.4 MiB。学习数据每类最多 2 MiB，使用两个文件槽轮换提交；导出的备份也会占用用户文件空间。空间不足时导入或写入会明确报错，请先把备份保存到自行选择的位置并整理空间。

完整分卷只在本地交付。手机应一次选择索引卷和所有数据卷；不要混用不同构建版本。合并的大 ZIP 供电脑留存，手机优先选择三个较小分卷。更新时先在应用中移除旧词库；生词、笔记、历史和学习进度独立保存。

微信在导入过程中退出时，重新导入会清理仅属于本应用词库的未完成暂存目录，避免重复占用空间；不会清理学习文件。页面关闭后再次进入，也能查看当前进程内继续执行的导入进度。

中文反查基于中文释义、用法及例句找相应英文词条。它不是独立的汉英出版社词典，也不执行机器翻译。完整离线反查至少输入两个汉字，每次最多显示 40 项。服务器安装 `chinese.db` 后也可只依靠牛津数据库反查，不要求补充词库。

## OCR、语音与 PDF

基础安装只需要 `server/requirements.txt`。完整可选服务可在自己的 Python 虚拟环境安装：

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r server/requirements.txt -r server/requirements-media.txt
.venv\Scripts\python.exe scripts/setup_speech_models.py
.venv\Scripts\python.exe server/app.py
```

已有解释器也可把可选依赖安装到私有目录；服务会识别该目录：

```powershell
python -m pip install --target server/.optional-python -r server/requirements-media.txt
```

| 能力 | 实现 | 输入范围与实际限制 |
| --- | --- | --- |
| OCR | RapidOCR + ONNX Runtime，服务器本地推理 | 图像最多 8 MiB、20 MP；服务器缩放至 2400 边长后识别，结果需核对 |
| 语音识别 | Vosk small EN-US 0.15 / CN 0.22 + FFmpeg | WAV、最多 10 MiB、60 秒；英语识别链路已实测；不是云识别或长录音字幕服务 |
| 朗读 | Windows System.Speech / SAPI，必要时 FFmpeg 转 MP3 | 每次 1～2500 字；实际音色由系统安装情况决定；Linux 默认不可用 |
| PDF | PyMuPDF | 含文本 PDF，最多 10 MiB、200 页；不支持加密或直接提取扫描页文字 |
| EPUB | ZIP/OPF/spine 顺序解析，保留正文 | 最大 10 MiB、解压内容 40 MiB、总正文 80 万字；不运行书内脚本，不处理 DRM |
| 本机阅读 | 微信用户文件 | 单篇最多 20 万字、100 篇；长书按章节导入，正文数据达到 2 MiB 会提示容量不足 |

Windows 上模型所在目录如果含中文，服务先尝试短路径，再使用仅指向所选模型的任务临时目录联接；不会移动原始模型。也可自行设置英文模型根目录：`HANGE_VOSK_MODEL_ROOT`。

Vosk 模型来自 [官方模型清单](https://alphacephei.com/vosk/models)；OCR 实现参考 [RapidOCR 官方项目](https://github.com/RapidAI/RapidOCR)。本仓库不附带权重。当前本地工作区已安装中英 Vosk 模型和可用 OCR，但这些依赖不随公开源码上传。

## AI / 全文翻译：当前待配置

客户端没有模型密钥输入框；密钥只放在配套服务的环境中。没有配置时 `/api/assistant` 返回明确的 HTTP 503，页面禁用发送，不提供预设“AI 答案”或假译文。

| 服务端环境变量 | 用途 |
| --- | --- |
| `HANGE_AI_BASE_URL` | 自行提供的兼容模型接口根地址，包含需要的 `/v1` 等前缀 |
| `HANGE_AI_MODEL` | 实际模型名称 |
| `HANGE_AI_API_KEY` | 可选，只存服务端，不能提交到 Git |
| `HANGE_AI_MAX_TOKENS` | 输出上限，默认 2048；达到上限时页面显示未完整结束 |

适配器请求 `POST {BASE_URL}/chat/completions`，支持学习问答、词句讲解、写作批改、阅读摘要与全文翻译；单次最多 20 条消息、总输入 16000 字符。输入点击发送后才传给已配置模型。当前没有模型服务，调用真实提供方的结果、中文长文本质量和长输出完整性尚未验收。

## 本地 API

| 方法 / 路径 | 用途 |
| --- | --- |
| `GET /api/health` | 词库、版本及中文索引状态 |
| `GET /api/suggest?q=` | 前缀联想 |
| `GET /api/lookup?q=` | 完整正文、分义、例句、音标、关联词 |
| `GET /api/capabilities` | OCR / TTS / ASR / AI / 翻译 / 文档的真实可用性 |
| `POST /api/tts` | JSON 请求实际合成语音 |
| `GET /api/audio/{name}` | 生成的音频，支持 Range |
| `POST /api/ocr`、`/api/asr` | multipart 的 `file`；语音可携带 `language` |
| `POST /api/document` | multipart 的 `file` 和 `filename`，提取用户文档 |
| `POST /api/assistant` | JSON 模型请求，未配置则 503 |

服务默认只绑定本机地址。日志不记录查询词、正文或输入消息；不会自动接收生词笔记。局域网监听需显式使用 `--host 0.0.0.0`。Docker 基础镜像只带查询与文本解析，不包含 Windows 语音、模型或私有数据；使用自己的挂载与 HTTPS 配置后再用于其他设备。
