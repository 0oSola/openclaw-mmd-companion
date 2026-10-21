import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const HANDOFF_SCHEMA_VERSION = 1;
const DEFAULT_RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000];
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_GIT_HINT_DEBOUNCE_MS = 250;
const DEFAULT_RECONCILIATION_INTERVAL_MS = 30_000;
const DRAIN_LOCK_STALE_MS = 120_000;
const HANDOFF_ENDPOINT = "/codex/knowledge/handoffs";
const GIT_EVENT_ENDPOINT = "/codex/knowledge/git-events";

export type KnowledgeHandoffFetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type KnowledgeHandoffFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<KnowledgeHandoffFetchResponse>;

export type KnowledgeHandoffFile = {
  path: string;
  mediaType: string;
  content: string;
  size: number;
  sha256: string;
};

export type DiscoveredKnowledgeHandoff = {
  handoffId: string;
  workspaceKey: string;
  packageSha256: string;
  packageContentSha256: string;
  packagePath: string;
  repositoryRoot: string | null;
  files: KnowledgeHandoffFile[];
};

export type KnowledgeHandoffQueueStatus =
  | "pending"
  | "in_flight"
  | "retryable_failed"
  | "delivered"
  | "rejected";

export type KnowledgeHandoffQueueItem = {
  key: string;
  handoffId: string;
  workspaceKey: string;
  packageSha256: string;
  packageContentSha256: string;
  packagePath: string;
  status: KnowledgeHandoffQueueStatus;
  attempts: number;
  nextAttemptAt: string | null;
  ackId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
};

export type KnowledgeHandoffWatcher = {
  close(): void;
};

export type KnowledgeHandoffWatchFactory = (
  root: string,
  onChange: (relativePath?: string) => void,
) => KnowledgeHandoffWatcher;

export type KnowledgeHandoffTransportOptions = {
  handoffRoot: string;
  queueFile: string;
  apiBaseUrl: string;
  transportToken?: string;
  fetch?: KnowledgeHandoffFetch;
  now?: () => Date;
  retryDelaysMs?: number[];
  requestTimeoutMs?: number;
  gitHintDebounceMs?: number;
  autoDrain?: boolean;
  drainIntervalMs?: number;
  reconciliationIntervalMs?: number;
  watchFactory?: KnowledgeHandoffWatchFactory;
  gitWatchFactory?: KnowledgeHandoffWatchFactory;
  onLog?: (event: string, payload: Record<string, unknown>) => void;
};

export type KnowledgeHandoffTransport = {
  start(): Promise<void>;
  stop(): void;
  scanNow(): Promise<DiscoveredKnowledgeHandoff[]>;
  drainOnce(): Promise<KnowledgeHandoffQueueItem | null>;
  notifyGitEvent(input: { workspaceKey: string; eventType: string }): Promise<boolean>;
  getQueueSnapshot(): Promise<KnowledgeHandoffQueueItem[]>;
};

export function safeKnowledgeHandoffError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/[A-Za-z]:[\\/][^)\r\n]+/g, "[local-path]")
    .replace(/\\\\[^)\r\n]+/g, "[local-path]")
    .slice(0, 500);
}

type QueueFile = {
  schema_version: number;
  items: KnowledgeHandoffQueueItem[];
};

type PackageIdentity = {
  handoffId: string;
  packageSha256: string;
  workspaceKey: string;
};

class PackageValidationError extends Error {
  readonly identity: PackageIdentity | null;

