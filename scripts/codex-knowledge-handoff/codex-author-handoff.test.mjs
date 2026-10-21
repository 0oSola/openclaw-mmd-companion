import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  mkdir as fsMkdir,
  mkdtemp,
  readdir,
  readFile,
  rename as fsRename,
  rm as fsRm,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HANDOFF_END, HANDOFF_START, handleStop } from "./index.mjs";

function validPayloadYaml({
  artifactPath = "candidates/pet-left-click-routing.md",
  extraCandidateField = "",
  omitHeading = null,
} = {}) {
  const yaml = [
    "kind: codex_knowledge_handoff_payload",
    "schema_version: 1",
    "marker:",
    "  kind: codex_knowledge_marker",
    "  schema_version: 1",
    "  knowledge_candidates:",
    "    - local_id: pet-left-click-routing",
    "      title: Pet 左键输入路由",
    "      knowledge_kind_hint: rule",
    "      change_kind: introduce",
    "      author_summary: 点击和拖动使用统一输入状态机分流。",
    "      why_reusable: 透明窗口输入入口竞争时需要稳定分流。",
    "      artifact:",
    `        path: ${artifactPath}`,
    "        media_type: text/markdown",
    "      related_topic_hints:",
    "        - Pet 输入路由",
    "      term_changes: []",
    "      evidence_hints: []",
    "      pending_verification: []",
    extraCandidateField,
    "artifacts:",
    `  - path: ${artifactPath}`,
    "    media_type: text/markdown",
    "    content: |-",
    "      # Pet 左键输入路由",
    "      ",
    "      ## 核心结论",
    "      ",
    "      点击和拖动必须分流。",
    "      ",
    "      ## 解决的问题",
    "      ",
    "      透明窗口的多个输入入口会竞争同一次左键操作。",
    "      ",
    "      ## 定义与关系",
    "      ",
    "      短按进入动作选择，超过阈值进入拖动。",
    "      ",
    "      ## 适用范围",
    "      ",
    "      Desktop Pet 左键交互。",
    "      ",
    "      ## 不适用范围与非例",
    "      ",
    "      不定义右键菜单和窗口 resize。",
    "      ",
    "      ## 尚待验证",
    "      ",
    "      多显示器 DPI 真实桌面验证。",
    "      ",
    "      ## 重新审查条件",
    "      ",
    "      输入层或窗口拖动实现发生变化时。",
    "      ",
    "      ## 证据定位提示",
    "      ",
    "      见 marker.evidence_hints 和固定仓库 revision。",
    "      ",
    "      ## 决策规则",
    "      ",
    "      按下只记录候选，超过 6px 才拖动。",
    "      ",
    "      ## 不变量",
    "      ",
    "      拖动结束不得触发动作选择。",
    "      ",
    "      ## 例外与优先级",
    "      ",
    "      原生候选只作为 DOM 事件缺失时的兜底。",
    "      ",
    "      ## 正例与反例",
    "      ",
    "      静止抬起是正例，pointerdown 立即拖动是反例。",
  ].filter(Boolean).join("\n");
  return omitHeading ? yaml.replace(`${omitHeading}\n`, "") : yaml;
}

function envelopeMessage(yaml, human = "# Codex 会话交接") {
  return [
    human,
    "",
    HANDOFF_START,
    "```yaml",
    yaml,
    "```",
    HANDOFF_END,
  ].join("\n");
}

function runStopHook(input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["./stop-hook.mjs"], {
      cwd: new URL(".", import.meta.url),
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Stop Hook exit ${code}: ${stderr}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
    child.stdin.end(JSON.stringify(input));
  });
}

test("没有作者知识载荷时正常放行且不创建交接包", async () => {
  const handoffRoot = await mkdtemp(join(tmpdir(), "codex-handoff-test-"));

  const result = await handleStop(
    {
      last_assistant_message: "# 普通任务总结\n\n本轮完成了一个普通修复。",
      session_id: "session-1",
      turn_id: "turn-1",
      cwd: "D:\\workspace\\MMD project",
    },
    {
      handoffRoot,
      now: () => "2026-08-05T12:00:00.000Z",
      captureRepositoryState: async () => ({
        detected: false,
        root: null,
        head_commit: null,
        branch: null,
        dirty: false,
        status_sha256: null,
      }),
    },
  );

  assert.deepEqual(result, { continue: true });
  assert.deepEqual(await readdir(handoffRoot), []);
});

