# Project Domain Knowledge

This context defines the language used to turn project work and repository facts
into reviewed, durable domain knowledge for people and agents.

## Language

**Domain Term**:
A project-specific term whose meaning cannot be safely inferred from general software vocabulary.
_Avoid_: Keyword, token, jargon

**Concept Delta**:
A structured author explanation of a Domain Term that was introduced, clarified, renamed, deprecated, or superseded during a Codex session.
_Avoid_: Session summary, glossary guess

**Evidence Reference**:
A deterministic reference to an authoritative Contract, implementation, test, validation result, Git fact, or session provenance item.
_Avoid_: Link, citation hint

**Repository Evidence Resolver**:
A read-only fixed-revision resolver that turns bounded repository hints into canonical Evidence References.
_Avoid_: Repository browser, code-generating agent

**Deterministic Domain Knowledge Gate**:
A programmatic decision that reconciles a draft against canonical evidence and assigns needs-author-explanation, needs-evidence, or ready-for-review.
_Avoid_: Prompt quality score, human approval

**Topic Identity Resolver**:
A matcher that uses stable topic IDs, identity keys, aliases, and prior names to find canonical topic candidates without automatically merging them.
_Avoid_: Title slug generator, semantic auto-merge

**Domain Knowledge Candidate**:
An unreviewed proposal for one project domain topic and one primary retrieval intent.
_Avoid_: Review summary, memory draft, Wiki page

**Canonical Domain Note**:
The current reviewed Obsidian Note for one stable domain topic.
_Avoid_: Source note, session note, draft

**Wiki Change Proposal**:
A proposed action, target, affected page set, and complete diff for changing the canonical Domain Wiki.
_Avoid_: Patch suggestion, publish request

**Conflict Proposal**:
A non-publishable proposal that records incompatible definitions, boundaries, invariants, or authoritative evidence and requires a human decision.
_Avoid_: Merge conflict, automatic overwrite

**Accepted Wiki Change Set**:
The exact content and Wiki change approved by a human reviewer for publication.
_Avoid_: Accepted candidate, latest draft

**Publication Receipt**:
The durable result that binds a published Wiki change to its final content hash, path, lint result, and Git revision.
_Avoid_: Success message, publish log

**Incremental Extraction**:
Domain knowledge extraction triggered by a Codex session and its Concept Delta.
_Avoid_: Daily summary

**Baseline Scan**:
A fixed-revision repository scan used to establish or audit the initial Domain Wiki coverage.
_Avoid_: Full transcript scan, automatic Wiki import

**运行中 Agent 会话**：
机器或远程主机上已经启动、仍可通过事件、会话存储、进程或运行时接口观察到的编程助手会话。它不等同于当前选中的工作区，也不要求由 Desktop Pet 启动。
_Avoid_: 当前工作区会话、最近历史会话

**会话发现**：
从多个 Agent Provider 收集会话事实，按稳定会话身份去重，补充运行方式、工作区、主机、状态和最近活动，并向 Pet 提供统一活动视图的过程。
_Avoid_: 单一 JSONL 文件扫描、项目目录发现

**显示链提交边界**：
材质图编译/安装和 draw-call 绑定状态发生变化后，必须经过下一次真实渲染帧的命令提交、HDR resolve、合成/色调映射和画布呈现，变化才成为最终可见输出的边界。冻结渲染循环时，前置状态可以已经更新而画布仍是上一帧。显示链报告以 `pairId` 关联对照、以每侧唯一 `captureId/frame` 绑定请求与 observed render，并在 `displayChain/stageDeltas` 中分别保存实际 draw、HDR resolve 槽、composite 和最终 canvas 证据。
_Avoid_: 把 graph/WGSL/pipeline 编译成功直接当作最终画布已更新

**编译安装非最终显示证明**：
编译与安装只证明着色器和管线阶段成功；它不证明目标 draw 实际使用了新管线，也不证明中间 HDR、resolve、后续合成或最终 canvas 已发生预期变化。健康结论必须由实际阶段差异和零错误计数共同支撑；无新帧故障只能确认提交边界缺失，不能把旧 trace 当作其他假设的证伪。
_Avoid_: 用 pipeline 安装日志、材质计数或 analyzer 阈值替代显示链证据

**显示链绘制身份唯一性**：
生产 draw 与实际 `drawIndexed` 必须按材质名、分组、类型、count、firstIndex 和顺序建立唯一对应；生产 `drawIndex` 与实际 `drawOrder` 分开记录，重复或未匹配必须机器拒绝。
_Avoid_: 按顺序猜配、把生产索引强行当作实际顺序，或用 draw 身份证据替代 HDR/resolve/canvas 证据