  constructor(message: string, identity: PackageIdentity | null = null) {
    super(message);
    this.name = "PackageValidationError";
    this.identity = identity;
  }
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function packageKey(handoffId: string, packageSha256: string): string {
  return `${handoffId}:${packageSha256}`;
}

function compactText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeApiBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isSafeRelativePath(value: string): boolean {
  if (!value || path.isAbsolute(value)) return false;
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.includes("\0")) return false;
  return normalized.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function mediaTypeForPath(relativePath: string): string {
  if (relativePath === "metadata.json") return "application/json";
  if (relativePath === "marker.yaml") return "application/yaml";
  if (relativePath.endsWith(".md")) return "text/markdown";
  return "text/plain";
}

function parseCompleteFile(content: string, packageRoot: string): PackageIdentity {
  const handoffId = content.match(/^handoff_id:\s*(\S+)\s*$/m)?.[1] ?? "";
  const packageSha256 = content.match(/^package_sha256:\s*([a-f0-9]{64})\s*$/m)?.[1] ?? "";
  const workspaceKey = path.basename(path.dirname(packageRoot));
  if (!handoffId || !packageSha256 || !workspaceKey) {
    throw new PackageValidationError(".complete 缺少 handoff_id 或 package_sha256");
  }
  return { handoffId, packageSha256, workspaceKey };
}

function assertIdentity(
  identity: PackageIdentity,
  metadata: Record<string, unknown>,
  packageRoot: string,
) {
  if (metadata.handoff_id !== identity.handoffId) {
    throw new PackageValidationError("metadata.handoff_id 与 .complete 不一致", identity);
  }
  const workspace = metadata.workspace;
  const metadataWorkspaceKey =
    workspace && typeof workspace === "object" && typeof (workspace as Record<string, unknown>).workspace_key === "string"
      ? String((workspace as Record<string, unknown>).workspace_key)
      : "";
  if (!metadataWorkspaceKey || metadataWorkspaceKey !== identity.workspaceKey) {
    throw new PackageValidationError("metadata.workspace.workspace_key 与路径不一致", identity);
  }
}

function packageManifestHash(records: Array<Pick<KnowledgeHandoffFile, "path" | "mediaType" | "size" | "sha256">>): string {
  return sha256(
    JSON.stringify(
      records.map((record) => ({
        path: record.path,
        media_type: record.mediaType,
        size: record.size,
        sha256: record.sha256,
      })),
    ),
  );
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await readRegularFile(filePath)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("JSON 根节点必须是对象");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    throw new PackageValidationError(
      `无法解析 metadata.json（${safeKnowledgeHandoffError(error)}）`,
    );
  }
}

async function readRegularFile(filePath: string): Promise<string> {
  const stat = await fsp.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("交接包文件必须是普通文件");
  }
  return fsp.readFile(filePath, "utf8");
}

async function assertNoSymlinkInPackagePath(packageRoot: string, relativePath: string): Promise<void> {
  let currentPath = packageRoot;
  for (const segment of relativePath.split("/")) {
    currentPath = path.join(currentPath, segment);
    const stat = await fsp.lstat(currentPath);
    if (stat.isSymbolicLink()) {
      throw new Error("交接包路径不能经过符号链接");
    }
  }
}

async function readPackageFile(packageRoot: string, relativePath: string): Promise<string> {
  await assertNoSymlinkInPackagePath(packageRoot, relativePath);
  return readRegularFile(path.join(packageRoot, relativePath));
}

async function listFiles(root: string, current = root): Promise<string[]> {
  const entries = await fsp.readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error("交接包不允许包含符号链接");
    }
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, absolutePath)));
    } else if (entry.isFile()) {
      files.push(path.relative(root, absolutePath).replace(/\\/g, "/"));
    }
  }
  return files.sort();
}

