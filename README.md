# Codex Video Pet

Windows 透明置顶视频桌宠。常驻一个 Electron 窗口，用 Codex 官方 Hooks 驱动几段 WebM；JSONL 只作思考 / 漏掉 Stop 的兜底。

## 启动

```powershell
cd D:\Project\My\DestokPet
npm install
npm run make-placeholders
npm start
```

启动后桌面右下会出现透明窗。**按住角色即可拖动位置**。托盘可手动切 `thinking` / `working`，也可改缩放；指针在角色上时 **Ctrl + 滚轮** 同样缩放。

本机 HTTP 默认监听 `127.0.0.1:17331`。

## 安装 Codex Hooks

会**整份替换** `%USERPROFILE%\.codex\hooks.json`（先备份为 `hooks.json.bak-<时间戳>`），Live2D 的 CodexMotionPet 不再跟状态。`config.toml` 里 `[features].hooks = true` 已开，不用改。

```powershell
npm run install-hooks
```

改完后必须在 Codex 里跑 **`/hooks` 重新信任**。命令 hash 变了会被跳过，桌宠不会动。

Hook 映射：

| 事件 | 状态 |
|------|------|
| `SessionStart` | 确保桌宠在跑，不强制切片 |
| `UserPromptSubmit` | thinking |
| `PreToolUse` / `PostToolUse` | working |
| `PermissionRequest` | waiting（只观察，stdout `{}`） |
| `Stop` | review |
| `Interrupt` / `SessionEnd` | idle |

`hooks/notify.cmd` 只做：读 stdin → POST JSON → 立刻输出 `{}` 退出。`timeout: 5`，fail-open，不拦截权限请求。

关掉 hook 信任时，桌宠仍会 tail `%USERPROFILE%\.codex\sessions\**\*.jsonl`：`task_started` / `Reasoning` → thinking，`CommandExecution` → working，`task_complete` → review。有轮询延迟。

多 session 聚合优先级：`failed > waiting > working > thinking > review > idle`。

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

**WebM VP9 + yuva420p，必须带 `-auto-alt-ref 0`。** 第一版仓库里是纯色透明短循环占位，方便先接线。
