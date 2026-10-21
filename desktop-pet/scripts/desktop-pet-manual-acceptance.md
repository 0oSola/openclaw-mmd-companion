# Desktop Pet Manual Acceptance Checklist

更新时间：2026-07-10

本清单用于补齐需要真实桌面、真实鼠标或用户视觉确认的 desktop-pet 交互验收。执行前先启动 API、主站和 desktop-pet，并确认 Pet 窗口中已经加载真实 MMD 模型。

## 准备

- [ ] 在 `desktop-pet` 目录运行 `.\start-pet.ps1`；如已有 Pet 正在运行，脚本会先停止当前 Electron 主进程，再重新拉起 Pet。
- [ ] 只想复用当前 Pet、不重启时运行 `.\start-pet.ps1 -ReuseExisting`。
- [ ] 需要强制新开并保留旧实例时运行 `.\start-pet.ps1 -ForceNew`。
- [ ] 需要前台查看 Vite/Electron 日志时，可手动分两步运行：`npm run dev`，再另开终端执行 `$env:MMD_PET_DEBUG_EVENTS="1"; $env:MMD_PET_DEBUG_EVENTS_LOG="D:\workspace\MMD project\.worktrees\desktop-mmd-codex-pet\desktop-pet-debug-events.ndjson"; npm run dev:electron`。
- [ ] 确认 Pet 窗口可见，右键菜单可打开，日志文件持续写入 `context-menu:*` 事件。
- [ ] 完成通知验收时确认截图包含 Pet 主窗口和独立完成通知窗口；通知窗口不应只是 Pet 内部的 DOM 气泡。

## 自动脚本

这些脚本会控制真实鼠标。默认不执行真实输入，必须显式传 `-AllowMouseControl`，并建议在空闲桌面会话中运行；脚本结束或失败时会释放鼠标按钮、恢复鼠标位置，并把 Pet 窗口恢复到测试前位置。

### PET-INT-024 屏幕边缘右键菜单

运行短烟测：

```powershell
.\scripts\stress-pet-right-click.ps1 -AllowMouseControl -EdgePlacement BottomRight -SequentialClicks 5 -BurstClicks 0 -MaxWindowDriftPx 16
```

通过标准：

- [ ] 脚本输出 `edgePlacement=BottomRight`。
- [ ] `contextMenuPopupCount` 大于等于 `sequentialClicks`。
- [ ] `contextMenuClosedCount` 大于等于 `sequentialClicks`。
- [ ] `contextMenuErrorCount=0`。
- [ ] `before` 与 `after` 的 x/y 漂移不超过 `MaxWindowDriftPx`，width/height 不变。
- [ ] 过程中 Pet 位于屏幕右下边缘，菜单仍在可见屏幕内打开，Electron 进程没有退出。

长压力版本：

```powershell
.\scripts\stress-pet-right-click.ps1 -AllowMouseControl -EdgePlacement BottomRight -SequentialClicks 20 -BurstClicks 3 -MaxWindowDriftPx 16
```

## 固定手工清单

### 启动

- [ ] `npm run dev` 后 renderer 固定在 `http://127.0.0.1:5174` 或当前覆盖端口。
- [ ] `npm run dev:electron` 后 Pet BrowserWindow 为透明 frameless 小窗，模型加载完成。
- [ ] 状态条没有持续显示启动失败、模型加载失败或 API 连接错误。

### 右键

- [ ] 在 Pet 中央右键，菜单打开在 Pet 附近。
- [ ] 连续右键打开、关闭菜单 5 次，菜单不跑到窗口左上角或屏幕远端。
- [ ] 执行 PET-INT-024 短烟测后，日志中无 `context-menu:error`。

### 拖动

- [ ] 右键菜单选择 `Interaction Mode` -> `Drag Whole App`。
- [ ] 左键按住 Pet 空白或角色区域拖动，窗口随鼠标移动。
- [ ] 松开后窗口尺寸保持 360x420 附近，不发生 resize/maximize/fullscreen。
- [ ] 右键按下不会启动窗口拖动。

### PET-INT-025 相机

- [ ] 右键菜单选择 `Interaction Mode` -> `Adjust Camera`。
- [ ] 鼠标滚轮 zoom in / zoom out，角色缩放可见且窗口不移动。
- [ ] 左键拖动 rotate，角色视角变化可见且窗口不移动。
- [ ] 使用 OrbitControls pan 操作方式进行 pan，角色在窗口内平移可见且窗口不移动。
- [ ] 右键菜单切回 `Interaction Mode` -> `Drag Whole App`。
- [ ] 切回后左键拖动会移动整个 Pet，不再调整相机。
- [ ] 切回时保存镜头：关闭并重启 desktop-pet 后，同一模型和 render pipeline 恢复到刚才保存的 zoom/pan/rotate 结果。
- [ ] 切换到不同模型或 render pipeline 时，不复用上一模型的 Pet camera snapshot。

### 同步

