# 莱茵生命终端 · 首次公开修改快照

发布日期：2026-09-30；版本：v0.1.0。

基于 **LBEILC / RhineLabWallpaper** 修改，原网页项目为 **LBEILC / RhineLabUI**。保留 MIT 许可证与原作者版权声明。本版本由 **zzz-mike** 独立发布，不是原作者官方发行。

本次公开现有 Mac 本地版本：三维档案界面、Mac 画面控制、桌面组件布局与分页、任务分类，以及桌面文件/媒体/AI 秘书/光伏数据桥接。具体功能以源码与 README 的依赖说明为准。

## 下载与运行

下载 `RhineLabDesktop-v0.1.0.zip`，解压后在 `RhineLabDesktop` 目录运行 `node mac/server.mjs`，浏览器打开 `http://127.0.0.1:5180/?mac=1`。需要 Node.js 22.12 或更新版本。完整快照 ZIP 包含预构建网页、源码和 Mac 本地服务；GitHub 自动生成的源码包不含预构建网页，需要先执行 README 的构建步骤。

原生 Mac 窗口提供源码和构建方法，尚未提供经过 Apple 公证的安装包。AI 秘书、光伏与媒体信息取决于独立本地服务，不包含其后端、账号或业务数据。

## 本轮验证

- TypeScript 检查与生产壁纸构建通过；构建含 1070 个清单条目。
- 18 项内容测试、78 项本地桥接测试通过。
- 独立本地端口的健康接口、静态资源、文件清单和来源/许可证检查通过。
- Chrome 实际页面完成加载并进入桌面工作台；本轮没有声称全面验证每项交互或真实 Wallpaper Engine。
- 发布文件按白名单整理，并完成文本中的凭据、个人绝对路径和已知业务名称检查；不包含本地日志、真实数据、依赖缓存或单独许可字体。

原项目：https://github.com/LBEILC/RhineLabWallpaper
原作者：https://github.com/LBEILC
完整来源说明见仓库 ATTRIBUTION.md。
