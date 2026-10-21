// Executed with Node's built-in test runner; the filename intentionally avoids Vitest discovery.
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGitHintRequest,
  main,
  sendGitHint,
} from "./knowledge-handoff-git-hint.mjs";

test("builds an explicit push hint for the FastAPI boundary", () => {
  assert.deepEqual(
    buildGitHintRequest({
      workspaceKey: "mmd-project",
      eventType: "push",
      apiBaseUrl: "http://127.0.0.1:8100/",
    }),
    {
      url: "http://127.0.0.1:8100/codex/knowledge/git-events",
      body: { workspace_key: "mmd-project", event_type: "push" },
    },
  );
});

test("sends a Git hint without involving OpenClaw", async () => {
  let request;
  const result = await sendGitHint(
    {
      workspaceKey: "mmd-project",
      eventType: "commit",
      apiBaseUrl: "http://127.0.0.1:8100",
      transportToken: "test-token",
    },
    async (url, init) => {
      request = { url, init };
      return { ok: true, status: 200 };
    },
  );

  assert.deepEqual(result, { ok: true, status: 200 });
  assert.equal(request.url, "http://127.0.0.1:8100/codex/knowledge/git-events");
  assert.equal(request.init.headers["x-codex-knowledge-transport-token"], "test-token");
  assert.deepEqual(JSON.parse(request.init.body), {
    workspace_key: "mmd-project",
    event_type: "commit",
  });
});

test("hint failure does not block the Git operation", async () => {
  const exitCode = await main(
    ["--workspace-key", "mmd-project", "--event", "push"],
    { MMD_PET_API_BASE_URL: "http://127.0.0.1:1" },
  );
  assert.equal(exitCode, 0);
});