async function inspectPackage(packageRoot: string): Promise<DiscoveredKnowledgeHandoff> {
  let completeContent: string;
  try {
    completeContent = await readPackageFile(packageRoot, ".complete");
  } catch (error) {
    throw new PackageValidationError(`缺少 .complete（${(error as NodeJS.ErrnoException).code ?? "read_error"}）`);
  }
  const identity = parseCompleteFile(completeContent, packageRoot);
  let metadata: Record<string, unknown>;
  try {
    await assertNoSymlinkInPackagePath(packageRoot, "metadata.json");
    metadata = await readJsonFile(path.join(packageRoot, "metadata.json"));
  } catch (error) {
    throw new PackageValidationError(
      `无法解析 metadata.json（${safeKnowledgeHandoffError(error)}）`,
      identity,
    );
  }
  assertIdentity(identity, metadata, packageRoot);

  const rawArtifacts = metadata.artifacts;
  if (!Array.isArray(rawArtifacts) || rawArtifacts.length < 3) {
    throw new PackageValidationError("metadata.artifacts 必须至少包含 handoff、marker 和一个 candidate", identity);
  }

  const records: KnowledgeHandoffFile[] = [];
  const expectedFiles = new Set<string>(["metadata.json", ".complete"]);
  const candidatePaths = new Set<string>();
  const artifactPaths = new Set<string>();
  for (const rawArtifact of rawArtifacts) {
    if (!rawArtifact || typeof rawArtifact !== "object" || Array.isArray(rawArtifact)) {
      throw new PackageValidationError("metadata.artifacts 包含非法记录", identity);
    }
    const artifact = rawArtifact as Record<string, unknown>;
    const relativePath = typeof artifact.path === "string" ? artifact.path.replace(/\\/g, "/") : "";
    const mediaType = typeof artifact.media_type === "string" ? artifact.media_type : "";
    const expectedSize = typeof artifact.size === "number" ? artifact.size : -1;
    const expectedSha256 = typeof artifact.sha256 === "string" ? artifact.sha256 : "";
    if (!isSafeRelativePath(relativePath) || relativePath === "metadata.json" || relativePath === ".complete") {
      throw new PackageValidationError(`metadata.artifacts 包含非法路径：${relativePath || "<empty>"}`, identity);
    }
    if (expectedSize < 0 || !/^[a-f0-9]{64}$/.test(expectedSha256) || !mediaType) {
      throw new PackageValidationError(`metadata.artifacts 记录不完整：${relativePath}`, identity);
    }
    if (relativePath.startsWith("candidates/")) {
      if (!/^candidates\/[^/]+\.md$/.test(relativePath) || mediaType !== "text/markdown") {
        throw new PackageValidationError(`candidate 路径或 media_type 非法：${relativePath}`, identity);
      }
      candidatePaths.add(relativePath);
    }
    artifactPaths.add(relativePath);
    expectedFiles.add(relativePath);
    let content: string;
    try {
      content = await readPackageFile(packageRoot, relativePath);
    } catch {
      throw new PackageValidationError(`metadata.artifacts 引用的文件不存在：${relativePath}`, identity);
    }
    const actualSize = Buffer.byteLength(content, "utf8");
    const actualSha256 = sha256(content);
    if (actualSize !== expectedSize || actualSha256 !== expectedSha256) {
      throw new PackageValidationError(`文件 hash 或大小不匹配：${relativePath}`, identity);
    }
    records.push({
      path: relativePath,
      mediaType,
      content,
      size: actualSize,
      sha256: actualSha256,
    });
  }

  if (candidatePaths.size === 0) {
    throw new PackageValidationError("交接包没有 candidate 文件", identity);
  }
  if (!artifactPaths.has("handoff.md") || !artifactPaths.has("marker.yaml")) {
    throw new PackageValidationError("交接包必须包含 handoff.md、marker.yaml 和至少一个 candidate", identity);
  }

  let actualFiles: string[];
  try {
    actualFiles = await listFiles(packageRoot);
  } catch {
    throw new PackageValidationError("无法读取交接包文件清单", identity);
  }
  const unexpectedFiles = actualFiles.filter((relativePath) => !expectedFiles.has(relativePath));
  const missingFiles = Array.from(expectedFiles).filter((relativePath) => !actualFiles.includes(relativePath));
  if (unexpectedFiles.length > 0 || missingFiles.length > 0) {
    throw new PackageValidationError(
      `交接包文件清单不一致：unexpected=${unexpectedFiles.join(",")}; missing=${missingFiles.join(",")}`,
      identity,
    );
  }

  const actualPackageSha256 = packageManifestHash(records);
  if (actualPackageSha256 !== identity.packageSha256) {
    throw new PackageValidationError(
      `package_sha256 不匹配：expected=${identity.packageSha256}; actual=${actualPackageSha256}`,
      identity,
    );
  }

  const metadataContent = await readPackageFile(packageRoot, "metadata.json");
  const completeFile = await readPackageFile(packageRoot, ".complete");
  records.push({
    path: "metadata.json",
    mediaType: "application/json",
    content: metadataContent,
    size: Buffer.byteLength(metadataContent, "utf8"),
    sha256: sha256(metadataContent),
  });
  records.push({
    path: ".complete",
    mediaType: "text/plain",
    content: completeFile,
    size: Buffer.byteLength(completeFile, "utf8"),
    sha256: sha256(completeFile),
  });

  const repositoryCapture = metadata.repository_capture;
  const repositoryRoot =
    repositoryCapture &&
    typeof repositoryCapture === "object" &&
    typeof (repositoryCapture as Record<string, unknown>).root === "string"
      ? String((repositoryCapture as Record<string, unknown>).root)
      : null;

  return {
    handoffId: identity.handoffId,
    workspaceKey: identity.workspaceKey,
    packageSha256: identity.packageSha256,
    packageContentSha256: packageContentHash(records),
    packagePath: packageRoot,
    repositoryRoot: repositoryRoot?.trim() || null,
    files: records,
  };
}

