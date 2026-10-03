# 莱茵生命终端 v0.2.1 · 环境兼容与本地 AI 导入边界

基于 **LBEILC / RhineLabWallpaper** 修改，原网页项目 **LBEILC / RhineLabUI**。由 **zzz-mike** 独立发布，保留原作者 MIT 版权及第三方许可，不是原作者官方发行。

## 这次补充了什么

- 明确 Windows 纯展示、macOS 纯展示和 macOS 本地接入的环境边界，避免把 Mac 连接包当成 Windows 本地版。
- 随包提供本地 AI 资料导入适配器和环境检查命令；它只连接 `127.0.0.1`/`localhost`，不录音、不转录、不上传。
- 增加从本地录音 → 本地转录 → `.txt`/`.json` → AI 秘书原始资料的使用说明。没有本地 AI 时仍可直接使用纯展示版。

## 下载哪个包

- **RhineLabDisplay-v0.2.1.zip**：推荐普通用户。Windows / Mac 浏览器运行，保留画质、动画、内置档案与基础工作台，不附带本地文件接入服务。
- **RhineLabMacLocal-v0.2.1.zip**：仅 Mac。提供相同画面，以及默认关闭、需主动授权的文件夹和本机服务连接。文件选择器同时支持 Apple Silicon / Intel。
- **SHA256SUMS-v0.2.1.txt**：两份 ZIP 的 SHA-256 校验。

## 使用

安装 Node.js 22.12 或更新版本，解压所选包。Windows 双击 `Start-Windows.cmd`，Mac 双击 `Start-Mac.command`；也可运行 `node server.mjs`。浏览器自动打开；按 Ctrl+C 停止服务。Windows 的纯展示版不需要 AI 修改代码。

Mac 接入版先显示授权管理：用户选择具体目录后才读取，预览默认只读；文件打开、AI 秘书、光伏、媒体连接分别开启。“断开全部”撤销访问并清除本次缓存及预览令牌，重启服务后授权清空。个人文件、真实项目数据和凭据均不随发行包上传。

当前是本地浏览器运行包，不是 Windows 原生 exe 或 Apple 公证安装包。Mac 接入版尚未提供 Windows 文件接入；其外部服务和媒体工具需另外配置。系统文件权限与本软件的连接开关分别管理。

## 验证范围

本地共 110 项服务与内容测试通过，两份生产构建和 ZIP 完整性校验通过。Windows / macOS 的 CI 构建及展示服务检查通过。Mac 浏览器展示、授权页面默认关闭、选择结果回显与撤销状态已检查；未完成所有原生选择器交互及授权后文件浏览的端到端人工验证，也未实测 Windows 桌面交互或 Wallpaper Engine。

导入说明：`docs/LOCAL-AI-IMPORT.md`；原项目：https://github.com/LBEILC/RhineLabWallpaper
原作者：https://github.com/LBEILC
权限与运行说明：https://github.com/zzz-mike/RhineLabDesktop
