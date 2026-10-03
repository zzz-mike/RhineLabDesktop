# 莱茵生命终端 · RhineLabDesktop

基于 **[LBEILC](https://github.com/LBEILC)** 的 **[RhineLabWallpaper](https://github.com/LBEILC/RhineLabWallpaper)** 修改，由 **[zzz-mike](https://github.com/zzz-mike)** 维护和发布。原网页项目：[RhineLabUI](https://github.com/LBEILC/RhineLabUI)。这是独立修改版，不是原作者官方发行。

## 选择下载版本

**[前往 Releases 下载 v0.2.1](https://github.com/zzz-mike/RhineLabDesktop/releases/tag/v0.2.1)**

| 下载包 | 支持系统 | 本地文件访问 |
| --- | --- | --- |
| **RhineLabDisplay-v0.2.1.zip**（推荐） | Windows / macOS，浏览器运行 | 不带文件接入服务；保留画质、动画、内置档案和基础工作台 |
| **RhineLabMacLocal-v0.2.1.zip** | macOS 12+，Apple Silicon / Intel，浏览器运行 | 默认关闭；系统选择窗口授权具体目录后才读取 |

两个包共用画质与交互源码。纯展示包不附带 Mac 桥接代码，改网址参数不能开启文件访问。Mac 接入包默认关闭目录、文件打开、AI 秘书、光伏和媒体连接，分别由用户开启；停止服务后授权清空。

Windows 用户不需要 AI 改代码：安装 Node.js，下载纯展示包即可使用。Mac 接入版的文件选择、打开文件和访达定位尚未适配 Windows；不要把它当作 Windows 完整版。若要把本地录音或转录资料交给本机 AI，请先看[本地 AI 与录音资料导入说明](docs/LOCAL-AI-IMPORT.md)；随包提供的导入适配器只连接本机回环地址，不负责录音或转录。

## 普通用户启动

1. 从 **[Node.js 官网](https://nodejs.org/)** 安装 Node.js 22.12 或更新版本。
2. 下载并解压所选版本。
3. Windows 双击 `Start-Windows.cmd`；Mac 双击 `Start-Mac.command`。也可以在解压文件夹中运行 `node server.mjs`。
4. 浏览器会自动打开。纯展示版端口为 5190；Mac 接入版为 5191，先进入“本地连接”页。
5. 启动窗口保持运行；按 `Ctrl+C` 停止。不要直接双击网页文件。

详情：[纯展示版说明](docs/DISPLAY.md) · [Mac 接入版说明](docs/MAC-LOCAL.md)

推荐使用支持 WebGL 2、启用硬件加速的 Chrome 或 Edge。当前下载包是浏览器运行包，不是 Windows `.exe` 或经过 Apple 公证的 Mac `.app`。Node.js 提供仅本机可访问的服务，不需要 AI、账户或 API Key。

## Mac 接入如何授权

“本地连接”始终可从界面进入。未授权时显示内置档案，不扫描桌面。

- 点击“选择并授权文件夹”，在系统选择窗口确认具体目录；取消不改变授权。
- 授权读取文件名、目录与预览内容。默认关闭外部文件打开；如需在其他应用打开或访达定位，再单独启用。
- AI 秘书、光伏和媒体分别有开关，需自行配置兼容的本机服务。程序不会自动调用模型，也不会因接入文件夹而读取秘书的摘要索引。
- “断开全部”撤销所有连接，清除本次目录与预览缓存/令牌，并终止正在返回的数据。其他莱茵页面会刷新；已在外部应用中打开的文件不会被强制关闭。
- 授权只在本次服务进程内存中保存，重启全部关闭。不提供删除、移动或修改原文件的接口，不自动上传文件。

当前使用软件目录边界和 macOS 自身权限控制，**不是 macOS 沙盒应用**。系统提示所显示的进程名称取决于启动方式；无需开放完全磁盘访问。若系统阻止选择器运行，应先核验来源或使用纯展示版，不必关闭安全保护。

## 来源与许可

- 原作者：**LBEILC**；原仓库：[RhineLabWallpaper](https://github.com/LBEILC/RhineLabWallpaper)。
- 上游来源记录的提交：`ae2b2434ae18585aaf32458d9e9f9aaaa480ce56`，详见 [来源记录](RhineLabWallpaper/SOURCE-PROVENANCE.json)。本仓库从本地修改快照建立，不包含完整上游 Git 历史。
- 保留 **MIT License** 和 `Copyright (c) 2026 LBEILC`，见 [LICENSE](LICENSE)、[ATTRIBUTION.md](ATTRIBUTION.md)。
- 字体、第三方库和资源声明见 [THIRD-PARTY-NOTICES.txt](RhineLabWallpaper/public/THIRD-PARTY-NOTICES.txt)。不分发本机单独许可的 Novecento 字体二进制。
- 《明日方舟》名称、标志、角色与世界观归原权利方所有；这是非官方同人项目。

![原项目三维档案界面](RhineLabWallpaper/docs/media/archive.jpg)

*图片来自原项目，展示三维档案；不是本版权限页或新组件截图。*

## 从源码构建

```sh
git clone https://github.com/zzz-mike/RhineLabDesktop.git
cd RhineLabDesktop/RhineLabWallpaper
npm ci
npm run build:wallpaper
cd ..
```

默认构建 Mac 接入前端，未授权时保留内置档案。在 Mac 上先 `sh tools/build-picker.sh` 编译系统文件夹选择器，再 `node mac/server.mjs`；打开 `http://127.0.0.1:5191/connections`。源码构建选择器需要 Apple Command Line Tools；Release 包已附带选择器。

在 Mac 上构建两个完整发行包：

```sh
sh tools/build-picker.sh
node tools/build-releases.mjs
```

输出在 `release/`，包括两个 ZIP 和 SHA-256 校验文件。纯展示前端通过构建参数 `RHINE_EDITION=display` 固定关闭本地访问；Windows CI 用该参数构建和验证网页服务器。

```sh
node --test tests/*.test.mjs mac/*.test.mjs
cd RhineLabWallpaper
npm run check:content
```

`.github/workflows/verify.yml` 在 Windows 和 macOS 检查展示服务器、内容与前端构建，并在 macOS 检查授权及桥接。浏览器画面、系统选择窗口及不同硬件表现需与自动化检查分开看待。

`RhineLabWallpaper/` 中保留原项目历史文档和链接；本修改版的版本选择、权限和启动方法以当前 README 为准。v0.1.0 和 v0.2.0 属于旧的默认接入快照，新用户请使用 v0.2.1。