test("有效作者载荷会原子落盘为 3+N 交接包", async () => {
  const handoffRoot = await mkdtemp(join(tmpdir(), "codex-handoff-test-"));
  const message = envelopeMessage(
    validPayloadYaml(),
    "# Codex 会话交接：输入路由\n\n## 本轮结果\n\n静止点击与窗口拖动已经分离。",
  );

  const result = await handleStop(
    {
      last_assistant_message: message,
      session_id: "session-1",
      turn_id: "turn-1",
      cwd: "D:\\workspace\\MMD project",
    },
    {
      handoffRoot,
      workspaceKey: "mmd-project",
      handoffIdFactory: () => "kh_test",
      now: () => "2026-08-05T12:00:00.000Z",
      captureRepositoryState: async () => ({
        detected: true,
        root: "D:\\workspace\\MMD project",
        head_commit: "cab8efa90d1432b76ef11d926c04d504f8b02c27",
        branch: "codex/kh-01-author-handoff",
        dirty: false,
        status_sha256: "sha256:status",
      }),
    },
  );

  assert.equal(result.continue, true);
  assert.equal(result.handoffId, "kh_test");
  const packageRoot = join(handoffRoot, "mmd-project", "kh_test");
  await access(join(packageRoot, ".complete"));

  assert.equal(
    await readFile(join(packageRoot, "handoff.md"), "utf8"),
    "# Codex 会话交接：输入路由\n\n## 本轮结果\n\n静止点击与窗口拖动已经分离。\n",
  );
  assert.match(await readFile(join(packageRoot, "marker.yaml"), "utf8"), /pet-left-click-routing/u);
  assert.equal(
    await readFile(join(packageRoot, "candidates", "pet-left-click-routing.md"), "utf8"),
    "# Pet 左键输入路由\n\n## 核心结论\n\n点击和拖动必须分流。\n\n## 解决的问题\n\n透明窗口的多个输入入口会竞争同一次左键操作。\n\n## 定义与关系\n\n短按进入动作选择，超过阈值进入拖动。\n\n## 适用范围\n\nDesktop Pet 左键交互。\n\n## 不适用范围与非例\n\n不定义右键菜单和窗口 resize。\n\n## 尚待验证\n\n多显示器 DPI 真实桌面验证。\n\n## 重新审查条件\n\n输入层或窗口拖动实现发生变化时。\n\n## 证据定位提示\n\n见 marker.evidence_hints 和固定仓库 revision。\n\n## 决策规则\n\n按下只记录候选，超过 6px 才拖动。\n\n## 不变量\n\n拖动结束不得触发动作选择。\n\n## 例外与优先级\n\n原生候选只作为 DOM 事件缺失时的兜底。\n\n## 正例与反例\n\n静止抬起是正例，pointerdown 立即拖动是反例。\n",
  );

  const metadata = JSON.parse(await readFile(join(packageRoot, "metadata.json"), "utf8"));
  assert.equal(metadata.handoff_id, "kh_test");
  assert.equal(metadata.source.session_id, "session-1");
  assert.equal(metadata.repository_capture.head_commit, "cab8efa90d1432b76ef11d926c04d504f8b02c27");
  assert.equal(metadata.artifacts.length, 3);
});

test("已声明作者载荷但 YAML 非法时阻止结束且不留下半成品", async () => {
  const handoffRoot = await mkdtemp(join(tmpdir(), "codex-handoff-test-"));
  const message = [
    "# Codex 会话交接：非法载荷",
    "",
    HANDOFF_START,
    "```yaml",
    "kind: codex_knowledge_handoff_payload",
    "schema_version: 1",
    "marker: [",
    "```",
    HANDOFF_END,
  ].join("\n");

  const result = await handleStop(
    {
      last_assistant_message: message,
      session_id: "session-invalid",
      turn_id: "turn-invalid",
      cwd: "D:\\workspace\\MMD project",
    },
    { handoffRoot },
  );

  assert.equal(result.continue, false);
  assert.match(result.stopReason, /YAML/u);
  assert.deepEqual(await readdir(handoffRoot), []);
});

