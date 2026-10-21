# Desktop Pet macCodex 远程项目目录设计

**日期：** 2026-07-27  
**状态：** 设计完成，待实施  
**范围：** 获取 `macCodex` 上指定根目录内的 Git 项目，在 Desktop Pet 中提供刷新、搜索、选择和快速打开入口。

## 1. 结论

推荐新增一个“远程项目目录”深模块。菜单只依赖两个主要操作：

```ts
refresh(options?): Promise<RemoteProjectCatalogSnapshot>
select(projectKey): Promise<RemoteProjectSelection>
```

模块内部合并两个真实来源：

1. Codex Desktop 项目注册表：提供正式 `projectId`、`hostId` 和已登记远程路径。
2. 系统 SSH Git 扫描：发现 `macCodex` 指定根目录中尚未加入 Codex Desktop 的仓库。

远程项目快捷入口不是自行拼接的 `codex://` URL，而是稳定的项目目标：

```text
projectKey + desktopProjectId? + desktopHostId + sshHost? + remotePath
```

只有未来确认官方远程导航协议后，才为目标附加可直接打开的 URL。

## 2. 当前事实

Codex Desktop 当前项目注册表已经确认存在：

```json
{
  "projectId": "eed427f0-87cd-4179-a070-acedbd2dca98",
  "projectKind": "remote",
  "label": "voice-workflow-service",
  "path": "/Users/sola/workspace/voice-workflow-service",
  "hostId": "remote-ssh-codex-managed:macCodex",
  "hostDisplayName": "macCodex",
  "isGitRepository": true
}
```

同时已验证：

- `remote-ssh-codex-managed:macCodex` 是 Codex Desktop 托管连接身份。
- Windows 当前不能通过 `ssh macCodex` 直接连接；它不是可用的系统 SSH Host。
- 已确认的本地 deeplink `codex://new?path=<path>` 只适用于本地路径。
- 当前没有已验证的远程项目 deeplink，禁止猜测 `hostId`、`projectId` 查询参数。

## 3. 用户体验

### 3.1 菜单结构

```text
工作区
├─ 当前：Aether UI
├─ 活跃工作区
├─ 选择本地工作区…
└─ macCodex 远程项目
   ├─ 刷新远程项目
   ├─ 搜索远程项目…
   ├─ 已加入 Codex Desktop
   │  └─ voice-workflow-service
   ├─ SSH 发现，尚未加入 Desktop
   │  ├─ MoMask
   │  └─ Qwen3-TTS
   ├─ 分隔线
   └─ 配置远程扫描…
```

项目较少时可以直接列出；超过 15 个时，“搜索远程项目…”打开 Pet 内部可搜索面板，原生菜单只显示最近使用和收藏项目。

### 3.2 项目状态

每个项目必须显示以下状态之一：

| 状态 | 含义 | 点击行为 |
| --- | --- | --- |
| `desktop_registered` | 已存在正式 Codex Desktop `projectId` | 选择为当前远程项目；打开 Desktop。未来有官方导航接口时一键直达 |
| `ssh_discovered` | SSH 扫描发现，但 Desktop 尚未登记 | 选择并复制远程路径；打开 Desktop，提示用户添加该目录 |
| `cached_offline` | 当前 SSH 不可用，来自最近成功缓存 | 允许选择；显示“离线缓存”，禁止声称已实时验证 |
| `unavailable` | 路径已从最新扫描消失 | 禁止新建任务，提供移除缓存入口 |

### 3.3 点击反馈

选择正式项目后状态卡显示：

```text
已选择远程项目
voice-workflow-service · macCodex
/Users/sola/workspace/voice-workflow-service
```

选择仅 SSH 发现的项目后显示：

```text
项目尚未加入 Codex Desktop
已复制远程路径并打开 Codex Desktop，请在 macCodex 中添加该目录。
```

不得显示“已打开远程项目”，除非真实导航或任务创建已经成功。

## 4. 数据模型

