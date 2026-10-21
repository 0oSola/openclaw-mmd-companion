# 会话展示清洗

## 中文名称与英文机器名

- 中文名称：会话展示清洗
- 英文机器名：`CodexSessionPresentationSanitization`
- 实现入口：`desktop-pet/electron/codexPresentation.ts`

## 概念定义

会话展示清洗是 Desktop Pet 在“发现事实”与“用户可见文本”之间执行的统一边界规则。它不修改 Codex JSONL、API 缓存或 review evidence，而是对进入标题、prompt/summary 预览、完成通知和状态卡的候选文本进行：

1. 识别并过滤运行时注入上下文；
2. 对无效标题按有效候选、工作区名称、摘要顺序回退；
3. 移除命令输出中的机器包装噪声；
4. 脱敏 secret-like 值；
5. 按 UI 允许的长度和行数限界。

## 解决的问题

Codex Desktop 会把 AGENTS、环境、推荐插件、引用会话和其它运行时上下文写进同一条用户消息流。若直接把首条消息当任务标题，Pet 会显示 `<recommended_plugins>` 或 `<app-context>`，并在完成气泡、底部状态卡、会话列表中产生不同结果。命令输出还常带 `Exit code`、进度百分比、分隔线和 `Output:` 包装行，导致卡片显示日志内部格式而不是可读结果。

## 适用与不适用场景

适用：

- Codex Desktop、Codex CLI、WSL、Claude 和 Pet app-server 会话进入统一菜单或状态 UI；
- Pet 重启后读取旧 API 缓存；
- 完成通知、底部状态卡、会话选择器和状态通知需要显示同一会话；
- 只需要 bounded 的用户可读预览。

不适用：

- 修改原始 JSONL、完整 transcript、SQLite evidence 或 OpenClaw payload；
- 判断会话是否真实运行；
- 判断 review 是否值得入队；
- 代替用户查看完整命令输出或完整会话记录。

## 核心不变量

1. 注入上下文不得成为任务标题或 prompt 预览。
2. 无效候选只能触发展示回退，不能覆盖原始会话事实。
3. 同一个会话在主进程汇合、完成气泡、状态卡和会话选择器使用同一标题/输出规则。
4. 输出预览只保留有限行和有限字符，并先脱敏再显示。
5. 机器包装行被过滤，但带有实际错误、警告或结果内容的普通文本必须保留。
6. 展示清洗不能凭进程名或文本内容推断会话状态；状态仍由会话发现和状态归一化规则负责。

## 证据与计算口径

注入上下文识别使用固定前缀集合，包括：

```text
# AGENTS.md instructions
# Files mentioned by the user:
## Referenced ChatGPT conversation
<app-context>
<environment_context>
<permissions instructions>
<plugins_instructions>
<recommended_plugins>
<skills_instructions>
The following is the Codex agent history
```

标题候选按以下顺序解析：

```text
display_title -> first_prompt_preview -> last_summary -> workspace label
```

输出预览过滤：

- `Exit code`、`Wall time`、`Total output lines`；
- 单独的 `Output:`、`warnings`、`errors`、`summary` 等包装行；
- 纯进度百分比；
- 纯分隔线或带 `warnings/errors` 的装饰标题；
- 注入上下文行。

最终行数默认最多 3 行，单行默认最多 180 个字符；敏感值替换为 `[redacted]`。

## 正例

输入：

```text
<recommended_plugins> Here is a list of plugins...
```

工作区为 `D:\workspace\MMD project` 时，展示标题为：

```text
MMD project
```

输入：

```text
Output:
[100%]
================ warnings ================
warning: review required
final result
```

展示输出为：

```text
warning: review required
final result
```

## 反例

- 把 `<recommended_plugins> ...` 显示成完成气泡的任务名；
- 把 `[100%]`、`Exit code: 0` 和分隔线显示成用户结果；
- 完成气泡显示一个标题，底部状态卡又显示未经清洗的另一个标题；
- 为了得到可读预览而把完整 rollout transcript 复制到 API 或 SQLite；
- 清洗后把回退标题写回原始会话文件，破坏证据可追溯性。

## 相关 contract/gate

- `AgentSessionRecord` 到 `PetMenuSession` 的汇合边界；
- Codex 完成通知、状态卡和会话选择器的展示 contract；
- `desktop-pet/electron/codexPresentation.ts` 单元行为测试；
- `electron/codexSessionFiles.test.ts`、`src/codex/codexStatus.test.ts`、`src/codex/completionNotice.test.ts`、`src/codex/sessionPicker.test.ts`；
- `desktop-pet` 的 `npm run test`、`npm run typecheck` 和 `npm run build`。

## 失败后的修正路线

1. UI 仍显示注入标题：先检查主进程 `AgentSessionRecord` 汇合点，再检查 renderer 是否绕过统一 helper。
2. 新 JSONL 已过滤但旧缓存仍污染：检查 `display_title`、`first_prompt_preview` 和 `last_summary` 的展示回退路径。
3. 状态卡仍显示原始日志：在 `formatCodexOutputLines` 增加针对具体包装行的回归测试，不修改状态计算。
4. 构建通过但运行时仍显示旧规则：检查 `package.json` 的主进程入口与 `dist-electron/main.js` 是否为同一编译产物。
5. 清洗规则误删真实结果：缩小前缀/噪声匹配范围，保留最小真实输出夹具并重新运行全量 Pet 测试。

## 与现有概念的关系

会话展示清洗依赖“会话发现”提供候选会话事实，但不参与 Provider 扫描、状态计算、去重或工作区归属。它也不替代“运行中 Agent 会话”：前者回答“如何安全、稳定地显示”，后者回答“哪些会话存在以及它们处于什么状态”。
