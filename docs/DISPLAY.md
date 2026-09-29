# 莱茵生命 · 纯展示版 v0.2.0

适用于 Windows / macOS 的浏览器版本。包含修改后的画质设置、三维档案、开场动画与基础工作台，不包含桌面文件读取服务，也不会接入 AI 秘书、光伏或本机媒体信息。

## 启动

1. 从 https://nodejs.org/ 安装 Node.js 22.12 或更新版本。
2. 解压整个 `RhineLabDisplay` 文件夹。
3. Windows 双击 `Start-Windows.cmd`；Mac 双击 `Start-Mac.command`。也可在文件夹里运行 `node server.mjs`。
4. 默认浏览器会打开 http://127.0.0.1:5190/?display=1 。建议使用支持 WebGL 2、启用硬件加速的 Chrome 或 Edge。
5. 关闭时，在启动窗口按 Ctrl+C。不要只双击 web/index.html。

不需要 AI、不需要账号或 API Key；Node.js 用于运行仅提供包内网页的本机服务器。基础工作台中的内置事项是示例，可使用档案展示模式；不是从电脑文件或在线服务读取的真实事项。

没有本地文件权限开关，因为此包不附带文件接入服务。更改网址参数也不能开启桌面读取功能。

Windows 的网页服务与路径边界由 Windows CI 验证；本次发布的浏览器视觉检查在 Mac Chrome 完成，未声称已验证所有 Windows 显卡或原生桌面壁纸宿主。本包不是 Windows 原生 .exe，也不是 Mac .app。

## 来源

修改版由 zzz-mike 发布，基于 LBEILC/RhineLabWallpaper；原网页项目 LBEILC/RhineLabUI。保留 MIT 版权与第三方许可。来源见 ATTRIBUTION.md，完整源码及更新：https://github.com/zzz-mike/RhineLabDesktop 。