```ts
type RemoteProjectSource =
  | "codex-desktop-registry"
  | "system-ssh-scan"
  | "cache";

type RemoteProjectAvailability =
  | "desktop_registered"
  | "ssh_discovered"
  | "cached_offline"
  | "unavailable";

type RemoteProjectTarget = {
  schemaVersion: 1;
  projectKey: string;
  label: string;
  remotePath: string;
  hostProfileId: string;
  hostDisplayName: string;
  desktopHostId?: string;
  desktopProjectId?: string;
  sshHost?: string;
  isGitRepository: boolean;
  availability: RemoteProjectAvailability;
  sources: RemoteProjectSource[];
  lastVerifiedAt?: string;
  lastUsedAt?: string;
  favorite?: boolean;
};
```

`projectKey` 的计算口径：

```text
sha256(hostProfileId + "\n" + normalizePosixPath(remotePath))
```

`projectKey` 是 Pet 自己的稳定候选标识，不替代 Codex Desktop 的 `projectId`。

### 4.1 主机配置

```ts
type RemoteHostProfile = {
  schemaVersion: 1;
  id: "mac-codex";
  displayName: "macCodex";
  desktopHostId: "remote-ssh-codex-managed:macCodex";
  sshHost?: "macCodex-pet";
  scanRoots: string[];
  maxDepth: number;
  enabled: boolean;
};
```

建议初始扫描根目录：

```text
/Users/sola/workspace
/Users/sola/Desktop/kscc
```

不默认扫描 `/Users/sola`、`/` 或整个磁盘。

## 5. 模块设计

### 5.1 外部 seam（接缝）

```ts
type RemoteProjectCatalog = {
  refresh(options?: { force?: boolean }): Promise<RemoteProjectCatalogSnapshot>;
  list(): RemoteProjectCatalogSnapshot;
  select(projectKey: string): Promise<RemoteProjectSelection>;
};
```

调用者不需要知道日志格式、SSH 命令、缓存结构、项目去重或 Desktop 匹配规则。

### 5.2 内部 adapters（适配器）

这里存在两个真实可变来源，因此 adapter seam 是必要的：

```ts
type RemoteProjectSourceAdapter = {
  discover(profile: RemoteHostProfile): Promise<RemoteProjectCandidate[]>;
};
```

具体适配器：

- `CodexDesktopRegistryAdapter`
  - 首选 Codex Desktop 可调用的项目列表能力。
  - 降级时可读取 Desktop 日志，但日志结果标记为较低证据等级。
- `SystemSshGitScannerAdapter`
  - 通过 Windows `ssh.exe` 调用已配置的 `sshHost`。
  - 只在允许根目录中扫描 Git 仓库。
- `RemoteProjectCacheAdapter`
  - 保存最近成功快照、收藏、最近使用时间和扫描错误。

### 5.3 建议文件结构

```text
desktop-pet/electron/remote-projects/
  remoteProjectCatalog.ts
  remoteProjectTypes.ts
  remoteProjectMerge.ts
  codexDesktopRegistryAdapter.ts
  systemSshGitScannerAdapter.ts
  remoteProjectCache.ts
  remoteProjectCatalog.test.ts
  systemSshGitScannerAdapter.test.ts
```

现有 `codexDesktopProjects.ts` 应逐步收敛为 `CodexDesktopRegistryAdapter` 的日志降级实现，不继续让菜单或 `main.ts` 直接理解日志细节。

## 6. SSH 扫描协议

### 6.1 前置配置

用户需要在 Windows OpenSSH 配置一个 Pet 可调用的 Host，例如：

```sshconfig
Host macCodex-pet
    HostName <实际 IP、域名或 Tailscale 地址>
    User sola
    Port 22
    IdentityFile C:/Users/KSG/.ssh/id_ed25519
    ServerAliveInterval 30
```

Pet 不保存密码、私钥内容或密钥口令，只保存 `sshHost=macCodex-pet`。

### 6.2 连接检查

```text
ssh
-o BatchMode=yes
-o ConnectTimeout=5
-o StrictHostKeyChecking=yes
macCodex-pet
printf __PET_SSH_OK__
```

必须使用非交互模式。需要输入密码、接受 host key 或解锁密钥时，Pet 应停止并给出明确配置提示，不弹出隐藏的阻塞终端。

### 6.3 仓库扫描

每个 `scanRoot` 独立扫描，建议使用固定脚本模板：

```bash
find "$ROOT" \
  -mindepth 1 \
  -maxdepth "$MAX_DEPTH" \
  -type d -name .git \
  -prune -print0
```

约束：