- [ ] 在主站 `/companion` 选择模型与 render pipeline，并点击保存到桌面 Pet。
- [ ] 在 Pet 右键菜单点击 `Sync from Main Site` / `从主站同步`。
- [ ] Pet remount 后显示主站保存的模型与 render pipeline。
- [ ] 同步后再执行 PET-INT-025，确认同一模型/管线的镜头仍按 Pet 本地 snapshot 规则保存与恢复。

### Codex 新建

- [ ] 右键菜单打开 `Workspace`，确认当前 workspace 名称正确。
- [ ] 点击 `New Codex Session`。
- [ ] VSCode 新开一个当前 workspace 窗口；同一 workspace 连续触发时也应出现新的窗口，而不是只复用/聚焦已有窗口。
- [ ] 新窗口由 `%TEMP%\mmd-codex-pet\vscode-workspaces\<launch-id>\session.code-workspace` 打开，VSCode Recent Workspaces 不新增该临时项。
- [ ] VSCode 内置终端 `Codex Pet` 执行 `codex`；同目录 `.codex-pet\vscode-terminal-ack.json` 记录匹配 request id，request 文件随后删除。
- [ ] 保持另一个已加载 Pet helper 的 VSCode 窗口打开，确认它不会抢走本次 request 或新建 `Codex Pet` 终端。
- [ ] Pet 常驻状态条从 `starting` / `launched` 进入 running 类状态。
- [ ] 若目标 helper 未加载，Pet 在约 20 秒后显示 failed，而不是误报 launched。

### Codex 恢复

- [ ] 右键菜单打开 `Recent Sessions` 或 `More Sessions...`。
- [ ] 选择一条最近 session。
- [ ] VSCode 内置终端执行 `codex resume --cd <workspace> <session_id>`。
- [ ] Pet 常驻状态条显示恢复中的 session 状态，且没有创建外部 `cmd.exe`。

### Codex Desktop 新建、恢复与聚焦

- [ ] 在 `Coding Agent` 中选择 `Codex`，再在 `Codex Launch Target` / `Codex 启动工具` 中选择 `Codex Desktop`；重新打开右键菜单确认 radio 勾选仍保留。
- [ ] 点击 `New Codex Session`，确认打开 Codex Desktop 的 `codex://new?path=...` 新任务界面，而不是 VSCode。
- [ ] 在 `Recent Sessions` 中选择一个非 app-server 的历史 Codex 会话，确认打开的是对应 Codex Desktop 线程；日志包含 `codex-desktop-launch:restore-session-requested`，URI 为 `codex://threads/<session_id>`，不出现 `codex resume` 或 VSCode terminal request。
- [ ] 在 `Active Workspaces` 或 `More Sessions...` 中选择一个仍在运行的 Codex 会话，确认 Codex Desktop 聚焦同一 `session_id`；日志包含 `codex-desktop-launch:focus-active-session`，不打开新的 VSCode 窗口。
- [ ] 切回 `VSCode + Codex CLI`，再次恢复历史会话，确认恢复为 VSCode 内置终端 `codex resume --cd <workspace> <session_id>`，证明两条路由可切换。
- [ ] 选择 Claude 后执行新建/恢复，确认仍走 Claude 原有 VSCode 路径；选择 Pet app-server 会话时不调用 Desktop session deeplink。
- [ ] 若 Codex Desktop 未安装或协议失败，确认 Pet 显示失败，不静默回退到 VSCode。

### Codex WSL 模式

- [ ] 在右键菜单 `Codex Environment` / `Codex 环境` 选择 `WSL`；关闭并重新打开菜单后仍勾选 `WSL`，重启 Pet 后选择保持。
- [ ] 在含空格的 workspace 点击 `New Codex Session`，确认 `Codex Pet` 终端执行 `wsl.exe --cd <workspace> --exec codex ...`，Codex 内工作目录为对应 `/mnt/<drive>/...` 路径。
- [ ] 恢复一条会话，确认命令为 `wsl.exe --cd <workspace> --exec codex ... resume --cd . <session_id>`，Linux Codex 参数中没有 `D:\...` workspace。
- [ ] 切回 `Windows` 后新建/恢复，确认仍执行原生 `codex` / `codex resume --cd <workspace> <session_id>`，不经过 `wsl.exe`。

### PET-INT-077 / 078 完成通知去重与独立窗口

- [ ] 准备两个可快速完成的 session A、B；A 完成后先不要关闭气泡，打开右键菜单并等待 background refresh，确认普通 running/历史 completed/status card 更新不会让 A 气泡消失。
- [ ] 确认 A 以独立 Electron `BrowserWindow` 出现在 Pet 主窗口外侧，通知窗口不占用 Pet DOM 布局，也不出现在任务栏。
- [ ] 让 B 产生新的显式完成事件，确认独立通知窗口中的 B 替换当前 A latch；点击 `x` 后通知窗口立即消失。
- [ ] 点击通知正文，确认会聚焦通知对应 workspace 的 VSCode 窗口。
- [ ] 点击收起/展开控制，确认通知窗口高度分别变化，且窗口仍位于当前显示器可见工作区内。
- [ ] 移动或缩放 Pet 主窗口，确认独立通知窗口跟随 Pet 重新定位/调整，不重新嵌回 Pet 窗口。
- [ ] 依次关闭 A、B 后，通过受控状态 fixture 或重复 publisher 按 A → B → A 重放相同 completion key，确认 A、B 都不重新弹出。
- [ ] 重启 Pet，确认历史 completed session 仍可显示在常驻状态卡或最近会话列表中，但没有 `completionNoticeKey` 时不弹完成通知。
- [ ] 检查 Electron `userData/dismissed-completion-notice.json` 已保存 JSON array；连续关闭超过 100 个测试 key 时只保留最近 100 个且无重复项。