test("重复 YAML 键被拒绝", async () => {
  const handoffRoot = await mkdtemp(join(tmpdir(), "codex-handoff-test-"));
  const message = [
    "# 重复键",
    "",
    HANDOFF_START,
    "```yaml",
    "kind: codex_knowledge_handoff_payload",
    "schema_version: 1",
    "schema_version: 1",
    "marker: {}",
    "artifacts: []",
    "```",
    HANDOFF_END,
  ].join("\n");

  const result = await handleStop(
    { last_assistant_message: message, cwd: "D:\\workspace\\MMD project" },
    { handoffRoot },
  );

  assert.equal(result.continue, false);
  assert.match(result.stopReason, /YAML/u);
  assert.deepEqual(await readdir(handoffRoot), []);
});

test("candidate 路径穿越被拒绝", async () => {
  const handoffRoot = await mkdtemp(join(tmpdir(), "codex-handoff-test-"));
  const result = await handleStop(
    {
      last_assistant_message: envelopeMessage(
        validPayloadYaml({ artifactPath: "candidates/../outside.md" }),
      ),
      cwd: "D:\\workspace\\MMD project",
    },
    { handoffRoot },
  );

  assert.equal(result.continue, false);
  assert.match(result.stopReason, /路径/u);
  assert.deepEqual(await readdir(handoffRoot), []);
});

test("候选不得携带主题归属或发布动作字段", async () => {
  const handoffRoot = await mkdtemp(join(tmpdir(), "codex-handoff-test-"));
  const result = await handleStop(
    {
      last_assistant_message: envelopeMessage(
        validPayloadYaml({ extraCandidateField: "      target_path: domains/pet.md" }),
      ),
      cwd: "D:\\workspace\\MMD project",
    },
    { handoffRoot },
  );

  assert.equal(result.continue, false);
  assert.match(result.stopReason, /禁止字段|不允许字段/u);
  assert.deepEqual(await readdir(handoffRoot), []);
});

test("候选缺少公共或类型专属章节时被拒绝", async () => {
  const handoffRoot = await mkdtemp(join(tmpdir(), "codex-handoff-test-"));
  const result = await handleStop(
    {
      last_assistant_message: envelopeMessage(
        validPayloadYaml({ omitHeading: "      ## 决策规则" }),
      ),
      cwd: "D:\\workspace\\MMD project",
    },
    { handoffRoot },
  );

  assert.equal(result.continue, false);
  assert.match(result.stopReason, /决策规则/u);
  assert.deepEqual(await readdir(handoffRoot), []);
});

test("有效作者载荷缺少真实来源身份时被拒绝", async () => {
  const handoffRoot = await mkdtemp(join(tmpdir(), "codex-handoff-identity-"));
  const result = await handleStop(
    {
      last_assistant_message: envelopeMessage(validPayloadYaml()),
      cwd: "D:\\workspace\\MMD project",
    },
    { handoffRoot },
  );

  assert.equal(result.continue, false);
  assert.match(result.stopReason, /session_id 和 turn_id/u);
  assert.deepEqual(await readdir(handoffRoot), []);
});

test("任何嵌套层级都不得伪造 Evidence Reference ID", async () => {
  const handoffRoot = await mkdtemp(join(tmpdir(), "codex-handoff-test-"));
  const yaml = validPayloadYaml().replace(
    "      evidence_hints: []",
    "      evidence_hints:\n        - evidence_reference_id: fake-ref",
  );
  const result = await handleStop(
    {
      last_assistant_message: envelopeMessage(yaml),
      session_id: "session-fence",
      turn_id: "turn-fence",
      cwd: "D:\\workspace\\MMD project",
    },
    { handoffRoot },
  );

  assert.equal(result.continue, false);
  assert.match(result.stopReason, /禁止字段/u);
  assert.deepEqual(await readdir(handoffRoot), []);
});

