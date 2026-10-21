# Codex 会话交接：Desktop Pet 左键点击与拖动交互修复

## 1. 本轮结果

本轮解决了 Desktop Pet 静止左键无法稳定切换动作、拖动结束可能误触发动效的问题。
点击和窗口拖动现在使用同一套位移阈值语义分流。

## 2. 原问题与影响

原实现会在 `pointerdown` 或原生 `WM_LBUTTONDOWN` 时立即开始拖动，同时透明层、
`MMDStage` 和 Electron 原生层都可能处理同一次左键输入。

## 3. 根因

点击候选和拖动状态没有共享同一位移阈值，WebGPU 舞台命中还可能因为舞台矩形为空
提前退出。

## 4. 解决方式

按下只记录候选；移动超过 6px 才进入拖动；未超过阈值的抬起才进行角色命中和动作选择。
Pet 外层统一动作点击入口，WebGPU 舞台提供画布矩形回退。

## 5. 修改前后行为

- 修改前：按下可能立即拖动，静止点击可能被 DPI 抖动误判，拖动结束可能重复触发动效。
- 修改后：静止短按选择一次动作，超过 6px 只拖动且不选择动作。

## 6. 验证结果

已执行输入路由单元测试、类型检查、构建和真实桌面输入验证。多显示器 DPI 的完整
视觉确认仍需单独复核。

## 7. 范围边界与遗留风险

本交接不重新确认会话中其它历史需求；它们不自动标记为本轮已验证成果。

## 8. 可复用知识候选

- Pet 左键输入路由；
- WebGPU 舞台矩形契约。

<!-- CODEX_KNOWLEDGE_HANDOFF_START -->
```yaml
kind: codex_knowledge_handoff_payload
schema_version: 1
marker:
  kind: codex_knowledge_marker
  schema_version: 1
  knowledge_candidates:
    - local_id: pet-left-click-routing
      title: Pet 左键输入路由
      knowledge_kind_hint: rule
      change_kind: introduce
      author_summary: Desktop Pet 点击和窗口拖动必须通过统一输入状态机分流。
      why_reusable: 透明窗口、原生输入和渲染命中并存时会重复出现输入竞争。
      artifact:
        path: candidates/pet-left-click-routing.md
        media_type: text/markdown
      related_topic_hints:
        - Pet 输入路由
        - 左键点击与拖动分流
      term_changes: []
      evidence_hints:
        - role: repository
          path: desktop-pet/electron/main.ts
      pending_verification:
        - 多显示器 DPI 环境的完整视觉确认
    - local_id: webgpu-stage-rect-contract
      title: WebGPU 舞台矩形契约
      knowledge_kind_hint: contract
      change_kind: introduce
      author_summary: WebGPU 舞台命中必须提供有效的画布矩形回退。
      why_reusable: 动作命中和坐标换算依赖舞台矩形，不能假设所有舞台都有 Three.js 容器。
      artifact:
        path: candidates/webgpu-stage-rect-contract.md
        media_type: text/markdown
      related_topic_hints:
        - WebGPU 舞台
        - 舞台矩形
      term_changes: []
      evidence_hints:
        - role: repository
          path: web/src/features/stage/MMDStage.tsx
      pending_verification: []
artifacts:
  - path: candidates/pet-left-click-routing.md
    media_type: text/markdown
    content: |-
      # Pet 左键输入路由

      ## 核心结论

      左键短按和窗口拖动必须由统一输入状态机分流。

      ## 解决的问题

      多个输入入口竞争同一次左键操作，导致静止点击被误判为拖动。

      ## 定义与关系

      按下进入点击候选；超过 6px 进入拖动；未超过阈值的抬起进入动作选择。

      ## 适用范围

      Desktop Pet 的 `window-drag` 和 `camera-adjust` 左键交互。

      ## 不适用范围与非例

      不定义右键菜单、窗口 resize 或主站普通 MMD 舞台点击。

      ## 尚待验证

      多显示器 DPI 环境的完整视觉确认。

      ## 重新审查条件

      原生鼠标消息、透明层输入或 Pet 外层动作入口发生变化时。

      ## 证据定位提示

      由 FastAPI 在固定 Git revision 上解析 marker 中的 repository hints。

      ## 决策规则

      左键按下只记录候选；指针位移超过 6px 才启动窗口拖动。

      ## 不变量

      静止短按最多选择一次动作；拖动结束不得选择动作。

      ## 例外与优先级

      Electron 原生静止候选只用于 DOM pointerup 丢失时的兜底。

      ## 正例与反例

      原地按下抬起是点击正例；`pointerdown` 立即拖动是反例。
  - path: candidates/webgpu-stage-rect-contract.md
    media_type: text/markdown
    content: |-
      # WebGPU 舞台矩形契约

      ## 核心结论

      WebGPU 舞台必须提供可用于命中和坐标换算的有效画布矩形。

      ## 解决的问题

      WebGPU 没有 Three.js 容器时，通用舞台矩形接口可能返回空值，导致动作选择提前退出。

      ## 定义与关系

      `MMDStage.getStageRect()` 在没有 Three.js 容器时回退到 `RezeWebGpuStage` 画布矩形。

      ## 适用范围

      Desktop Pet 的 WebGPU 舞台角色命中和动作选择。

      ## 不适用范围与非例

      不改变 Three.js 舞台的既有容器矩形语义。

      ## 尚待验证

      不同窗口缩放和多显示器组合下的命中边界。

      ## 重新审查条件

      WebGPU 舞台 DOM 层级或 `MMDStage` 命中接口发生变化时。

      ## 证据定位提示

      由 FastAPI 在固定 Git revision 上解析 WebGPU 舞台和命中调用位置。

      ## 生产者与消费者

      `RezeWebGpuStage` 提供画布矩形，`MMDStage` 和外层输入路由消费该矩形。

      ## 输入输出约束

      输入是当前舞台实例；输出必须是非空、可用于坐标换算的矩形。

      ## 兼容性与版本

      Three.js 舞台继续使用现有容器矩形，WebGPU 只增加画布回退。

      ## 失败行为与验证

      无法提供有效矩形时阻止角色命中，并记录可定位的失败信号。
```
<!-- CODEX_KNOWLEDGE_HANDOFF_END -->