### PET-INT-079 completed watcher 停止

- [ ] 开启 `MMD_PET_DEBUG_EVENTS=1`，新建或恢复一个 Codex session，并等待任务进入 `completed`。
- [ ] 日志先出现该 session 的 completed `codex-status:changed`，随后出现 `codex-session:watch-stop` 且 `reason=status:completed`。
- [ ] 完成后的 sibling scan/upsert 不再次发布其他 session 状态；等待至少两个原 watcher interval，确认同一 watcher 不再刷新状态。

### PET-INT-080 workspace / agent 切换清理 watcher

- [ ] 在 session 仍为 running 时通过 `Workspace -> Select Workspace...` 或 `Switch to workspace` 切换目录；日志出现 `codex-session:watch-stop`，reason 分别为 `workspace-selected` 或 `workspace-switched`。
- [ ] 在另一条 running session 中切换 `Coding Agent`；日志出现 `codex-session:watch-stop` 且 `reason=agent-changed`。
- [ ] 在 API list、More Sessions 或 background refresh 尚未返回时切换 workspace/agent，确认旧请求返回后不更新 menu cache、session panel 或状态卡。
- [ ] 在 `New Session` / restore 已发出但 helper ACK 尚未返回时切换 workspace/agent，确认日志记录 `new-session-stale` / `restore-session-stale`，旧 launch 结果不发布 launched/running，也不启动 watcher。
- [ ] 切换后等待旧 session 继续产生 JSONL 输出，确认旧 generation 的迟到扫描结果不会覆盖新上下文的 idle/running 状态，也不会触发完成气泡。

### PET-INT-081 当前 workspace publisher 与 watcher 优先级

- [ ] 准备 workspace A、B 各至少一条最近 session；当前选择 A 时打开菜单并等待 background refresh/daily scan，状态卡只能选择 A 的 session，不得显示 B。
- [ ] 在 A 中启动 active watcher，再触发右键菜单、background refresh 和 session API 返回；确认普通 publisher 不覆盖 watcher 正在发布的 A 状态。
- [ ] 切换到 B 后重复检查，确认 cache 中残留的 A session 不会成为 B 的状态卡来源，旧 A publisher 的迟到结果被丢弃。

### PET-INT-082 new watcher 起始时间与 Windows / WSL 合并

- [ ] 保持一个启动前已存在的旧长会话 O 持续写 JSONL，使其 file mtime 晚于新建动作；随后点击 `New Codex Session` 创建 N，确认 `codex-session:watch-session-bound` 绑定 N，而不是仅因 mtime 更新选择 O。
- [ ] N 绑定后继续在同一 session 发送一轮输入，确认 watcher 使用精确 session id + file mtime 跟踪后续输出；restore session 同样能继续更新。
- [ ] 同时准备 Windows `CODEX_HOME` 与 `CODEX_WSL_HOME` 候选，让 Windows root 的旧 session 数量足以填满 limit，并让 WSL root 有更新 session；打开 Recent/More Sessions，确认更新的 WSL session 仍进入结果。
- [ ] 当前 Pet workspace 选择 Windows 路径（例如 `D:\workspace\MMD project`），让 WSL session JSONL 写入等价 `cwd=/mnt/d/workspace/MMD project`；确认 scanner 不过滤该 session、workspace+agent context gate 仍判定 current，菜单/background publisher 可把它作为当前 workspace 状态显示。
- [ ] 对同一 workspace 混用盘符大小写、`/`/`\` 和末尾分隔符后重复检查，确认都归一为同一 identity；另一个 drive 或不同 tail 路径仍必须被排除。
- [ ] 检查对应 payload/debug 信息包含 `session_started_at`；无事件 timestamp 的测试文件使用 birthtime/ctime fallback，不因旧文件后来被 touch 而伪装成新 session。

## 记录

- 执行人：
- 日期：
- Electron 版本：
- Windows 显示器布局：
- PET-INT-024 脚本输出摘要：
- PET-INT-025 重启恢复结果：
- PET-INT-077 / 078 完成通知窗口结果：
- 独立通知截图路径：
  - 收起：
  - 展开：
  - Pet 移动后：
  - 关闭后：
- PET-INT-079 completed watcher 日志：
- PET-INT-080 workspace / agent watcher-stop 日志：
- PET-INT-081 当前 workspace publisher 结果：
- PET-INT-082 watcher 绑定与 Windows / WSL 合并结果：
- 异常与日志路径：
