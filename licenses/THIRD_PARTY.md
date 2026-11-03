# 第三方声明

内置 ECDICT 和 WordNet 内容各自适用对应声明。牛津词库不随源代码提供，也不属于项目 MIT 许可。

客户端解码包由以下组件构建；全部保留各组件的许可证文件：

| 组件 | 用途 | 声明 |
| --- | --- | --- |
| fflate | zlib 解码与 UTF-8 | [LICENSE](fflate-LICENSE.txt) |
| @noble/hashes | SHA-256 完整性校验 | [LICENSE](noble-hashes-LICENSE.txt) |
| htmlparser2 | 词库 HTML 解析 | [LICENSE](htmlparser2-LICENSE.txt) |
| domhandler | HTML 树 | [LICENSE](domhandler-LICENSE.txt) |
| domutils | HTML 节点工具 | [LICENSE](domutils-LICENSE.txt) |
| domelementtype | 节点类型 | [LICENSE](domelementtype-LICENSE.txt) |
| dom-serializer | 传递依赖 | [LICENSE](dom-serializer-LICENSE.txt) |
| entities | HTML 实体解码 | [LICENSE](entities-LICENSE.txt) |

构建与测试工具由 npm 安装，只用于开发，不进入小程序。配套 Python 依赖、Windows 系统语音及自行安装的 OCR、PDF、语音模型分别适用其自身许可。模型权重与媒体文件没有打包到公开源代码。