test("Stop Hook CLI 通过标准输入返回放行结果", async () => {
  const handoffRoot = await mkdtemp(join(tmpdir(), "codex-handoff-cli-"));
  const result = await runStopHook(
    {
      last_assistant_message: "# 普通回复\n\n没有知识载荷。",
      cwd: "D:\\workspace\\MMD project",
    },
    { CODEX_HOME: handoffRoot },
  );

  assert.deepEqual(result, { continue: true });
});

test("Stop Hook CLI 通过公共入口落盘有效 Desktop Pet 样例", async () => {
  const handoffRoot = await mkdtemp(join(tmpdir(), "codex-handoff-cli-valid-"));
  const fixture = await readFile(
    new URL("./fixtures/desktop-pet-left-click-handoff.response.md", import.meta.url),
    "utf8",
  );
  const result = await runStopHook(
    {
      last_assistant_message: fixture,
      session_id: "session-cli-valid",
      turn_id: "turn-cli-valid",
      cwd: "D:\\workspace\\MMD project",
    },
    { CODEX_HOME: handoffRoot },
  );

  assert.equal(result.continue, true);
  await access(join(result.packagePath, ".complete"));
  assert.match(result.packagePath, /knowledge-handoffs/u);
});

test("重复或不成对的作者载荷边界被拒绝", async () => {
  const handoffRoot = await mkdtemp(join(tmpdir(), "codex-handoff-test-"));
  const message = [
    "# 重复边界",
    HANDOFF_START,
    "```yaml",
    validPayloadYaml(),
    "```",
    HANDOFF_END,
    HANDOFF_END,
  ].join("\n");

  const result = await handleStop(
    { last_assistant_message: message, cwd: "D:\\workspace\\MMD project" },
    { handoffRoot },
  );

  assert.equal(result.continue, false);
  assert.match(result.stopReason, /边界/u);
  assert.deepEqual(await readdir(handoffRoot), []);
});

test("结束边界后的非空文本被拒绝而不是静默丢弃", async () => {
  const handoffRoot = await mkdtemp(join(tmpdir(), "codex-handoff-trailing-"));
  const result = await handleStop(
    {
      last_assistant_message: `${envelopeMessage(validPayloadYaml())}\n\n这段文本不属于交接包。`,
      cwd: "D:\\workspace\\MMD project",
    },
    { handoffRoot },
  );

  assert.equal(result.continue, false);
  assert.match(result.stopReason, /结束边界后/u);
  assert.deepEqual(await readdir(handoffRoot), []);
});

test("中途文件写入失败会清理 staging 且不创建 .complete", async () => {
  const handoffRoot = await mkdtemp(join(tmpdir(), "codex-handoff-write-failure-"));
  const result = await handleStop(
    {
      last_assistant_message: envelopeMessage(validPayloadYaml()),
      session_id: "session-write-failure",
      turn_id: "turn-write-failure",
      cwd: "D:\\workspace\\MMD project",
    },
    {
      handoffRoot,
      workspaceKey: "mmd-project",
      handoffIdFactory: () => "kh_write_failure",
      captureRepositoryState: async () => ({
        detected: false,
        root: null,
        head_commit: null,
        branch: null,
        dirty: false,
        status_sha256: null,
      }),
      fs: {
        mkdir: fsMkdir,
        rename: fsRename,
        rm: fsRm,
        writeFile: async (target, ...args) => {
          if (String(target).endsWith(".complete")) {
            throw new Error("injected complete write failure");
          }
          return fsWriteFile(target, ...args);
        },
      },
    },
  );

  assert.equal(result.continue, false);
  assert.match(result.stopReason, /injected complete write failure/u);
  assert.deepEqual(await readdir(join(handoffRoot, "mmd-project")), []);
});

