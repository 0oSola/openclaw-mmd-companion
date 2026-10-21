import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createKnowledgeHandoffTransport,
  type KnowledgeHandoffFetch,
  type KnowledgeHandoffFetchResponse,
  type KnowledgeHandoffTransport,
} from "./knowledgeHandoffTransport.js";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function createValidPackage(
  root: string,
  options: { handoffId?: string; workspaceKey?: string; repositoryRoot?: string } = {},
) {
  const handoffId = options.handoffId ?? "kh_test";
  const workspaceKey = options.workspaceKey ?? "mmd-project";
  const packageRoot = path.join(root, workspaceKey, handoffId);
  const artifactContents = [
    {
      path: "handoff.md",
      media_type: "text/markdown",
      content: "# Codex 会话交接\n",
    },
    {
      path: "marker.yaml",
      media_type: "application/yaml",
      content: "kind: codex_knowledge_marker\nschema_version: 1\nknowledge_candidates: []\n",
    },
    {
      path: "candidates/example.md",
      media_type: "text/markdown",
      content: "# 候选知识\n\n## 核心结论\n\n这是一个测试候选。\n",
    },
  ];
  const artifactRecords = artifactContents.map(({ path: relativePath, media_type, content }) => ({
    path: relativePath,
    media_type,
    size: Buffer.byteLength(content, "utf8"),
    sha256: sha256(content),
  }));
  const packageSha256 = sha256(JSON.stringify(artifactRecords));
  const metadata = {
    kind: "codex_knowledge_handoff_metadata",
    schema_version: 1,
    handoff_id: handoffId,
    workspace: { workspace_key: workspaceKey },
    repository_capture: {
      detected: true,
      root: options.repositoryRoot ?? "D:\\workspace\\MMD project",
    },
    artifacts: artifactRecords,
  };
  const complete = [
    `handoff_id: ${handoffId}`,
    `package_sha256: ${packageSha256}`,
    "completed_at: 2026-08-05T00:00:00.000Z",
    "",
  ].join("\n");

  fs.mkdirSync(path.join(packageRoot, "candidates"), { recursive: true });
  for (const artifact of artifactContents) {
    const target = path.join(packageRoot, artifact.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, artifact.content, "utf8");
  }
  fs.writeFileSync(path.join(packageRoot, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(packageRoot, ".complete"), complete, "utf8");
  return { packageRoot, handoffId, workspaceKey, packageSha256 };
}

function createTestRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-pet-knowledge-"));
  return {
    handoffRoot: path.join(root, "knowledge-handoffs"),
    queueFile: path.join(root, "transport", "queue.json"),
    root,
  };
}

