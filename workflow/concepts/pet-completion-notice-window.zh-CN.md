# Pet 独立完成通知窗口

## 中文名称

Pet 独立完成通知窗口。

## 英文机器名

`PetCompletionNoticeWindow`

## 概念定义

Pet 独立完成通知窗口是 desktop-pet 主进程创建的独立 Electron `BrowserWindow`，用于展示 Codex 任务的真实完成事件。它加载独立的 `notification.html`，通过 preload 暴露的受限 IPC 与主进程 reducer 同步状态，因此通知内容和窗口生命周期不依赖 Pet 主窗口 renderer 的 DOM 树。

## 展示形态与窗口高度

通知状态最多保留最新 3 条完成记录，但收起态只允许渲染一个聚合胶囊；聚合胶囊可以显示通知数量（例如 `1`、`2`、`3`）和最近完成摘要，不得在收起态逐条堆叠卡片。展开态按时间倒序显示纵向通知卡，最多 3 条。

当前窗口契约使用固定宽度 `286px`、卡片间距 `8px`、Pet 与通知窗口间距 `12px`。目标高度规则为：

```text
Hcollapsed = 78px
n = min(通知数量, 3)
Hexpanded(n) = n * 190px + (n - 1) * 8px
```

因此展开态 1/2/3 条分别为 `190px`、`388px`、`586px`；收起态高度始终为 `78px`，与通知数量无关。当前实现已将收起态渲染为最新通知驱动的单个聚合胶囊，展开态才逐条渲染任务卡。

## 文本契约

通知标题、任务文本和完成输出必须与 Pet 完成状态卡共享同一套展示清洗语义：过滤注入上下文和机器包装行，回退到有效工作区/摘要，脱敏敏感值，并执行相同的限长、限行规则。通知不得直接把原始 transcript、`Exit code`、`Wall time`、进度百分比或分隔线当作用户结果。

当前实现通过 `buildCodexCompletedPresentation()` 统一生成完成态标题、工作区标签、任务标题和 `outputLines`；Pet 状态卡和通知窗口对同一输入使用同一投影函数。通知窗口不接收原始 transcript，只接收主进程 reducer 生成的清洗后字段。

## 解决的问题

旧实现把完成通知渲染为 Pet 主窗口内部的 DOM 内容。这样通知会被 Pet 窗口边界裁剪，无法在窗口外独立悬浮，也难以单独控制置顶、收起/展开高度和关闭生命周期。

## 适用范围

- Codex 真实 `running -> completed` transition 的桌面完成通知。
- 需要在 Pet 主窗口外显示、收起、展开、关闭或聚焦对应 VSCode workspace 的通知。
- 需要随 Pet 移动、缩放和显示器工作区变化重新定位的桌面窗口。

## 不适用范围

- Windows 系统 Toast、操作中心通知或其它系统级通知服务。
- 仅用于 Pet 内部展示的常驻状态卡。
- 没有显式 `completionNoticeKey` 的历史 completed 状态。
- 完整 Codex transcript 或实时 token stream 展示。

## 核心不变量

1. 只有主进程 completion tracker 产生显式 `completionNoticeKey` 时，才允许创建完成通知。
2. 通知窗口必须是独立 `BrowserWindow`，不能退回 Pet 主窗口 DOM，也不是 Windows 系统 Toast。
3. 收起态必须是单个聚合胶囊；展开态必须是纵向列表，且最多 3 条通知。
4. 收起态高度必须固定为 `78px`；展开态必须按 `n * 190px + (n - 1) * 8px` 计算，其中 `n <= 3`。
5. 通知 renderer 不得直接获得 Node.js 或任意 IPC 能力，只能使用 preload 暴露的独立 `pet:completion-notice:*` 接口。
6. 收起/展开必须同步窗口 bounds；位置必须以 Pet bounds 为锚点，并按当前显示器 `workArea` 裁剪。
7. Pet 主窗口移动或缩放后，通知窗口必须重新定位；Pet 关闭或应用退出后，通知窗口必须销毁。
8. 标题、任务和输出必须与完成状态卡共享清洗、脱敏、回退、限长和限行语义；展示文本不得改变原始会话证据。
9. 用户 dismiss 的 key 必须由主进程持久化到 `userData/dismissed-completion-notice.json`，最多保留最近 100 个且去重；同一个 key 不得重新弹出。
10. 真实验收必须分别提供 HWND/bounds、自动化测试和窗口级截图证据；任一类证据不得替代另外两类。

## 证据与计算口径

