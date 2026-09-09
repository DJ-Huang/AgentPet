# Codex Video Pet

Windows 透明置顶视频桌宠。读本机 Codex 线程列表驱动动画：宠物旁和托盘显示会话标题、是否在跑；动画跟最近一条活跃会话（也可钉住某一条）。Hooks 只是可选加速，不信任时列表和动画仍会工作。

## 启动

```powershell
cd D:\Project\My\DestokPet
npm install
npm run make-placeholders
npm start
```

启动后桌面右下会出现透明窗。**视频下方是最近 8 条 Codex 会话**（标题 + 状态点）。绿点表示跑着，紫点回顾，灰点空闲；高亮的是当前驱动动画的那条。点击可钉住，再点取消，回到跟随最近活跃。**按住角色即可拖动**。托盘同样有会话列表和钉住；指针在角色上时 **Ctrl + 滚轮** 缩放（只缩放视频，面板高度固定）。

本机 HTTP 默认监听 `127.0.0.1:17331`。`GET /sessions` 可看当前线程快照。

## 数据源

不依赖 `/hooks` 信任：

- 标题：`%USERPROFILE%\.codex\session_index.jsonl`（`id` / `thread_name` / `updated_at`，同一 id 后写覆盖）
- 是否在跑：tail `%USERPROFILE%\.codex\sessions\**\*.jsonl`
  - `task_started` / `Reasoning` → thinking
  - `CommandExecution` / 工具 → working
  - `task_complete` → review → idle
- 线程 ID 取 rollout 文件名里的 **第一个** UUID（thread id），与 `session_index` 对齐，而不是文件名末尾的 turn id。

思考状态约 90 秒没有新事件会回 idle，避免卡在黄圆。钉住优先；否则跟 `updatedAt` 最新的非 idle 会话。多条同时非 idle 时优先级：`failed > waiting > working > thinking > review > idle`。

## 可选：安装 Codex Hooks

会**整份替换** `%USERPROFILE%\.codex\hooks.json`（先备份为 `hooks.json.bak-<时间戳>`）。`config.toml` 里 `[features].hooks = true` 已开，不用改。未信任时会话列表和动画仍走上面的本机线程。

```powershell
npm run install-hooks
```

改完后必须在 Codex 里跑 **`/hooks` 重新信任**。命令 hash 变了会被跳过。

Hook 映射：

| 事件 | 状态 |
|------|------|
| `SessionStart` | 确保桌宠在跑，不强制切片 |
| `UserPromptSubmit` | thinking |
| `PreToolUse` / `PostToolUse` | working |
| `PermissionRequest` | waiting（只观察，stdout `{}`） |
| `Stop` | review |
| `Interrupt` / `SessionEnd` | idle |

`hooks/notify.cmd` 只做：读 stdin → POST JSON → 立刻输出 `{}` 退出。fail-open，不拦截权限请求。

## 换成角色成片

把 WebM 放到 `assets/pet/`，文件名与 `assets/pet/manifest.json` 一致：

```json
{
  "size": [360, 360],
  "clips": {
    "idle": { "file": "idle.webm", "loop": true },
    "thinking": { "file": "thinking.webm", "loop": true },
    "working": { "file": "working.webm", "loop": true },
    "waiting": { "file": "waiting.webm", "loop": true },
    "review": { "file": "review.webm", "loop": false, "next": "idle" },
    "failed": { "file": "failed.webm", "loop": false, "next": "idle" }
  }
}
```

缺文件时回退：`thinking` → `working` → `idle`，其它缺的回 `idle`，不崩溃。`review` / `failed` 播完或 8 秒后回 idle。

推荐编码（透明 WebM）：

```powershell
ffmpeg -i input.mov -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -an idle.webm
```

## 为普通视频生成角色 Mask

在“桌宠视频设置”中，每个视频行都有“生成 Mask”按钮。它会分析人物在整段视频中的活动范围，生成一张带 SDF 羽化的 Alpha Mask，并在播放时自动应用；原视频不会被改写。

首次使用前，请确保系统的 `python` 命令可用，并安装生成器依赖：

```powershell
python -m pip install rembg onnxruntime opencv-python-headless pillow
```

生成的 Mask 会保存在应用数据目录，和该视频路径自动关联。删除或移动原视频后，该关联不会再生效。

**WebM VP9 + yuva420p，必须带 `-auto-alt-ref 0`。** 第一版仓库里是纯色透明短循环占位，方便先接线。