function acceptedFetch(calls: Array<{ url: string; body: unknown }>, response = {
  outcome: "accepted",
  ack_id: "ack-1",
}) : KnowledgeHandoffFetch {
  return async (input, init) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

function createTransport(
  roots: ReturnType<typeof createTestRoot>,
  options: Partial<Parameters<typeof createKnowledgeHandoffTransport>[0]> = {},
): KnowledgeHandoffTransport {
  return createKnowledgeHandoffTransport({
    handoffRoot: roots.handoffRoot,
    queueFile: roots.queueFile,
    apiBaseUrl: "http://127.0.0.1:8100",
    watchFactory: () => ({ close() {} }),
    ...options,
  });
}

describe("Pet 作者交接包运输", () => {
  it("启动补扫只发现已经存在 .complete 的合法包", async () => {
    const roots = createTestRoot();
    const valid = createValidPackage(roots.handoffRoot);
    const incomplete = path.join(roots.handoffRoot, "mmd-project", "incomplete");
    fs.mkdirSync(incomplete, { recursive: true });
    fs.writeFileSync(path.join(incomplete, "handoff.md"), "未完成", "utf8");

    const transport = createTransport(roots);
    const discovered = await transport.scanNow();

    expect(discovered).toHaveLength(1);
    expect(discovered[0]).toMatchObject({
      handoffId: valid.handoffId,
      workspaceKey: valid.workspaceKey,
      packageSha256: valid.packageSha256,
    });
    expect(await transport.getQueueSnapshot()).toHaveLength(1);
  });

  it("manifest hash 不一致时拒绝入队并保留明确错误", async () => {
    const roots = createTestRoot();
    const valid = createValidPackage(roots.handoffRoot);
    const completePath = path.join(valid.packageRoot, ".complete");
    fs.writeFileSync(
      completePath,
      fs.readFileSync(completePath, "utf8").replace(valid.packageSha256, "0".repeat(64)),
      "utf8",
    );

    const transport = createTransport(roots);

    await transport.scanNow();
    expect(await transport.getQueueSnapshot()).toMatchObject([
      { handoffId: valid.handoffId, status: "rejected", lastError: expect.stringContaining("package_sha256") },
    ]);
    expect(fs.existsSync(valid.packageRoot)).toBe(true);
  });

  it("损坏包只进入 rejected，不阻断同批合法包的补扫", async () => {
    const roots = createTestRoot();
    const invalid = createValidPackage(roots.handoffRoot, { handoffId: "kh_invalid" });
    const valid = createValidPackage(roots.handoffRoot, { handoffId: "kh_valid" });
    fs.writeFileSync(
      path.join(invalid.packageRoot, ".complete"),
      fs.readFileSync(path.join(invalid.packageRoot, ".complete"), "utf8").replace(invalid.packageSha256, "0".repeat(64)),
      "utf8",
    );

    const transport = createTransport(roots);
    const discovered = await transport.scanNow();

    expect(discovered).toMatchObject([{ handoffId: valid.handoffId }]);
    expect(await transport.getQueueSnapshot()).toMatchObject([
      { handoffId: invalid.handoffId, status: "rejected" },
      { handoffId: valid.handoffId, status: "pending" },
    ]);
  });

  it("无法解析身份的 .complete 也会留下不可发送的 rejected 记录", async () => {
    const roots = createTestRoot();
    const packageRoot = path.join(roots.handoffRoot, "mmd-project", "unknown-package");
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(path.join(packageRoot, ".complete"), "not-a-valid-complete\n", "utf8");

    const transport = createTransport(roots);
    await transport.scanNow();

    expect(await transport.getQueueSnapshot()).toMatchObject([
      {
        key: "invalid:mmd-project/unknown-package",
        status: "rejected",
      },
    ]);
  });

  it("缺少 handoff.md 的包不能冒充 3+N 交接包", async () => {
    const roots = createTestRoot();
    const invalid = createValidPackage(roots.handoffRoot, { handoffId: "kh_missing_handoff" });
    fs.rmSync(path.join(invalid.packageRoot, "handoff.md"));

    const transport = createTransport(roots);
    await transport.scanNow();

    expect(await transport.getQueueSnapshot()).toMatchObject([
      {
        handoffId: invalid.handoffId,
        status: "rejected",
        lastError: "metadata.artifacts 引用的文件不存在：handoff.md",
      },
    ]);
  });

  it("入队后 metadata.json 发生变化时拒绝发送", async () => {
    const roots = createTestRoot();
    const valid = createValidPackage(roots.handoffRoot, { handoffId: "kh_mutated" });
    const calls: Array<{ url: string; body: unknown }> = [];
    const transport = createTransport(roots, { fetch: acceptedFetch(calls) });

    await transport.start();
    const metadataPath = path.join(valid.packageRoot, "metadata.json");
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as Record<string, unknown>;
    metadata.tampered_after_scan = true;
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    await transport.drainOnce();

    expect(calls).toHaveLength(0);
    expect(await transport.getQueueSnapshot()).toMatchObject([
      { handoffId: valid.handoffId, status: "rejected", lastError: "入队后交接包内容发生变化" },
    ]);
  });

  it("candidate 必须是 candidates/*.md Markdown 文件", async () => {
    const roots = createTestRoot();
    const invalid = createValidPackage(roots.handoffRoot, { handoffId: "kh_bad_candidate_path" });
    const oldPath = path.join(invalid.packageRoot, "candidates", "example.md");
    const newPath = path.join(invalid.packageRoot, "candidates", "example.txt");
    fs.renameSync(oldPath, newPath);
    const metadataPath = path.join(invalid.packageRoot, "metadata.json");
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as {
      artifacts: Array<{ path: string; media_type: string; size: number; sha256: string }>;
    };
    const artifact = metadata.artifacts.find((item) => item.path === "candidates/example.md");
    if (!artifact) throw new Error("test fixture candidate missing");
    artifact.path = "candidates/example.txt";
    const packageSha256 = sha256(JSON.stringify(metadata.artifacts));
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    const completePath = path.join(invalid.packageRoot, ".complete");
    fs.writeFileSync(
      completePath,
      fs.readFileSync(completePath, "utf8").replace(invalid.packageSha256, packageSha256),
      "utf8",
    );

    const transport = createTransport(roots);
    await transport.scanNow();

    expect(await transport.getQueueSnapshot()).toMatchObject([
      {
        handoffId: invalid.handoffId,
        status: "rejected",
        lastError: "candidate 路径或 media_type 非法：candidates/example.txt",
      },
    ]);
  });

  it("拒绝包内符号链接，避免读取 handoff 根目录之外的文件", async () => {
    const roots = createTestRoot();
    const invalid = createValidPackage(roots.handoffRoot, { handoffId: "kh_symlink" });
    const outsideFile = path.join(roots.root, "outside-secret.txt");
    fs.writeFileSync(outsideFile, "should-not-be-read", "utf8");
    const handoffPath = path.join(invalid.packageRoot, "handoff.md");
    fs.rmSync(handoffPath);
    try {
      fs.symlinkSync(outsideFile, handoffPath, "file");
    } catch {
      return;
    }

    const transport = createTransport(roots);
    await transport.scanNow();

    expect(await transport.getQueueSnapshot()).toMatchObject([
      { handoffId: invalid.handoffId, status: "rejected" },
    ]);
  });

  it("在读取 candidate 前拒绝经过包内符号链接目录", async () => {
    const roots = createTestRoot();
    const invalid = createValidPackage(roots.handoffRoot, { handoffId: "kh_nested_symlink" });
    const outsideCandidates = path.join(roots.root, "outside-candidates");
    fs.mkdirSync(outsideCandidates, { recursive: true });
    fs.copyFileSync(
      path.join(invalid.packageRoot, "candidates", "example.md"),
      path.join(outsideCandidates, "example.md"),
    );
    fs.rmSync(path.join(invalid.packageRoot, "candidates"), { recursive: true });
    try {
      fs.symlinkSync(outsideCandidates, path.join(invalid.packageRoot, "candidates"), "junction");
    } catch {
      return;
    }

    const transport = createTransport(roots);
    await transport.scanNow();

    expect(await transport.getQueueSnapshot()).toMatchObject([
      { handoffId: invalid.handoffId, status: "rejected" },
    ]);
  });

  it("扫描错误日志只包含交接包相对标识，不暴露本机绝对路径", async () => {
    const roots = createTestRoot();
    const invalid = createValidPackage(roots.handoffRoot, { handoffId: "kh_log_safe" });
    fs.writeFileSync(
      path.join(invalid.packageRoot, ".complete"),
      fs.readFileSync(path.join(invalid.packageRoot, ".complete"), "utf8").replace(invalid.packageSha256, "0".repeat(64)),
      "utf8",
    );
    const logs: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const transport = createTransport(roots, {
      onLog: (event, payload) => logs.push({ event, payload }),
    });

    await transport.scanNow();

    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs[0])).not.toContain(roots.root);
    expect(logs[0].payload.packageRef).toBe("mmd-project/kh_log_safe");
  });

  it("accepted ACK 后标记 delivered，重复补扫不重复上传", async () => {
    const roots = createTestRoot();
    const valid = createValidPackage(roots.handoffRoot);
    const calls: Array<{ url: string; body: unknown }> = [];
    const transport = createTransport(roots, { fetch: acceptedFetch(calls) });

    await transport.start();
    await transport.drainOnce();
    await transport.scanNow();
    await transport.drainOnce();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:8100/codex/knowledge/handoffs");
    expect(calls[0].body).toMatchObject({
      handoff_id: valid.handoffId,
      workspace_key: valid.workspaceKey,
      package_sha256: valid.packageSha256,
      package_content_sha256: expect.any(String),
    });
    expect(await transport.getQueueSnapshot()).toMatchObject([
      { handoffId: valid.handoffId, status: "delivered", ackId: "ack-1" },
    ]);
    expect(fs.existsSync(valid.packageRoot)).toBe(true);
  });

  it("duplicate ACK 也算持久化送达，不产生第二次发送", async () => {
    const roots = createTestRoot();
    createValidPackage(roots.handoffRoot);
    const calls: Array<{ url: string; body: unknown }> = [];
    const transport = createTransport(roots, {
      fetch: acceptedFetch(calls, { outcome: "duplicate", ack_id: "ack-existing" }),
    });

    await transport.start();
    await transport.drainOnce();
    await transport.drainOnce();

    expect(calls).toHaveLength(1);
    expect(await transport.getQueueSnapshot()).toMatchObject([
      { status: "delivered", ackId: "ack-existing" },
    ]);
  });

  it("并发 drain 只允许一个发送者领取同一队列项", async () => {
    const roots = createTestRoot();
    createValidPackage(roots.handoffRoot);
    const calls: Array<{ url: string; body: unknown }> = [];
    const transport = createTransport(roots, { fetch: acceptedFetch(calls) });

    await transport.start();
    const results = await Promise.all([transport.drainOnce(), transport.drainOnce()]);

    expect(calls).toHaveLength(1);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("另一个 Pet 实例持有 drain lock 时不会重复发送", async () => {
    const roots = createTestRoot();
    createValidPackage(roots.handoffRoot);
    const calls: Array<{ url: string; body: unknown }> = [];
    const transport = createTransport(roots, { fetch: acceptedFetch(calls) });

    await transport.start();
    fs.mkdirSync(path.dirname(roots.queueFile), { recursive: true });
    fs.writeFileSync(`${roots.queueFile}.drain.lock`, "other-pet\n", "utf8");

    expect(await transport.drainOnce()).toBeNull();
    expect(calls).toHaveLength(0);

    fs.rmSync(`${roots.queueFile}.drain.lock`);
  });

  it("离线或 5xx 会持久化失败队列，重启后可恢复发送", async () => {
    const roots = createTestRoot();
    createValidPackage(roots.handoffRoot);
    let available = false;
    const transport = createTransport(roots, {
      now: () => new Date("2026-08-05T00:00:00.000Z"),
      fetch: async () => {
        if (!available) throw new Error("offline");
        return new Response(JSON.stringify({ outcome: "accepted", ack_id: "ack-after-restart" }), { status: 200 });
      },
      retryDelaysMs: [0],
    });

    await transport.start();
    await transport.drainOnce();
    expect(await transport.getQueueSnapshot()).toMatchObject([
      { status: "retryable_failed", attempts: 1, lastError: "offline" },
    ]);

    available = true;
    const restarted = createTransport(roots, {
      now: () => new Date("2026-08-05T00:00:01.000Z"),
      fetch: acceptedFetch([], { outcome: "accepted", ack_id: "ack-after-restart" }),
      retryDelaysMs: [0],
    });
    await restarted.start();
    await restarted.drainOnce();

    expect(await restarted.getQueueSnapshot()).toMatchObject([
      { status: "delivered", ackId: "ack-after-restart", attempts: 2 },
    ]);
  });

  it("FastAPI 5xx 会进入可重试状态而不是拒绝包", async () => {
    const roots = createTestRoot();
    createValidPackage(roots.handoffRoot);
    const transport = createTransport(roots, {
      fetch: async () =>
        new Response(JSON.stringify({ detail: "service unavailable" }), { status: 503 }),
      retryDelaysMs: [0],
    });

    await transport.start();
    await transport.drainOnce();

    expect(await transport.getQueueSnapshot()).toMatchObject([
      { status: "retryable_failed", attempts: 1, lastError: "service unavailable" },
    ]);
  });

  it("请求超时会进入可重试状态", async () => {
    const roots = createTestRoot();
    createValidPackage(roots.handoffRoot);
    const transport = createTransport(roots, {
      requestTimeoutMs: 5,
      retryDelaysMs: [0],
      fetch: () => new Promise<KnowledgeHandoffFetchResponse>(() => undefined),
    });

    await transport.start();
    await transport.drainOnce();

    expect(await transport.getQueueSnapshot()).toMatchObject([
      {
        status: "retryable_failed",
        lastError: "FastAPI 请求超时（5ms）",
      },
    ]);
  });

  it("重启时会把没有收到 ACK 的 in-flight 项恢复为可重试", async () => {
    const roots = createTestRoot();
    createValidPackage(roots.handoffRoot);
    let resolveFetch: ((response: Response) => void) | null = null;
    let fetchStarted: (() => void) | null = null;
    const fetchStartedPromise = new Promise<void>((resolve) => {
      fetchStarted = resolve;
    });
    const transport = createTransport(roots, {
      fetch: async () => {
        fetchStarted?.();
        return new Promise<KnowledgeHandoffFetchResponse>((resolve) => {
          resolveFetch = resolve;
        });
      },
    });

    await transport.start();
    const draining = transport.drainOnce();
    await fetchStartedPromise;

    const restarted = createTransport(roots, {
      fetch: acceptedFetch([], { outcome: "accepted", ack_id: "ack-recovered" }),
      retryDelaysMs: [0],
    });
    await restarted.start();
    expect(await restarted.getQueueSnapshot()).toMatchObject([
      { status: "retryable_failed", lastError: "Pet 重启时未收到 FastAPI ACK" },
    ]);

    resolveFetch?.(
      new Response(JSON.stringify({ outcome: "accepted", ack_id: "ack-old-process" }), { status: 200 }),
    );
    await draining;
  });

  it("明确拒绝不会无限重试", async () => {
    const roots = createTestRoot();
    createValidPackage(roots.handoffRoot);
    const transport = createTransport(roots, {
      fetch: async () =>
        new Response(JSON.stringify({ outcome: "rejected", reason: "invalid_package" }), { status: 422 }),
    });

    await transport.start();
    await transport.drainOnce();
    await transport.drainOnce();

    expect(await transport.getQueueSnapshot()).toMatchObject([
      { status: "rejected", attempts: 1, lastError: "invalid_package" },
    ]);
  });

  it("2xx 响应缺少持久化 ACK 时不得标记 delivered", async () => {
    const roots = createTestRoot();
    createValidPackage(roots.handoffRoot, { handoffId: "kh_missing_ack" });
    const transport = createTransport(roots, {
      fetch: async () => new Response(JSON.stringify({ outcome: "accepted" }), { status: 200 }),
      retryDelaysMs: [0],
    });

    await transport.start();
    await transport.drainOnce();

    expect(await transport.getQueueSnapshot()).toMatchObject([
      {
        status: "retryable_failed",
        lastError: "FastAPI ACK 缺少 accepted/duplicate outcome 或 ack_id",
      },
    ]);
  });

  it("Git 事件提示只发送给 FastAPI，不进入知识审核或发布路径", async () => {
    const roots = createTestRoot();
    const calls: Array<{ url: string; body: unknown }> = [];
    const transport = createTransport(roots, { fetch: acceptedFetch(calls) });

    await transport.notifyGitEvent({
      workspaceKey: "mmd-project",
      eventType: "commit",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:8100/codex/knowledge/git-events");
    expect(calls[0].body).toEqual({
      workspace_key: "mmd-project",
      event_type: "commit",
    });
    await transport.notifyGitEvent({
      workspaceKey: "mmd-project",
      eventType: "push",
    });
    expect(calls[1].body).toEqual({
      workspace_key: "mmd-project",
      event_type: "push",
    });
  });

  it("能解析 worktree 的 .git 文件并把远端 refs 变化标记为 push", async () => {
    const roots = createTestRoot();
    const repositoryRoot = path.join(roots.root, "worktree");
    const gitDir = path.join(roots.root, "main-repo", ".git", "worktrees", "kh-02");
    const commonGitDir = path.join(roots.root, "main-repo", ".git");
    fs.mkdirSync(gitDir, { recursive: true });
    fs.mkdirSync(repositoryRoot, { recursive: true });
    fs.writeFileSync(path.join(gitDir, "commondir"), "../..\n", "utf8");
    fs.writeFileSync(
      path.join(repositoryRoot, ".git"),
      `gitdir: ${path.relative(repositoryRoot, gitDir)}\n`,
      "utf8",
    );
    createValidPackage(roots.handoffRoot, { repositoryRoot });

    const calls: Array<{ url: string; body: unknown }> = [];
    const watchedGitRoots: string[] = [];
    const triggerGitEvents: Array<(relativePath?: string) => void> = [];
    const transport = createTransport(roots, {
      fetch: acceptedFetch(calls),
      gitHintDebounceMs: 0,
      gitWatchFactory: (root, onChange) => {
        watchedGitRoots.push(root);
        triggerGitEvents.push(onChange);
        return { close() {} };
      },
    });

    await transport.start();
    for (const trigger of triggerGitEvents) trigger("refs/remotes/origin/main");
    await new Promise((resolve) => setTimeout(resolve, 10));
    for (const trigger of triggerGitEvents) trigger("HEAD");
    for (const trigger of triggerGitEvents) trigger("index");
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(watchedGitRoots).toEqual(expect.arrayContaining([gitDir, commonGitDir]));
    expect(calls).toContainEqual({
      url: "http://127.0.0.1:8100/codex/knowledge/git-events",
      body: { workspace_key: "mmd-project", event_type: "push" },
    });
    expect(calls).toContainEqual({
      url: "http://127.0.0.1:8100/codex/knowledge/git-events",
      body: { workspace_key: "mmd-project", event_type: "checkout" },
    });
    expect(calls).toContainEqual({
      url: "http://127.0.0.1:8100/codex/knowledge/git-events",
      body: { workspace_key: "mmd-project", event_type: "index_changed" },
    });
  });

  it("Git 提示不可用时，后续补扫仍能恢复交接包运输", async () => {
    const roots = createTestRoot();
    const valid = createValidPackage(roots.handoffRoot);
    const calls: Array<{ url: string; body: unknown }> = [];
    const transport = createTransport(roots, {
      fetch: async (input, init) => {
        calls.push({
          url: String(input),
          body: JSON.parse(String(init?.body ?? "{}")),
        });
        if (String(input).endsWith("/git-events")) throw new Error("git hint offline");
        return new Response(JSON.stringify({ outcome: "accepted", ack_id: "ack-recovered" }), { status: 200 });
      },
    });

    expect(await transport.notifyGitEvent({ workspaceKey: "mmd-project", eventType: "commit" })).toBe(false);
    await transport.scanNow();
    await transport.drainOnce();

    expect(await transport.getQueueSnapshot()).toMatchObject([
      { handoffId: valid.handoffId, status: "delivered", ackId: "ack-recovered" },
    ]);
    expect(fs.existsSync(valid.packageRoot)).toBe(true);
  });

  it("文件监听在 .complete 出现后触发补扫", async () => {
    const roots = createTestRoot();
    let triggerScan: (() => void) | null = null;
    const transport = createTransport(roots, {
      watchFactory: (_root, onChange) => {
        triggerScan = onChange;
        return { close() {} };
      },
    });

    await transport.start();
    createValidPackage(roots.handoffRoot, { handoffId: "kh_after_start" });
    triggerScan?.();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(await transport.getQueueSnapshot()).toMatchObject([
      { handoffId: "kh_after_start", status: "pending" },
    ]);
  });

  it("监听无法覆盖深层目录时由周期性补扫发现新包", async () => {
    const roots = createTestRoot();
    const transport = createTransport(roots, {
      reconciliationIntervalMs: 250,
    });

    await transport.start();
    createValidPackage(roots.handoffRoot, { handoffId: "kh_reconciled" });
    await new Promise((resolve) => setTimeout(resolve, 325));
    transport.stop();

    expect(await transport.getQueueSnapshot()).toMatchObject([
      { handoffId: "kh_reconciled", status: "pending" },
    ]);
  });
});