test("YAML anchors 被拒绝", async () => {
  const handoffRoot = await mkdtemp(join(tmpdir(), "codex-handoff-test-"));
  const result = await handleStop(
    {
      last_assistant_message: envelopeMessage([
        "kind: codex_knowledge_handoff_payload",
        "schema_version: 1",
        "marker: &marker",
        "  kind: codex_knowledge_marker",
        "  schema_version: 1",
        "  knowledge_candidates: []",
        "artifacts: []",
      ].join("\n")),
      cwd: "D:\\workspace\\MMD project",
    },
    { handoffRoot },
  );

  assert.equal(result.continue, false);
  assert.match(result.stopReason, /anchor|YAML|knowledge_candidates/u);
  assert.deepEqual(await readdir(handoffRoot), []);
});

test("一份交接包可以包含多个独立 candidate", async () => {
  const handoffRoot = await mkdtemp(join(tmpdir(), "codex-handoff-test-"));
  const message = envelopeMessage([
    "kind: codex_knowledge_handoff_payload",
    "schema_version: 1",
    "marker:",
    "  kind: codex_knowledge_marker",
    "  schema_version: 1",
    "  knowledge_candidates:",
    "    - local_id: pet-left-click-routing",
    "      title: Pet 左键输入路由",
    "      knowledge_kind_hint: rule",
    "      change_kind: introduce",
    "      author_summary: 点击和拖动统一分流。",
    "      why_reusable: 透明窗口会重复遇到输入竞争。",
    "      artifact:",
    "        path: candidates/pet-left-click-routing.md",
    "        media_type: text/markdown",
    "      related_topic_hints: []",
    "      term_changes: []",
    "      evidence_hints: []",
    "      pending_verification: []",
    "    - local_id: webgpu-stage-rect-contract",
    "      title: WebGPU 舞台矩形契约",
    "      knowledge_kind_hint: contract",
    "      change_kind: introduce",
    "      author_summary: WebGPU 舞台必须提供有效矩形。",
    "      why_reusable: 命中后的动作选择依赖舞台坐标。",
    "      artifact:",
    "        path: candidates/webgpu-stage-rect-contract.md",
    "        media_type: text/markdown",
    "      related_topic_hints: []",
    "      term_changes: []",
    "      evidence_hints: []",
    "      pending_verification: []",
    "artifacts:",
    "  - path: candidates/pet-left-click-routing.md",
    "    media_type: text/markdown",
    "    content: |-",
    "      # Pet 左键输入路由",
    "      ## 核心结论",
    "      ## 解决的问题",
    "      ## 定义与关系",
    "      ## 适用范围",
    "      ## 不适用范围与非例",
    "      ## 尚待验证",
    "      ## 重新审查条件",
    "      ## 证据定位提示",
    "      ## 决策规则",
    "      ## 不变量",
    "      ## 例外与优先级",
    "      ## 正例与反例",
    "  - path: candidates/webgpu-stage-rect-contract.md",
    "    media_type: text/markdown",
    "    content: |-",
    "      # WebGPU 舞台矩形契约",
    "      ## 核心结论",
    "      ## 解决的问题",
    "      ## 定义与关系",
    "      ## 适用范围",
    "      ## 不适用范围与非例",
    "      ## 尚待验证",
    "      ## 重新审查条件",
    "      ## 证据定位提示",
    "      ## 生产者与消费者",
    "      ## 输入输出约束",
    "      ## 兼容性与版本",
    "      ## 失败行为与验证",
  ].join("\n"), "# Codex 会话交接：两个候选");

  const result = await handleStop(
    {
      last_assistant_message: message,
      session_id: "session-multi",
      turn_id: "turn-multi",
      cwd: "D:\\workspace\\MMD project",
    },
    {
      handoffRoot,
      workspaceKey: "mmd-project",
      handoffIdFactory: () => "kh_multi",
      captureRepositoryState: async () => ({
        detected: false,
        root: null,
        head_commit: null,
        branch: null,
        dirty: false,
        status_sha256: null,
      }),
    },
  );

  assert.equal(result.continue, true);
  const packageRoot = join(handoffRoot, "mmd-project", "kh_multi");
  await access(join(packageRoot, "candidates", "pet-left-click-routing.md"));
  await access(join(packageRoot, "candidates", "webgpu-stage-rect-contract.md"));
  const marker = await readFile(join(packageRoot, "marker.yaml"), "utf8");
  assert.match(marker, /pet-left-click-routing/u);
  assert.match(marker, /webgpu-stage-rect-contract/u);
});