async function listPackageRoots(handoffRoot: string): Promise<string[]> {
  const packageRoots: string[] = [];
  let workspaceEntries: fs.Dirent[];
  try {
    workspaceEntries = await fsp.readdir(handoffRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  for (const workspaceEntry of workspaceEntries) {
    if (!workspaceEntry.isDirectory() || workspaceEntry.name.startsWith(".tmp-")) continue;
    const workspaceRoot = path.join(handoffRoot, workspaceEntry.name);
    const handoffEntries = await fsp.readdir(workspaceRoot, { withFileTypes: true });
    for (const handoffEntry of handoffEntries) {
      if (!handoffEntry.isDirectory() || handoffEntry.name.startsWith(".tmp-")) continue;
      const packageRoot = path.join(workspaceRoot, handoffEntry.name);
      try {
        await fsp.access(path.join(packageRoot, ".complete"));
        packageRoots.push(packageRoot);
      } catch {
        // A package is visible to Pet only after the atomic .complete marker exists.
      }
    }
  }
  return packageRoots;
}

function defaultWatchFactory(root: string, onChange: (relativePath?: string) => void): KnowledgeHandoffWatcher {
  try {
    return fs.watch(root, { recursive: true }, (_eventType, filename) => {
      onChange(filename ? String(filename) : undefined);
    });
  } catch {
    return fs.watch(root, (_eventType, filename) => {
      onChange(filename ? String(filename) : undefined);
    });
  }
}

function parseQueueFile(value: unknown): KnowledgeHandoffQueueItem[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("knowledge handoff queue 根节点必须是对象");
  }
  const record = value as Record<string, unknown>;
  if (record.schema_version !== 1 || !Array.isArray(record.items)) {
    throw new Error("knowledge handoff queue schema_version 不受支持");
  }
  return record.items as KnowledgeHandoffQueueItem[];
}

async function readQueue(queueFile: string): Promise<KnowledgeHandoffQueueItem[]> {
  try {
    const content = await fsp.readFile(queueFile, "utf8");
    return parseQueueFile(JSON.parse(content));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeQueue(queueFile: string, items: KnowledgeHandoffQueueItem[]): Promise<void> {
  await fsp.mkdir(path.dirname(queueFile), { recursive: true });
  const temporaryPath = `${queueFile}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fsp.writeFile(
      temporaryPath,
      `${JSON.stringify({ schema_version: 1, items }, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    await fsp.rename(temporaryPath, queueFile);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function acquireFileLock(lockPath: string): Promise<(() => Promise<void>) | null> {
  await fsp.mkdir(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fsp.open(lockPath, "wx");
      await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, "utf8");
      return async () => {
        await handle.close().catch(() => undefined);
        await fsp.rm(lockPath, { force: true }).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const stat = await fsp.stat(lockPath);
        if (Date.now() - stat.mtimeMs > DRAIN_LOCK_STALE_MS) {
          await fsp.rm(lockPath, { force: true });
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw statError;
      }
      return null;
    }
  }
  return null;
}

function packageContentHash(files: KnowledgeHandoffFile[]): string {
  return sha256(
    JSON.stringify(
      files.map((file) => ({
        path: file.path,
        media_type: file.mediaType,
        size: file.size,
        sha256: file.sha256,
      })),
    ),
  );
}

function retryDelay(retryDelaysMs: number[], attempts: number): number {
  if (retryDelaysMs.length === 0) return 0;
  return retryDelaysMs[Math.min(Math.max(attempts - 1, 0), retryDelaysMs.length - 1)] ?? 0;
}

function parseResponseReason(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fallback;
  const record = payload as Record<string, unknown>;
  return compactText(record.reason ?? record.detail ?? record.message) || fallback;
}

function getResponseOutcome(payload: unknown): { outcome: string; ackId: string | null } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { outcome: "", ackId: null };
  }
  const record = payload as Record<string, unknown>;
  return {
    outcome: typeof record.outcome === "string" ? record.outcome : "",
    ackId: typeof record.ack_id === "string" && record.ack_id.trim() ? record.ack_id.trim() : null,
  };
}

function eventTypeForGitPath(relativePath?: string): string {
  const normalized = relativePath?.replace(/\\/g, "/").toLowerCase() ?? "";
  if (normalized.endsWith("/head") || normalized === "head") return "checkout";
  if (normalized.endsWith("/index") || normalized === "index") return "index_changed";
  if (normalized.startsWith("refs/remotes/") || normalized.includes("/refs/remotes/") || normalized.endsWith("/packed-refs")) {
    return "push";
  }
  if (normalized.startsWith("refs/") || normalized.includes("/refs/")) return "commit";
  return "repository_changed";
}

export function createKnowledgeHandoffTransport(
  options: KnowledgeHandoffTransportOptions,
): KnowledgeHandoffTransport {
  const fetchImpl = options.fetch ?? (globalThis.fetch.bind(globalThis) as KnowledgeHandoffFetch);
  const now = options.now ?? (() => new Date());
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  const gitHintDebounceMs = Math.max(0, options.gitHintDebounceMs ?? DEFAULT_GIT_HINT_DEBOUNCE_MS);
  const reconciliationIntervalMs = Math.max(
    250,
    options.reconciliationIntervalMs ?? DEFAULT_RECONCILIATION_INTERVAL_MS,
  );
  const watchFactory = options.watchFactory ?? defaultWatchFactory;
  const gitWatchFactory = options.gitWatchFactory ?? defaultWatchFactory;
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const transportToken = String(options.transportToken ?? "").trim();
  const onLog = options.onLog ?? (() => undefined);
  const queueLockPath = `${options.queueFile}.lock`;
  let started = false;
  let handoffWatcher: KnowledgeHandoffWatcher | null = null;
  let drainTimer: ReturnType<typeof setInterval> | null = null;
  let reconciliationTimer: ReturnType<typeof setInterval> | null = null;
  let drainInFlight = false;
  const gitWatchers = new Map<string, KnowledgeHandoffWatcher[]>();
  const gitHintTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async function withQueueLock<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const release = await acquireFileLock(queueLockPath);
      if (release) {
        try {
          return await operation();
        } finally {
          await release();
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("无法取得 knowledge handoff queue lock");
  }

  async function getQueueSnapshot(): Promise<KnowledgeHandoffQueueItem[]> {
    return readQueue(options.queueFile);
  }

  async function updateQueueItem(
    key: string,
    updater: (item: KnowledgeHandoffQueueItem) => KnowledgeHandoffQueueItem,
  ): Promise<KnowledgeHandoffQueueItem | null> {
    return withQueueLock(async () => {
      const items = await readQueue(options.queueFile);
      const index = items.findIndex((item) => item.key === key);
      if (index < 0) return null;
      const next = updater(items[index]);
      items[index] = next;
      await writeQueue(options.queueFile, items);
      return next;
    });
  }

  function createQueueItem(input: {
    key?: string;
    handoffId: string;
    workspaceKey: string;
    packageSha256: string;
    packageContentSha256: string;
    packagePath: string;
    status: KnowledgeHandoffQueueStatus;
    lastError?: string | null;
  }): KnowledgeHandoffQueueItem {
    const timestamp = now().toISOString();
    return {
      key: input.key ?? packageKey(input.handoffId, input.packageSha256),
      handoffId: input.handoffId,
      workspaceKey: input.workspaceKey,
      packageSha256: input.packageSha256,
      packageContentSha256: input.packageContentSha256,
      packagePath: input.packagePath,
      status: input.status,
      attempts: 0,
      nextAttemptAt: null,
      ackId: null,
      lastError: input.lastError ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deliveredAt: null,
    };
  }

  async function scanNow(): Promise<DiscoveredKnowledgeHandoff[]> {
    await fsp.mkdir(options.handoffRoot, { recursive: true });
    const packageRoots = await listPackageRoots(options.handoffRoot);
    const discovered: DiscoveredKnowledgeHandoff[] = [];
    const errors: PackageValidationError[] = [];
    const queue = await readQueue(options.queueFile);
    const queueByKey = new Map(queue.map((item) => [item.key, item]));
    const additions: KnowledgeHandoffQueueItem[] = [];

    for (const packageRoot of packageRoots) {
      try {
        const packageInfo = await inspectPackage(packageRoot);
        discovered.push(packageInfo);
        const key = packageKey(packageInfo.handoffId, packageInfo.packageSha256);
        if (!queueByKey.has(key)) {
          const item = createQueueItem({
            handoffId: packageInfo.handoffId,
            workspaceKey: packageInfo.workspaceKey,
            packageSha256: packageInfo.packageSha256,
            packageContentSha256: packageInfo.packageContentSha256,
            packagePath: packageInfo.packagePath,
            status: "pending",
          });
          additions.push(item);
          queueByKey.set(key, item);
        }
        if (packageInfo.repositoryRoot) {
          registerGitWatcher(packageInfo.workspaceKey, packageInfo.repositoryRoot);
        }
      } catch (error) {
        const validationError =
          error instanceof PackageValidationError ? error : new PackageValidationError(String(error));
        errors.push(validationError);
        if (validationError.identity) {
          const identity = validationError.identity;
          const key = packageKey(identity.handoffId, identity.packageSha256);
          if (!queueByKey.has(key)) {
            const item = createQueueItem({
              handoffId: identity.handoffId,
              workspaceKey: identity.workspaceKey,
              packageSha256: identity.packageSha256,
              packageContentSha256: "",
              packagePath: packageRoot,
              status: "rejected",
              lastError: validationError.message,
            });
            additions.push(item);
            queueByKey.set(key, item);
          }
        } else {
          const packageRef = path.relative(options.handoffRoot, packageRoot).replace(/\\/g, "/");
          const key = `invalid:${packageRef}`;
          if (!queueByKey.has(key)) {
            const item = createQueueItem({
              key,
              handoffId: "",
              workspaceKey: path.basename(path.dirname(packageRoot)),
              packageSha256: "",
              packageContentSha256: "",
              packagePath: packageRoot,
              status: "rejected",
              lastError: safeKnowledgeHandoffError(validationError),
            });
            additions.push(item);
            queueByKey.set(key, item);
          }
        }
        onLog("knowledge-handoff:scan-error", {
          packageRef: path.relative(options.handoffRoot, packageRoot).replace(/\\/g, "/"),
          error: safeKnowledgeHandoffError(validationError),
        });
      }
    }

    if (additions.length > 0) {
      await withQueueLock(async () => {
        const latestQueue = await readQueue(options.queueFile);
        const latestKeys = new Set(latestQueue.map((item) => item.key));
        const newItems = additions.filter((item) => !latestKeys.has(item.key));
        if (newItems.length > 0) await writeQueue(options.queueFile, [...latestQueue, ...newItems]);
      });
    }
    return discovered;
  }

  async function recoverInFlightQueueItems(): Promise<void> {
    await withQueueLock(async () => {
      const queue = await readQueue(options.queueFile);
      const timestamp = now().toISOString();
      let changed = false;
      for (const item of queue) {
        if (item.status !== "in_flight") continue;
        item.status = "retryable_failed";
        item.lastError = "Pet 重启时未收到 FastAPI ACK";
        item.nextAttemptAt = null;
        item.updatedAt = timestamp;
        changed = true;
      }
      if (changed) await writeQueue(options.queueFile, queue);
    });
  }

  function registerGitWatcher(workspaceKey: string, repositoryRoot: string) {
    if (gitWatchers.has(workspaceKey)) return;
    let gitPath = path.join(repositoryRoot, ".git");
    if (!fs.existsSync(gitPath)) return;
    const gitPaths = new Set<string>();
    try {
      if (fs.statSync(gitPath).isFile()) {
        const gitFile = fs.readFileSync(gitPath, "utf8");
        const gitDir = gitFile.match(/^\s*gitdir:\s*(.+?)\s*$/im)?.[1];
        if (!gitDir) return;
        gitPath = path.resolve(repositoryRoot, gitDir);
      }
      gitPaths.add(gitPath);
      const commonDirFile = path.join(gitPath, "commondir");
      if (fs.existsSync(commonDirFile) && fs.statSync(commonDirFile).isFile()) {
        const commonDir = fs.readFileSync(commonDirFile, "utf8").trim();
        if (commonDir) gitPaths.add(path.resolve(gitPath, commonDir));
      }
    } catch {
      return;
    }
    const existingGitPaths = Array.from(gitPaths).filter((candidate) => fs.existsSync(candidate));
    if (existingGitPaths.length === 0) return;
    const watchers: KnowledgeHandoffWatcher[] = [];
    try {
      for (const existingGitPath of existingGitPaths) {
        const watcher = gitWatchFactory(existingGitPath, (relativePath) => {
          const timerKey = `${workspaceKey}:${eventTypeForGitPath(relativePath)}`;
          const currentTimer = gitHintTimers.get(timerKey);
          if (currentTimer) clearTimeout(currentTimer);
          const timer = setTimeout(() => {
            gitHintTimers.delete(timerKey);
            void notifyGitEvent({
              workspaceKey,
              eventType: eventTypeForGitPath(relativePath),
            });
          }, gitHintDebounceMs);
          gitHintTimers.set(timerKey, timer);
        });
        watchers.push(watcher);
      }
      gitWatchers.set(workspaceKey, watchers);
    } catch (error) {
      for (const watcher of watchers) watcher.close();
      onLog("knowledge-handoff:git-watch-error", {
        workspaceKey,
        error: safeKnowledgeHandoffError(error),
      });
    }
  }

  async function requestWithTimeout(
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ): Promise<KnowledgeHandoffFetchResponse> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        fetchImpl(url, { ...init, signal: controller.signal }),
        new Promise<KnowledgeHandoffFetchResponse>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error(`FastAPI 请求超时（${requestTimeoutMs}ms）`));
          }, requestTimeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function drainOnce(): Promise<KnowledgeHandoffQueueItem | null> {
    if (drainInFlight) return null;
    drainInFlight = true;
    try {
      return await drainOnceImpl();
    } finally {
      drainInFlight = false;
    }
  }

  async function drainOnceImpl(): Promise<KnowledgeHandoffQueueItem | null> {
    const releaseDrainLock = await acquireFileLock(`${options.queueFile}.drain.lock`);
    if (!releaseDrainLock) return null;
    try {
    const queue = await readQueue(options.queueFile);
    const currentTime = now().getTime();
    const candidate = queue.find((item) => {
      if (item.status !== "pending" && item.status !== "retryable_failed") return false;
      if (!item.nextAttemptAt) return true;
      const nextAttemptAt = Date.parse(item.nextAttemptAt);
      return !Number.isFinite(nextAttemptAt) || nextAttemptAt <= currentTime;
    });
    if (!candidate) return null;

    const startedAt = now().toISOString();
    const inFlight = await updateQueueItem(candidate.key, (item) => ({
      ...item,
      status: "in_flight",
      attempts: item.attempts + 1,
      updatedAt: startedAt,
      nextAttemptAt: null,
    }));
    if (!inFlight) return null;

    try {
      const packageInfo = await inspectPackage(inFlight.packagePath);
      if (
        packageInfo.packageSha256 !== inFlight.packageSha256 ||
        (inFlight.packageContentSha256 && packageInfo.packageContentSha256 !== inFlight.packageContentSha256) ||
        packageInfo.handoffId !== inFlight.handoffId
      ) {
        throw new PackageValidationError("入队后交接包内容发生变化");
      }
      const response = await requestWithTimeout(`${apiBaseUrl}${HANDOFF_ENDPOINT}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": `${packageInfo.handoffId}:${packageInfo.packageSha256}`,
          ...(transportToken ? { "x-codex-knowledge-transport-token": transportToken } : {}),
        },
        body: JSON.stringify({
          kind: "codex_knowledge_handoff_package",
          schema_version: HANDOFF_SCHEMA_VERSION,
          handoff_id: packageInfo.handoffId,
          workspace_key: packageInfo.workspaceKey,
          package_sha256: packageInfo.packageSha256,
          package_content_sha256: packageInfo.packageContentSha256,
          files: packageInfo.files.map((file) => ({
            path: file.path,
            media_type: file.mediaType,
            content: file.content,
            size: file.size,
            sha256: file.sha256,
          })),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const reason = parseResponseReason(payload, `HTTP ${response.status}`);
        if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
          return (
            (await updateQueueItem(inFlight.key, (item) => ({
              ...item,
              status: "rejected",
              lastError: reason,
              updatedAt: now().toISOString(),
            }))) ?? inFlight
          );
        }
        return (
          (await updateQueueItem(inFlight.key, (item) => ({
            ...item,
            status: "retryable_failed",
            lastError: reason,
            nextAttemptAt: new Date(now().getTime() + retryDelay(retryDelaysMs, item.attempts)).toISOString(),
            updatedAt: now().toISOString(),
          }))) ?? inFlight
        );
      }

      const outcome = getResponseOutcome(payload);
      if ((outcome.outcome === "accepted" || outcome.outcome === "duplicate") && outcome.ackId) {
        return (
          (await updateQueueItem(inFlight.key, (item) => ({
            ...item,
            status: "delivered",
            ackId: outcome.ackId,
            deliveredAt: now().toISOString(),
            updatedAt: now().toISOString(),
            lastError: null,
          }))) ?? inFlight
        );
      }
      if (outcome.outcome === "rejected") {
        return (
          (await updateQueueItem(inFlight.key, (item) => ({
            ...item,
            status: "rejected",
            lastError: parseResponseReason(payload, "FastAPI 拒绝交接包"),
            updatedAt: now().toISOString(),
          }))) ?? inFlight
        );
      }

      const protocolError = "FastAPI ACK 缺少 accepted/duplicate outcome 或 ack_id";
      return (
        (await updateQueueItem(inFlight.key, (item) => ({
          ...item,
          status: "retryable_failed",
          lastError: protocolError,
          nextAttemptAt: new Date(now().getTime() + retryDelay(retryDelaysMs, item.attempts)).toISOString(),
          updatedAt: now().toISOString(),
        }))) ?? inFlight
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof PackageValidationError) {
        return (
          (await updateQueueItem(inFlight.key, (item) => ({
            ...item,
            status: "rejected",
            lastError: message,
            updatedAt: now().toISOString(),
          }))) ?? inFlight
        );
      }
      return (
        (await updateQueueItem(inFlight.key, (item) => ({
          ...item,
          status: "retryable_failed",
          lastError: message,
          nextAttemptAt: new Date(now().getTime() + retryDelay(retryDelaysMs, item.attempts)).toISOString(),
          updatedAt: now().toISOString(),
        }))) ?? inFlight
      );
    }
    } finally {
      await releaseDrainLock();
    }
  }

  async function notifyGitEvent(input: { workspaceKey: string; eventType: string }): Promise<boolean> {
    try {
      const response = await requestWithTimeout(`${apiBaseUrl}${GIT_EVENT_ENDPOINT}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(transportToken ? { "x-codex-knowledge-transport-token": transportToken } : {}),
        },
        body: JSON.stringify({
          workspace_key: input.workspaceKey,
          event_type: input.eventType,
        }),
      });
      if (!response.ok) {
        onLog("knowledge-handoff:git-event-error", {
          workspaceKey: input.workspaceKey,
          eventType: input.eventType,
          status: response.status,
        });
        return false;
      }
      return true;
    } catch (error) {
      onLog("knowledge-handoff:git-event-unavailable", {
        workspaceKey: input.workspaceKey,
        eventType: input.eventType,
        error: safeKnowledgeHandoffError(error),
      });
      return false;
    }
  }

  async function start(): Promise<void> {
    if (started) return;
    started = true;
    await fsp.mkdir(options.handoffRoot, { recursive: true });
    await recoverInFlightQueueItems();
    try {
      await scanNow();
    } catch (error) {
      started = false;
      throw error;
    }
    handoffWatcher = watchFactory(options.handoffRoot, () => {
      void scanNow().catch((error) => {
        onLog("knowledge-handoff:watch-scan-error", {
          error: safeKnowledgeHandoffError(error),
        });
      });
    });
    reconciliationTimer = setInterval(() => {
      void scanNow().catch((error) => {
        onLog("knowledge-handoff:reconciliation-scan-error", {
          error: safeKnowledgeHandoffError(error),
        });
      });
    }, reconciliationIntervalMs);
    reconciliationTimer.unref?.();
    if (options.autoDrain) {
      void drainOnce();
      drainTimer = setInterval(() => {
        void drainOnce();
      }, Math.max(250, options.drainIntervalMs ?? 10_000));
    }
  }

  function stop(): void {
    started = false;
    handoffWatcher?.close();
    handoffWatcher = null;
    for (const watchers of gitWatchers.values()) {
      for (const watcher of watchers) watcher.close();
    }
    gitWatchers.clear();
    for (const timer of gitHintTimers.values()) clearTimeout(timer);
    gitHintTimers.clear();
    if (drainTimer) clearInterval(drainTimer);
    drainTimer = null;
    if (reconciliationTimer) clearInterval(reconciliationTimer);
    reconciliationTimer = null;
  }

  return {
    start,
    stop,
    scanNow,
    drainOnce,
    notifyGitEvent,
    getQueueSnapshot,
  };
}
