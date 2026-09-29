# 莱茵生命终端 · RhineLabDesktop

基于 **[LBEILC](https://github.com/LBEILC)** 的 **[RhineLabWallpaper](https://github.com/LBEILC/RhineLabWallpaper)** 修改，由 **[zzz-mike](https://github.com/zzz-mike)** 维护和发布的 Mac 本地桌面工作台版本。原网页项目为 [RhineLabUI](https://github.com/LBEILC/RhineLabUI)。本版本不是原作者的官方发行版。

保留原项目的三维档案阵列、开场动画与交互，加入 Mac 画面设置、组件布局编辑、任务分类与分页，以及本地桌面文件、AI 秘书和光伏监测服务的连接代码。

![原项目三维档案界面](RhineLabWallpaper/docs/media/archive.jpg)

*上图来自原项目，展示三维档案界面；并非本修改版新增组件的截图。*

## 来源与许可

- 原作者：**LBEILC**；原仓库：[LBEILC/RhineLabWallpaper](https://github.com/LBEILC/RhineLabWallpaper)。
- 本地来源记录的上游提交：`ae2b2434ae18585aaf32458d9e9f9aaaa480ce56`；详见 [来源记录](RhineLabWallpaper/SOURCE-PROVENANCE.json)。这是本地修改快照，不包含上游完整 Git 历史。
- 保留 **MIT License** 与 `Copyright (c) 2026 LBEILC`，详见 [LICENSE](LICENSE) 和 [ATTRIBUTION.md](ATTRIBUTION.md)。
- 字体、第三方库及资源声明见 [THIRD-PARTY-NOTICES.txt](RhineLabWallpaper/public/THIRD-PARTY-NOTICES.txt)。发行包不包含本机单独授权的 Novecento 字体二进制。
- 《明日方舟》相关名称、标志、角色及世界观归原权利方所有；本项目为非官方同人作品。

## 运行

需要 **Node.js 22.12 或更新版本**、npm，以及支持 WebGL 2 的浏览器。桌面文件操作和原生窗口面向 macOS；原生应用构建脚本面向 Apple Silicon / macOS 14 或更新版本。

```sh
git clone https://github.com/zzz-mike/RhineLabDesktop.git
cd RhineLabDesktop/RhineLabWallpaper
npm ci
npm run build:wallpaper
cd ..
node mac/server.mjs
```

打开 **http://127.0.0.1:5180/?mac=1**。服务器只监听本机地址；终端按 `Ctrl+C` 停止。若 5180 端口已被其他程序占用，先处理端口冲突。

[Releases](https://github.com/zzz-mike/RhineLabDesktop/releases) 的完整快照包附带预构建网页，解压后可直接在根目录运行 `node mac/server.mjs`；它仍需要自行安装 Node.js。源码 ZIP 需要先按上面步骤构建。

## 本地数据与功能边界

- 三维档案和内置主题资源随项目提供；偏好设置保存在本地浏览器中。
- 桌面文件功能读取当前用户的 Desktop，文件打开等操作由本机桥接处理。只在了解这些功能时启动服务，保持仅本机访问。
- AI 秘书和光伏组件需要独立运行、接口兼容的本地服务。这里发布的是连接代码，不包含这些后端及其数据；未配置时相关组件可能显示不可用。
- 媒体信息依赖本机媒体集成能力，缺失时不保证能够读取。
- 发布内容不包含个人桌面文件、真实项目资料、业务数据、日志、凭据或本机依赖缓存。
- 组件布局与本地交互已存在于此修改快照；持续性能、所有快捷键和真实 Wallpaper Engine 环境仍需在使用者设备上验证。

## 可选：构建 Mac 独立窗口

安装 Apple Command Line Tools 后，在仓库根目录执行：

```sh
mkdir -p .runtime/node-v22.22.0-darwin-arm64/bin
ln -s "$(command -v node)" .runtime/node-v22.22.0-darwin-arm64/bin/node
zsh mac/app/build.sh
open 莱茵生命终端.app
```

应用记录当前仓库路径，因此移动文件夹后需要重新构建。当前提供原生窗口源码；没有发布经过 Apple 公证的可安装应用。

## 验证与目录

```sh
cd RhineLabWallpaper
npm run check:content
npm run build:wallpaper
cd ..
node --test mac/*.test.mjs
```

- `RhineLabWallpaper/`：前端源码、主题资源、原项目文档和构建脚本。
- `mac/`：本地服务、桌面/媒体/数据桥接及测试。
- `mac/app/`：Cocoa + WebKit 原生窗口源码及构建脚本。

`RhineLabWallpaper/README.md` 和其中的历史文档来自原项目，包含原作者的在线体验、创意工坊、下载地址及历史验证说明；它们不代表本仓库的发行渠道或本轮验证结果。本修改版的入口与限制以当前 README 为准。