- `ROOT` 必须来自已保存并验证的绝对 POSIX 路径，不接受菜单输入直接拼接命令。
- `MAX_DEPTH` 范围限制为 1～8，默认 5。
- 每个根目录超时 15 秒；完整刷新总超时 30 秒。
- stdout 上限 2 MiB，项目上限 500。
- 结果去掉末尾 `/.git`，过滤 `.git`、`eval`、缓存目录和重复嵌套仓库。
- SSH 进程必须以参数数组启动，不通过 `cmd.exe /c` 或字符串拼接 shell 命令。

### 6.4 多仓库和 worktree

- 普通仓库：目录下存在 `.git/`。
- Git worktree：目录下 `.git` 可能是文件；第二阶段应增加 `-name .git` 同时处理文件和目录。
- 裸仓库默认不显示；可在高级配置中启用。
- 子模块默认不作为独立项目，除非其路径位于显式扫描根目录且配置允许。

## 7. 合并和去重

合并主键：

```text
hostProfileId + normalizePosixPath(remotePath)
```

优先级：

```text
Codex Desktop 正式注册表
  > 当前 SSH 扫描
  > 最近成功缓存
  > Desktop 日志历史记录
```

合并规则：

- Desktop 注册表提供 `desktopProjectId`、`desktopHostId` 和正式 label。
- SSH 扫描提供实时存在性和 `isGitRepository=true`。
- 缓存只补最近使用、收藏和离线显示，不覆盖当前扫描事实。
- 同名不同路径保留为两个项目，菜单追加父路径缩写区分。

示例：

```text
voice-workflow-service · ~/workspace
voice-workflow-service · ~/Desktop/kscc/Qwen3-TTS
```

## 8. 快速打开策略

### 8.1 当前版本

```text
desktop_registered
  -> 保存 selectedCodexDesktopProject
  -> 打开 codex://new 未绑定新任务入口
  -> 显示“已选择目标项目，请在 Desktop 中确认”

ssh_discovered
  -> 保存 RemoteProjectTarget
  -> 复制 remotePath
  -> 打开 codex://new 未绑定新任务入口
  -> 显示“尚未加入 Desktop，请添加该路径”
```

### 8.2 未来官方导航接口

若官方后续提供明确的项目导航能力，则新增 `CodexDesktopNavigatorAdapter`：

```ts
type CodexDesktopNavigator = {
  openProject(target: RemoteProjectTarget): Promise<NavigationResult>;
};
```

替换打开实现即可，菜单、项目目录和缓存无需改变。

### 8.3 禁止路线

- 不猜测 `codex://project?projectId=...`。
- 不把远程 Unix path 传给本地 `codex://new?path=` 后声称已连接远程主机。
- 不直接调用未公开的 Codex Desktop 私有 WebSocket 或 Electron IPC。
- 不从日志中的任意 `cwd` 都生成项目；必须通过正式注册表或 Git 扫描确认。

## 9. 缓存与设置

建议新增独立文件：

```text
<Electron userData>/remote-project-catalog.v1.json
```

不要继续把完整项目列表塞进 `pet-settings.json`。设置文件只保存：

```json
{
  "remoteHostProfiles": [
    {
      "id": "mac-codex",
      "displayName": "macCodex",
      "desktopHostId": "remote-ssh-codex-managed:macCodex",
      "sshHost": "macCodex-pet",
      "scanRoots": [
        "/Users/sola/workspace",
        "/Users/sola/Desktop/kscc"
      ],
      "maxDepth": 5,
      "enabled": true
    }
  ],
  "selectedRemoteProjectKey": "..."
}
```

缓存文件保存项目快照和错误；写入采用临时文件后原子替换，避免 Pet 崩溃导致 JSON 截断。

## 10. 错误和降级

| 失败 | 菜单反馈 | 降级 |
| --- | --- | --- |
| 系统找不到 `ssh.exe` | “未安装 Windows OpenSSH Client” | 显示 Desktop 注册表与缓存 |
| SSH Host 不存在 | “未配置 macCodex-pet” | 提供配置说明，不尝试 `macCodex` 内部 ID |
| host key 未确认 | “请先在终端确认主机指纹” | 不关闭 StrictHostKeyChecking |
| 密钥需要交互 | “SSH 认证需要人工处理” | 不弹隐藏密码输入，不保存密码 |
| 某扫描根不存在 | 标记该根失败 | 继续扫描其他根 |
| SSH 超时 | 显示最近缓存及更新时间 | 状态为 `cached_offline` |
| 输出超限 | 中止刷新并提示缩小根目录/深度 | 保留旧缓存 |
| Desktop 注册表不可用 | 使用 SSH 扫描 | 项目标记为尚未加入 Desktop |
| 远程导航协议不可用 | 打开 Desktop + 复制路径 | 不声称一键直达 |