test("真实 Desktop Pet 会话交接样例可以通过并生成两个 candidate", async () => {
  const handoffRoot = await mkdtemp(join(tmpdir(), "codex-handoff-fixture-"));
  const fixture = await readFile(
    new URL("./fixtures/desktop-pet-left-click-handoff.response.md", import.meta.url),
    "utf8",
  );

  const result = await handleStop(
    {
      last_assistant_message: fixture,
      session_id: "019fcbe9-8005-7190-9b38-8f5d7b555697",
      turn_id: "turn-fixture",
      cwd: "D:\\workspace\\MMD project",
    },
    {
      handoffRoot,
      workspaceKey: "mmd-project",
      handoffIdFactory: () => "kh_fixture",
      captureRepositoryState: async () => ({
        detected: false,
        root: null,
        head_commit: null,
        branch: null,
        dirty: false,
        status_sha256: null,
      }),
    },
  );

  assert.equal(result.continue, true);
  const packageRoot = join(handoffRoot, "mmd-project", "kh_fixture");
  const marker = await readFile(join(packageRoot, "marker.yaml"), "utf8");
  assert.match(marker, /pet-left-click-routing/u);
  assert.match(marker, /webgpu-stage-rect-contract/u);
  assert.match(
    await readFile(join(packageRoot, "candidates", "pet-left-click-routing.md"), "utf8"),
    /拖动结束不得选择动作/u,
  );
  assert.match(
    await readFile(join(packageRoot, "candidates", "webgpu-stage-rect-contract.md"), "utf8"),
    /有效画布矩形/u,
  );
});

test("同一 handoff_id 冲突时不覆盖已有交接包", async () => {
  const handoffRoot = await mkdtemp(join(tmpdir(), "codex-handoff-collision-"));
  const message = envelopeMessage(validPayloadYaml());
  const input = {
    last_assistant_message: message,
    session_id: "session-collision",
    turn_id: "turn-collision",
    cwd: "D:\\workspace\\MMD project",
  };
  const options = {
    handoffRoot,
    workspaceKey: "mmd-project",
    handoffIdFactory: () => "kh_collision",
    captureRepositoryState: async () => ({
      detected: false,
      root: null,
      head_commit: null,
      branch: null,
      dirty: false,
      status_sha256: null,
    }),
  };

  const first = await handleStop(input, options);
  const second = await handleStop(input, options);

  assert.equal(first.continue, true);
  assert.equal(second.continue, true);
  assert.equal(second.duplicate, true);
  const workspaceEntries = await readdir(join(handoffRoot, "mmd-project"));
  assert.deepEqual(workspaceEntries, ["kh_collision"]);
});

test("candidate 内嵌 Markdown 代码围栏不会截断外层 YAML 载荷", async () => {
  const handoffRoot = await mkdtemp(join(tmpdir(), "codex-handoff-fence-"));
  const yaml = validPayloadYaml().replace(
    "      点击和拖动必须分流。",
    "      ```ts\n      const state = \"Pressed\";\n      ```",
  );
  const result = await handleStop(
    {
      last_assistant_message: envelopeMessage(yaml),
      session_id: "session-fence",
      turn_id: "turn-fence",
      cwd: "D:\\workspace\\MMD project",
    },
    {
      handoffRoot,
      workspaceKey: "mmd-project",
      handoffIdFactory: () => "kh_fence",
      captureRepositoryState: async () => ({
        detected: false,
        root: null,
        head_commit: null,
        branch: null,
        dirty: false,
        status_sha256: null,
      }),
    },
  );

  assert.equal(result.continue, true);
  assert.match(
    await readFile(
      join(handoffRoot, "mmd-project", "kh_fence", "candidates", "pet-left-click-routing.md"),
      "utf8",
    ),
    /```ts[\s\S]*Pressed[\s\S]*```/u,
  );
});
