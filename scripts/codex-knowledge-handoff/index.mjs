import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir as fsMkdir, readFile, rename as fsRename, rm as fsRm, writeFile as fsWriteFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";
import { promisify } from "node:util";
import YAML from "yaml";

const execFile = promisify(execFileCallback);

export const HANDOFF_START = "<!-- CODEX_KNOWLEDGE_HANDOFF_START -->";
export const HANDOFF_END = "<!-- CODEX_KNOWLEDGE_HANDOFF_END -->";

const PAYLOAD_KIND = "codex_knowledge_handoff_payload";
const MARKER_KIND = "codex_knowledge_marker";
const SCHEMA_VERSION = 1;
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
const MAX_CANDIDATES = 16;
const MAX_CANDIDATE_BYTES = 512 * 1024;
const MAX_TOTAL_ARTIFACT_BYTES = 4 * 1024 * 1024;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/u;
const SAFE_HANDOFF_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/u;
const SAFE_ARTIFACT_PATH = /^candidates\/[a-z0-9][a-z0-9._-]{0,180}\.md$/u;
const KNOWLEDGE_KINDS = new Set([
  "concept",
  "entity",
  "relationship",
  "rule",
  "workflow",
  "contract",
  "gate",
  "policy",
  "architecture_decision",
  "failure_classification",
]);
const CHANGE_KINDS = new Set(["introduce", "modify", "deprecate"]);
const COMMON_CANDIDATE_HEADINGS = [
  "## 核心结论",
  "## 解决的问题",
  "## 定义与关系",
  "## 适用范围",
  "## 不适用范围与非例",
  "## 尚待验证",
  "## 重新审查条件",
  "## 证据定位提示",
];
const KIND_CANDIDATE_HEADINGS = {
  concept: ["## 身份与生命周期", "## 关系方向与基数", "## 易混淆概念"],
  entity: ["## 身份与生命周期", "## 关系方向与基数", "## 易混淆概念"],
  relationship: ["## 身份与生命周期", "## 关系方向与基数", "## 易混淆概念"],
  rule: ["## 决策规则", "## 不变量", "## 例外与优先级", "## 正例与反例"],
  policy: ["## 决策规则", "## 不变量", "## 例外与优先级", "## 正例与反例"],
  workflow: ["## 输入与前置条件", "## 阶段与角色", "## 输出", "## 失败与恢复"],
  contract: ["## 生产者与消费者", "## 输入输出约束", "## 兼容性与版本", "## 失败行为与验证"],
  gate: ["## 检查对象", "## 阻断条件", "## 修正路线", "## 通过标准"],
  architecture_decision: ["## 背景", "## 备选方案与取舍", "## 后果与限制", "## 反转条件"],
  failure_classification: ["## 症状与判定标准", "## 根因范围与排除项", "## 修复与预防"],
};
const MARKER_KEYS = new Set(["kind", "schema_version", "knowledge_candidates"]);
const CANDIDATE_KEYS = new Set([
  "local_id",
  "title",
  "knowledge_kind_hint",
  "change_kind",
  "author_summary",
  "why_reusable",
  "artifact",
  "related_topic_hints",
  "term_changes",
  "evidence_hints",
  "pending_verification",
]);
const ARTIFACT_KEYS = new Set(["path", "media_type", "content"]);
const FORBIDDEN_MARKER_KEYS = new Set([
  "suggested_action",
  "publication_action",
  "topic_id",
  "target_path",
  "approval_status",
  "canonical_status",
  "handoff_id",
  "evidence_reference_id",
  "evidence_ref_id",
]);
const FORBIDDEN_KEYS_NORMALIZED = new Set([
  ...FORBIDDEN_MARKER_KEYS,
  "evidence_reference_ids",
  "evidence_ref_ids",
]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertObject(value, label) {
  if (!isPlainObject(value)) throw new Error(`${label} 必须是对象`);
}

function assertAllowedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} 不允许字段：${key}`);
  }
}

function assertString(value, label, { nonEmpty = true, maxLength = 4096 } = {}) {
  if (typeof value !== "string" || (nonEmpty && value.trim() === "")) {
    throw new Error(`${label} 必须是${nonEmpty ? "非空" : ""}字符串`);
  }
  if (value.length > maxLength) throw new Error(`${label} 超过长度限制`);
}

function assertStringList(value, label, { maxItems = 64 } = {}) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`${label} 必须是有限字符串数组`);
  }
  for (const [index, item] of value.entries()) {
    assertString(item, `${label}[${index}]`, { maxLength: 1024 });
  }
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
}

function sanitizeWorkspaceKey(value) {
  const normalized = String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.normalize("NFKC")
    .replace(/[^A-Za-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replaceAll("_", "-")
    .toLowerCase();
  const key = normalized || "unknown-workspace";
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(key)) {
    throw new Error("workspace_key 不符合安全命名规则");
  }
  return key;
}

function deriveWorkspaceKey(input, options) {
  if (options.workspaceKey) return sanitizeWorkspaceKey(options.workspaceKey);
  if (input.workspace_key) return sanitizeWorkspaceKey(input.workspace_key);
  return sanitizeWorkspaceKey(input.cwd ?? "unknown-workspace");
}

function assertSafeArtifactPath(value) {
  assertString(value, "artifact.path", { maxLength: 240 });
  if (
    value.includes("\\")
    || value.includes("\0")
    || posix.isAbsolute(value)
    || win32.isAbsolute(value)
  ) {
    throw new Error(`artifact.path 必须是使用 / 的相对路径：${value}`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`artifact.path 包含非法路径段：${value}`);
  }
  if (!SAFE_ARTIFACT_PATH.test(value)) {
    throw new Error(`artifact.path 必须是 candidates/ 下的安全 Markdown 文件名：${value}`);
  }
}

function assertNoFrontmatter(content, path) {
  if (/^\uFEFF?---(?:\r?\n|$)/u.test(content)) {
    throw new Error(`candidate 不允许 YAML frontmatter：${path}`);
  }
}

function assertNoForbiddenKeys(value, path = "payload") {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertNoForbiddenKeys(item, `${path}[${index}]`);
    }
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
    const forbidden = [...FORBIDDEN_KEYS_NORMALIZED].some(
      (candidate) => candidate.toLowerCase().replace(/[^a-z0-9]/gu, "") === normalized,
    );
    if (forbidden) throw new Error(`${path} 禁止字段：${key}`);
    assertNoForbiddenKeys(child, `${path}.${key}`);
  }
}

function assertCandidateBody(content, candidate, path) {
  const firstHeading = content.match(/^#\s+(.+)$/mu);
  if (!firstHeading || firstHeading[1].trim() !== candidate.title) {
    throw new Error(`candidate 首标题必须与 marker.title 一致：${path}`);
  }
  const requiredHeadings = [
    ...COMMON_CANDIDATE_HEADINGS,
    ...(KIND_CANDIDATE_HEADINGS[candidate.knowledge_kind_hint] || []),
  ];
  for (const heading of requiredHeadings) {
    const pattern = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*$`, "mu");
    if (!pattern.test(content)) throw new Error(`candidate 缺少章节 ${heading}：${path}`);
  }
}

