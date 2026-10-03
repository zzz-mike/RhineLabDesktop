# 本地 AI 与录音资料导入

这个页面先说明当前版本能做什么，再说明怎样把本地录音或转录资料交给 AI 秘书。模型、录音工具和用户资料不会随莱茵生命安装包一起上传，也不会因为打开桌面终端就自动读取。

## 先选对运行环境

| 环境 | 档案与画质 | 读取本地文件 | AI 秘书/录入 | 适合谁 |
| --- | --- | --- | --- | --- |
| Windows + `RhineLabDisplay` | 支持 | 不支持 | 不支持 | 先看画面、动画和内置工作台 |
| macOS 12+ + `RhineLabDisplay` | 支持 | 不支持 | 不支持 | 不需要本地资料接入 |
| macOS 12+ + `RhineLabMacLocal` | 支持 | 选择目录后只读 | 连接本机兼容服务后可读工作台 | 需要本地文件和本机服务 |
| Windows + `RhineLabMacLocal` | 不适用 | 不适用 | 不适用 | 这个包当前不支持 Windows |

当前 AI 秘书服务是独立的本机程序，默认监听 `http://127.0.0.1:8866`。莱茵生命只通过本机回环地址读取已授权的工作台数据；它不会替用户安装模型、启动模型、录音、转录或把资料上传到外部 AI。

## 录音资料的实际流程

1. 用你选择的本地录音工具录音。
2. 用本地转录模型把录音变成文字。音频转录目前不随莱茵生命包提供，转录失败时要保留原始音频和失败记录。
3. 把文字保存为 `.txt`，或保存为包含事件字段的 `.json`。
4. 启动兼容的本机 AI 秘书服务，先执行环境检查：

   ```bash
   node tools/local-ai-event-importer.mjs --check
   ```

5. 导入转录文字：

   ```bash
   node tools/local-ai-event-importer.mjs --file ./transcript.txt
   ```

   适配器只访问 `127.0.0.1`/`localhost`，会先检查 `/api/health`，再取得本机操作令牌，最后向 `/api/events` 写入一条资料。它不会把令牌打印出来，也不会访问任意网址。

## JSON 事件格式

最小 JSON 可以是：

```json
{
  "source_type": "local_ai_transcript",
  "source_ref": "recording-2026-10-03.txt",
  "actor": "用户",
  "thread_key": "local:recording-2026-10-03",
  "content": "这里放本地转录文字",
  "metadata": {
    "audio_file": "recording-2026-10-03.m4a",
    "transcript_engine": "本地工具名称"
  }
}
```

也可以使用 `messages` 数组保存分段说话人和时间。导入只产生原始资料；后续项目归属、事项和状态仍需经过 AI 复核或人工判别，不会因为一段转录自动变成正式任务。

## 兼容性检查与退路

- Node.js 22.12 或更新版本是启动脚本和导入适配器的最低版本。
- 浏览器需要 WebGL 2 和硬件加速；不满足时仍可打开页面，但三维效果可能降级。
- `8866` 被其他程序占用、服务没有启动、服务不是兼容的 AI 秘书 API，或本机防火墙阻止回环连接时，导入会停止并显示错误，不会重试到外网。
- Windows 用户当前可以使用纯展示版；Windows 本地文件接入和 Windows 管理版需要兼容的 Windows 后端，当前发布包没有把 Mac 选择器伪装成 Windows 功能。
- Windows 管理版和 Windows 本地 AI 后端目前仍是后续功能，v0.2.1 不把它们当成已交付能力。
- 单次录入请求建议控制在 900 KB 以下；服务端请求上限约为 1 MB。长录音转录请按会话或时间分段，并保留各段的来源位置。
- 没有本地 AI 或暂时不能转录时，仍可保留原始音频和 `.txt`/`.json` 文件，稍后在兼容服务恢复后再导入。

## 运行边界

这是 `zzz-mike` 基于 [LBEILC/RhineLabWallpaper](https://github.com/LBEILC/RhineLabWallpaper) 的独立修改版。原作者、原始素材和本修改版的来源会在发布说明中单独列出。当前页面描述的是可执行的本地导入流程；“音乐专辑版”“文件预览版”和“Windows 管理版”仍按各自发布状态标记，预告不等于已交付。