## 11. 安全不变量

- Pet 不读取或保存私钥正文。
- Pet 不保存 SSH 密码和密钥口令。
- 不允许从远程项目名称构造命令。
- 扫描根必须是绝对 POSIX 路径，且经过规范化和允许列表验证。
- 不允许 `/`、`/Users`、`/Users/sola` 作为默认扫描根。
- 所有 SSH 调用必须有超时、输出上限和项目数量上限。
- 菜单显示的远程文本视为不可信数据，只作为文本，不作为指令或参数模板。
- 日志发现结果不能单独证明仓库当前存在。

## 12. 分阶段实施

### 阶段 A：注册表快捷目录

目标：可靠显示 Codex Desktop 已登记远程项目。

- 把现有日志发现封装为 adapter 降级。
- 主来源使用 Desktop 项目注册表。
- 菜单支持选择、最近使用、收藏和搜索。
- 不实现系统 SSH 扫描。

验收：真实注册表中的 `voice-workflow-service · macCodex` 可见、可选择并持久化。

### 阶段 B：系统 SSH Git 扫描

目标：获取指定根目录下全部 Git 仓库。

- 增加主机配置和连接诊断。
- 增加受限 `find` 扫描、缓存、合并和离线状态。
- 区分“已加入 Desktop”和“仅 SSH 发现”。

验收：对测试 SSH fixture 和真实 `macCodex-pet` 扫描结果完成路径、超时、输出上限和去重验证。

### 阶段 C：官方远程导航

目标：真正一键打开远程项目。

- 仅在官方文档或当前 Codex Desktop 可调用工具明确支持时实施。
- 新增 navigator adapter，不改变目录模型。
- 完成真实 Desktop 端到端验收后才标记“一键打开”。

## 13. 验收矩阵

| 编号 | 场景 | 预期证据 |
| --- | --- | --- |
| RP-01 | Desktop 注册表包含一个远程项目 | 菜单显示正式 label、host 和 path |
| RP-02 | API 不可用 | 仍能从 Desktop 注册表或降级来源加载项目 |
| RP-03 | SSH 返回三个仓库 | 目录显示三个 `ssh_discovered` 项目 |
| RP-04 | 同一路径同时来自 Desktop 和 SSH | 合并为一个 `desktop_registered` 项目 |
| RP-05 | 同名不同路径 | 显示两个项目并带父路径区分 |
| RP-06 | SSH 超时 | 显示缓存、更新时间和离线标记 |
| RP-07 | SSH 要求密码 | 非交互失败，不挂起 Pet |
| RP-08 | 根目录包含空格或特殊字符 | 参数安全传递，不发生命令注入 |
| RP-09 | 返回超过 500 个仓库 | 中止并提示缩小扫描范围 |
| RP-10 | 点击未登记项目 | 复制路径并提示添加到 Desktop，不声称已打开 |
| RP-11 | 点击正式项目但无导航接口 | 保存选择并打开 Desktop，明确需要确认 |
| RP-12 | 缓存 JSON 损坏 | 忽略损坏缓存并重新刷新，不影响 Pet 启动 |

## 14. 完成定义

阶段 B 只有同时满足以下条件才能声明“可以获取 macCodex 上的所有项目”：

- “所有项目”已明确限定为配置根目录和最大深度内的 Git 仓库。
- Windows 系统 SSH Host 已通过非交互连接测试。
- 真实远程扫描成功并保存完成时间。
- Desktop 注册表与 SSH 扫描结果完成路径级合并。
- 离线、超时、认证和输出超限路线通过测试。
- Pet 菜单或搜索面板完成真实交互验收。

在阶段 B 完成前，只能表述为“列出 Codex Desktop 已登记或历史发现的远程项目”，不能表述为“获取 macCodex 上所有项目”。