function visitYamlNode(node, seen = new WeakSet()) {
  if (node === null || typeof node !== "object") return;
  if (seen.has(node)) return;
  seen.add(node);

  if (node.anchor) throw new Error("YAML 不允许 anchors");
  if (node.tag) throw new Error("YAML 不允许 custom tags");
  if (node.type === "ALIAS" || node.constructor?.name === "Alias") {
    throw new Error("YAML 不允许 aliases");
  }

  if (Array.isArray(node)) {
    for (const item of node) visitYamlNode(item, seen);
    return;
  }

  if ("key" in node) visitYamlNode(node.key, seen);
  if ("value" in node) visitYamlNode(node.value, seen);
  if (Array.isArray(node.items)) {
    for (const item of node.items) visitYamlNode(item, seen);
  }
  if (node.contents) visitYamlNode(node.contents, seen);
}

function parseYamlPayload(rawYaml) {
  let document;
  try {
    document = YAML.parseDocument(rawYaml, {
      version: "1.2",
      schema: "core",
      uniqueKeys: true,
      stringKeys: true,
      prettyErrors: false,
      maxAliasCount: 0,
    });
  } catch (error) {
    throw new Error(`YAML 解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (document.errors.length > 0) {
    throw new Error(`YAML 校验失败：${document.errors[0].message}`);
  }
  visitYamlNode(document.contents);
  let value;
  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new Error(`YAML 安全转换失败：${error instanceof Error ? error.message : String(error)}`);
  }
  assertObject(value, "机器载荷");
  return value;
}

function extractEnvelope(message) {
  const startCount = countOccurrences(message, HANDOFF_START);
  const endCount = countOccurrences(message, HANDOFF_END);
  if (startCount === 0 && endCount === 0) return null;
  if (startCount !== 1 || endCount !== 1) {
    throw new Error("作者知识交接边界必须各出现一次");
  }

  const startIndex = message.indexOf(HANDOFF_START);
  const endIndex = message.indexOf(HANDOFF_END);
  if (endIndex <= startIndex) throw new Error("作者知识交接结束边界位置无效");
  if (message.slice(endIndex + HANDOFF_END.length).trim() !== "") {
    throw new Error("作者知识交接结束边界后不允许存在非空文本");
  }

  const machineBlock = message
    .slice(startIndex + HANDOFF_START.length, endIndex)
    .trim();
  const fenced = machineBlock.match(/^```yaml\r?\n([\s\S]*?)\r?\n```$/u);
  if (!fenced) throw new Error("作者知识交接必须包含唯一的 yaml 代码块");

  return {
    humanText: message.slice(0, startIndex).trimEnd() + "\n",
    payload: parseYamlPayload(fenced[1]),
  };
}

function validateCandidate(candidate, candidateIndex, artifactsByPath) {
  assertObject(candidate, `marker.knowledge_candidates[${candidateIndex}]`);
  assertAllowedKeys(candidate, CANDIDATE_KEYS, `candidate[${candidateIndex}]`);
  assertString(candidate.local_id, `candidate[${candidateIndex}].local_id`, { maxLength: 128 });
  if (!SAFE_ID.test(candidate.local_id)) {
    throw new Error(`candidate[${candidateIndex}].local_id 不符合安全命名规则`);
  }
  assertString(candidate.title, `candidate[${candidateIndex}].title`, { maxLength: 300 });
  if (!KNOWLEDGE_KINDS.has(candidate.knowledge_kind_hint)) {
    throw new Error(`candidate[${candidateIndex}].knowledge_kind_hint 无效`);
  }
  if (!CHANGE_KINDS.has(candidate.change_kind)) {
    throw new Error(`candidate[${candidateIndex}].change_kind 无效`);
  }
  assertString(candidate.author_summary, `candidate[${candidateIndex}].author_summary`);
  assertString(candidate.why_reusable, `candidate[${candidateIndex}].why_reusable`);

  assertObject(candidate.artifact, `candidate[${candidateIndex}].artifact`);
  if (Object.keys(candidate.artifact).some((key) => key !== "path" && key !== "media_type")) {
    throw new Error(`candidate[${candidateIndex}].artifact 存在未知字段`);
  }
  assertSafeArtifactPath(candidate.artifact.path);
  if (candidate.artifact.media_type !== "text/markdown") {
    throw new Error(`candidate[${candidateIndex}].artifact.media_type 必须为 text/markdown`);
  }
  if (artifactsByPath.has(candidate.artifact.path)) {
    throw new Error(`candidate artifact 路径重复：${candidate.artifact.path}`);
  }
  artifactsByPath.set(candidate.artifact.path, candidate);

  assertStringList(candidate.related_topic_hints, `candidate[${candidateIndex}].related_topic_hints`);
  if (!Array.isArray(candidate.term_changes)) {
    throw new Error(`candidate[${candidateIndex}].term_changes 必须是数组`);
  }
  if (!Array.isArray(candidate.evidence_hints)) {
    throw new Error(`candidate[${candidateIndex}].evidence_hints 必须是数组`);
  }
  assertStringList(candidate.pending_verification, `candidate[${candidateIndex}].pending_verification`);
}

function validateEnvelope(payload) {
  assertObject(payload, "机器载荷");
  assertNoForbiddenKeys(payload);
  assertAllowedKeys(payload, new Set(["kind", "schema_version", "marker", "artifacts"]), "机器载荷");
  if (payload.kind !== PAYLOAD_KIND) throw new Error(`机器载荷 kind 必须为 ${PAYLOAD_KIND}`);
  if (payload.schema_version !== SCHEMA_VERSION) {
    throw new Error(`机器载荷 schema_version 必须为 ${SCHEMA_VERSION}`);
  }

  assertObject(payload.marker, "marker");
  assertAllowedKeys(payload.marker, MARKER_KEYS, "marker");
  if (payload.marker.kind !== MARKER_KIND) throw new Error(`marker.kind 必须为 ${MARKER_KIND}`);
  if (payload.marker.schema_version !== SCHEMA_VERSION) {
    throw new Error(`marker.schema_version 必须为 ${SCHEMA_VERSION}`);
  }
  if (
    !Array.isArray(payload.marker.knowledge_candidates)
    || payload.marker.knowledge_candidates.length === 0
    || payload.marker.knowledge_candidates.length > MAX_CANDIDATES
  ) {
    throw new Error(`knowledge_candidates 数量必须在 1 到 ${MAX_CANDIDATES} 之间`);
  }

  const artifacts = payload.artifacts;
  if (!Array.isArray(artifacts) || artifacts.length !== payload.marker.knowledge_candidates.length) {
    throw new Error("artifacts 必须与 knowledge_candidates 一一对应");
  }

  const artifactsByPath = new Map();
  const localIds = new Set();
  let totalBytes = 0;
  for (const [index, candidate] of payload.marker.knowledge_candidates.entries()) {
    validateCandidate(candidate, index, artifactsByPath);
    if (localIds.has(candidate.local_id)) {
      throw new Error(`candidate.local_id 重复：${candidate.local_id}`);
    }
    localIds.add(candidate.local_id);
  }

  const normalizedArtifacts = [];
  const seenArtifactPaths = new Set();
  for (const [index, artifact] of artifacts.entries()) {
    assertObject(artifact, `artifacts[${index}]`);
    assertAllowedKeys(artifact, ARTIFACT_KEYS, `artifacts[${index}]`);
    assertSafeArtifactPath(artifact.path);
    if (artifact.media_type !== "text/markdown") {
      throw new Error(`artifacts[${index}].media_type 必须为 text/markdown`);
    }
    assertString(artifact.content, `artifacts[${index}].content`, { maxLength: MAX_CANDIDATE_BYTES });
    assertNoFrontmatter(artifact.content, artifact.path);
    const candidate = artifactsByPath.get(artifact.path);
    if (!candidate) throw new Error(`artifact 未被 marker 引用：${artifact.path}`);
    if (candidate.artifact.path !== artifact.path) {
      throw new Error(`artifact 引用不一致：${artifact.path}`);
    }
    if (seenArtifactPaths.has(artifact.path)) {
      throw new Error(`artifact 路径重复：${artifact.path}`);
    }
    seenArtifactPaths.add(artifact.path);
    const byteLength = Buffer.byteLength(artifact.content, "utf8");
    if (byteLength > MAX_CANDIDATE_BYTES) {
      throw new Error(`candidate 超过 ${MAX_CANDIDATE_BYTES} 字节：${artifact.path}`);
    }
    assertCandidateBody(artifact.content, candidate, artifact.path);
    totalBytes += byteLength;
    normalizedArtifacts.push({
      path: artifact.path,
      media_type: artifact.media_type,
      content: artifact.content.endsWith("\n") ? artifact.content : `${artifact.content}\n`,
    });
  }
  for (const artifactPath of artifactsByPath.keys()) {
    if (!seenArtifactPaths.has(artifactPath)) {
      throw new Error(`marker 引用的 artifact 未提供：${artifactPath}`);
    }
  }

  if (totalBytes > MAX_TOTAL_ARTIFACT_BYTES) {
    throw new Error(`candidate 总大小超过 ${MAX_TOTAL_ARTIFACT_BYTES} 字节`);
  }
  for (const key of Object.keys(payload.marker)) {
    if (FORBIDDEN_MARKER_KEYS.has(key)) throw new Error(`marker 禁止字段：${key}`);
  }
  return { payload, artifacts: normalizedArtifacts };
}

export function validateAuthorHandoff(message) {
  assertString(message, "last_assistant_message", {
    maxLength: MAX_MESSAGE_BYTES,
  });
  const extracted = extractEnvelope(message);
  if (!extracted) return { present: false };
  const validated = validateEnvelope(extracted.payload);
  return {
    present: true,
    humanText: extracted.humanText,
    payload: validated.payload,
    artifacts: validated.artifacts,
  };
}

function defaultHandoffRoot() {
  return join(process.env.CODEX_HOME || join(homedir(), ".codex"), "knowledge-handoffs");
}

function defaultHandoffIdFactory({ input, message }) {
  const source = [input.session_id, input.turn_id, sha256(message)].join(":");
  return `kh_${createHash("sha256").update(source, "utf8").digest("hex").slice(0, 48)}`;
}

async function defaultCaptureRepositoryState(cwd) {
  const empty = {
    detected: false,
    root: null,
    head_commit: null,
    branch: null,
    dirty: false,
    status_sha256: null,
  };
  if (typeof cwd !== "string" || cwd.trim() === "") return empty;

  async function git(...args) {
    const result = await execFile("git", args, {
      cwd,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout.trim();
  }

  try {
    const root = await git("rev-parse", "--show-toplevel");
    const headCommit = await git("rev-parse", "HEAD");
    const branch = await git("branch", "--show-current");
    const status = await git("status", "--porcelain=v1", "--untracked-files=all");
    return {
      detected: true,
      root: root || null,
      head_commit: headCommit || null,
      branch: branch || null,
      dirty: status.length > 0,
      status_sha256: sha256(status),
    };
  } catch {
    return empty;
  }
}

function serializeMarker(marker) {
  return YAML.stringify(marker, {
    version: "1.2",
    schema: "core",
    lineWidth: 0,
  });
}

function buildMetadata(input, repositoryCapture, handoffId, workspaceKey, message, artifactRecords, capturedAt) {
  return {
    kind: "codex_knowledge_handoff_metadata",
    schema_version: SCHEMA_VERSION,
    handoff_id: handoffId,
    captured_at: capturedAt,
    source: {
      session_id: input.session_id ?? null,
      turn_id: input.turn_id ?? null,
      cwd: input.cwd ?? null,
      final_message_sha256: sha256(message),
    },
    workspace: {
      workspace_key: workspaceKey,
    },
    repository_capture: repositoryCapture,
    artifacts: artifactRecords,
  };
}

function packageManifestHash(artifactRecords) {
  return sha256(JSON.stringify(artifactRecords));
}

async function findExistingPackage(finalRoot, input, message) {
  try {
    const metadata = JSON.parse(await readFile(join(finalRoot, "metadata.json"), "utf8"));
    const expectedMessageHash = sha256(message);
    if (
      metadata?.source?.session_id === (input.session_id ?? null)
      && metadata?.source?.turn_id === (input.turn_id ?? null)
      && metadata?.source?.final_message_sha256 === expectedMessageHash
    ) {
      return {
        continue: true,
        handoffId: metadata.handoff_id,
        packagePath: finalRoot,
        packageSha256: packageManifestHash(metadata.artifacts || []),
        duplicate: true,
      };
    }
    throw new Error(`handoff_id 已存在且来源不一致：${metadata?.handoff_id || "unknown"}`);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof SyntaxError) {
      throw new Error(`handoff_id 已存在但 metadata.json 无法解析：${finalRoot}`);
    }
    throw error;
  }
}

async function writePackage({ input, envelope, options, message }) {
  const handoffRoot = options.handoffRoot || defaultHandoffRoot();
  const workspaceKey = deriveWorkspaceKey(input, options);
  const handoffId = options.handoffIdFactory?.({ input, message })
    || defaultHandoffIdFactory({ input, message });
  if (!SAFE_HANDOFF_ID.test(handoffId)) throw new Error("handoff_id 不符合安全命名规则");
  const capturedAt = (options.now || (() => new Date().toISOString()))();
  const repositoryCapture = await (options.captureRepositoryState || defaultCaptureRepositoryState)(input.cwd);
  const markerContent = serializeMarker(envelope.payload.marker);
  const fileContents = [
    { path: "handoff.md", media_type: "text/markdown", content: envelope.humanText },
    { path: "marker.yaml", media_type: "application/yaml", content: markerContent },
    ...envelope.artifacts,
  ];
  const artifactRecords = fileContents.map(({ path, media_type, content }) => ({
    path,
    media_type,
    size: Buffer.byteLength(content, "utf8"),
    sha256: sha256(content).replace(/^sha256:/u, ""),
  }));
  const metadata = buildMetadata(
    input,
    repositoryCapture,
    handoffId,
    workspaceKey,
    message,
    artifactRecords,
    capturedAt,
  );
  const metadataContent = `${JSON.stringify(metadata, null, 2)}\n`;
  const allContents = [...fileContents, {
    path: "metadata.json",
    media_type: "application/json",
    content: metadataContent,
  }];
  const completeContent = [
    `handoff_id: ${handoffId}`,
    `package_sha256: ${packageManifestHash(artifactRecords).replace(/^sha256:/u, "")}`,
    `completed_at: ${capturedAt}`,
    "",
  ].join("\n");
  const workspaceRoot = join(handoffRoot, workspaceKey);
  const finalRoot = join(workspaceRoot, handoffId);
  const stagingRoot = join(workspaceRoot, `.tmp-${handoffId}-${randomUUID()}`);
  const fs = {
    mkdir: options.fs?.mkdir || fsMkdir,
    rename: options.fs?.rename || fsRename,
    rm: options.fs?.rm || fsRm,
    writeFile: options.fs?.writeFile || fsWriteFile,
  };

  await fs.mkdir(workspaceRoot, { recursive: true });
  const existingPackage = await findExistingPackage(finalRoot, input, message);
  if (existingPackage) return existingPackage;
  try {
    await fs.mkdir(join(stagingRoot, "candidates"), { recursive: true });
    for (const file of allContents) {
      const target = join(stagingRoot, file.path);
      await fs.mkdir(dirname(target), { recursive: true });
      await fs.writeFile(target, file.content, { encoding: "utf8", flag: "wx" });
    }
    await fs.writeFile(join(stagingRoot, ".complete"), completeContent, {
      encoding: "utf8",
      flag: "wx",
    });
    await fs.rename(stagingRoot, finalRoot);
  } catch (error) {
    await fs.rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }

  return {
    continue: true,
    handoffId,
    packagePath: finalRoot,
    packageSha256: packageManifestHash(artifactRecords),
  };
}

export async function handleStop(input, options = {}) {
  const message = typeof input?.last_assistant_message === "string"
    ? input.last_assistant_message
    : "";
  if (Buffer.byteLength(message, "utf8") > MAX_MESSAGE_BYTES) {
    return {
      continue: false,
      stopReason: `作者最终回复超过 ${MAX_MESSAGE_BYTES} 字节限制，请缩短正文或拆分任务后重新输出。`,
    };
  }

  try {
    const validated = validateAuthorHandoff(message);
    if (!validated.present) return { continue: true };
    if (
      typeof input?.session_id !== "string"
      || input.session_id.trim() === ""
      || typeof input?.turn_id !== "string"
      || input.turn_id.trim() === ""
    ) {
      throw new Error("作者知识交接必须包含真实 session_id 和 turn_id");
    }
    return await writePackage({
      input,
      envelope: {
        humanText: validated.humanText,
        payload: validated.payload,
        artifacts: validated.artifacts,
      },
      options,
      message,
    });
  } catch (error) {
    return {
      continue: false,
      stopReason: `作者知识交接校验失败：${error instanceof Error ? error.message : String(error)}。请修正完整载荷后重新结束本轮。`,
    };
  }
}