- 状态来源：`desktop-pet/electron/main.ts` 的 completion tracker、reducer 和 `pet:completion-notice:*` IPC。
- 窗口创建：`desktop-pet/electron/completionNoticeWindow.ts` 的 `createCompletionNoticeBrowserWindowOptions()`。
- 窗口位置：`calculateCompletionNoticePosition()` 使用 Pet bounds、通知尺寸和当前显示器 `workArea`。
- UI 入口：`desktop-pet/notification.html`、`desktop-pet/src/notificationMain.tsx`、`desktop-pet/src/CompletionNoticeWindow.tsx`。
- 关闭持久化：Electron `app.getPath("userData")/dismissed-completion-notice.json`。
- 已有自动化证据：`electron/completionNoticeWindow.test.ts`、`electron/mainIntegration.test.ts`、`src/App.integration.test.ts` 可覆盖 reducer、去重、dismiss 序列化、窗口选项、位置和部分集成行为；它们不能证明真实桌面存在第二个 OS 窗口。
- HWND/bounds 证据：必须记录 Pet 主窗口与通知窗口各自 HWND、Electron PID、`x/y/width/height`、所在显示器 `workArea`，并记录收起、展开、移动/缩放前后的变化。
- 窗口级截图证据：必须从真实桌面或窗口句柄捕获收起态、展开态、最多 3 条通知、Pet 移动/缩放跟随及 dismiss 后状态；renderer DOM 截图或裁剪 Pet 主窗口截图不能替代独立窗口证据。

## 正例

- 新 watcher 观察到一条真实完成事件，主进程生成 `completionNoticeKey`，在 Pet 正上方创建独立通知窗口。
- 1 条通知收起时显示一个聚合胶囊；展开后显示 1 条纵向卡片，窗口高度为 `190px`。
- 3 条通知收起时仍只有一个 `78px` 聚合胶囊；展开后显示 3 条纵向卡片，窗口高度为 `586px`。
- 用户移动 Pet 后通知窗口保持在 Pet 正上方；接近显示器顶部时仍被裁剪在工作区内。

## 反例

- 在 `App.tsx` 中继续渲染主窗口内的完成通知内容，即使视觉上放在 Pet 右上角。
- 收起态仍用 `notices.map(...)` 逐条渲染，或让 2/3 条通知把收起态高度撑高。
- 仅凭启动扫描到的历史 `completed` 状态弹出通知。
- 只通过单元测试断言 reducer，而没有 HWND/bounds 和窗口级截图确认真实桌面上存在第二个 Electron 窗口。
- 通知继续直接使用未经统一清洗的 `sessionTitle` 或机器输出包装行。
- 把完成通知实现成 Windows Toast，并声称它等同于 Codex Pet 的独立窗口。

## 相关 contract 与 gate

- contract：主进程 completion reducer、preload 受限 IPC、notification renderer 状态同步。
- gate：自动化测试必须覆盖 reducer、最多 3 条、聚合/高度计算、去重、dismiss 持久化和 IPC sender 校验。
- gate：清洗夹具必须证明通知与状态卡对同一标题、任务和输出得到一致展示语义。
- gate：真实桌面必须分别通过 HWND/bounds 记录和窗口级截图确认主窗口、通知窗口同时可见，且收起、展开、移动跟随、关闭均有效。

## 当前缺陷、TODO 与验收证据

| 当前缺陷 | TODO | 验收证据 |
| --- | --- | --- |
| 收起/展开和文本投影需要持续防回归 | 保持聚合 renderer、固定收起高度、展开高度公式和共享 `buildCodexCompletedPresentation()` | 1/2/3 条通知的窗口级截图；对应通知 HWND/bounds；同一输入的对照测试 |
| 现有测试主要是纯逻辑/集成测试 | 增加独立窗口 IPC/窗口生命周期集成覆盖 | 自动化测试报告，明确测试边界 |
| 尚无完整真实桌面独立窗口证明 | 在 Windows 验收脚本中采集两个 HWND、PID、bounds、workArea | HWND/bounds 验收日志；窗口级截图 |
| 手工验收文档仍使用旧通知措辞且不要求三类证据 | 后续更新手工验收脚本，本概念票据不修改脚本 | 后续票据链接、脚本运行产物和三类证据清单 |

## 失败后的修正路线

1. 若仍看到 Pet 主窗口内的旧通知内容，先确认旧 Electron 进程已停止并重新启动当前工作区构建。
2. 若没有独立窗口，检查 `completionNoticeKey` 是否由真实 watcher 产生，再检查 `pet:completion-notice:*` IPC 和 `notification.html` 加载日志。
3. 若窗口被裁剪或遮挡，记录 Pet/通知窗口 HWND 与 bounds，检查 `screen.getDisplayMatching(...).workArea` 和 `calculateCompletionNoticePosition()`。
4. 若收起态出现多张卡或高度随数量增长，先用 1/2/3 条固定夹具复现，再修正聚合 renderer、尺寸函数和 `setBounds()` 的同一状态转换。
5. 若通知文本与状态卡不一致，使用同一输入夹具对比标题、任务、输出清洗结果，修正主进程/renderer 的 helper 路由，不修改原始 transcript。
6. 若收起/展开或关闭失效，检查通知窗口 sender 校验、preload IPC 和 `BrowserWindow.setBounds()`/销毁事件。

## 与现有概念的关系

- 依赖“会话展示清洗”决定通知标题、任务和完成输出的可读展示，但不改变原始 Codex transcript；通知与完成状态卡必须共享这套语义。
- 依赖“Pet 窗口边界持久化”提供 Pet 的移动和尺寸变化来源，但通知窗口使用独立窗口边界。
- 替代旧的主窗口内完成通知实现；旧实现不再作为当前运行时契约。
