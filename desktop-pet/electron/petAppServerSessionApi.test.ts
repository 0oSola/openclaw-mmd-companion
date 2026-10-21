import { describe, expect, it, vi } from "vitest";

import { createPetAppServerSessionScanner } from "./petAppServerSessionApi.js";

describe("Pet app-server session API provider", () => {
  it("reads a bounded, user-scoped session snapshot", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          sessions: [
            {
              id: "codex_sess_runtime",
              workspace_id: "mmd-companion",
              workspace_path: "D:\\workspace\\MMD project",
              status: "running",
              created_at: "2026-08-05T09:50:00.000Z",
              last_active_at: "2026-08-05T09:59:00.000Z",
              process_id: 4321,
              codex_version: "codex-test/1.0",
              transport: "stdio",
              sandbox: "read-only",
              metadata: { mode: "read_only" },
            },
          ],
          limit: 10,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const scan = createPetAppServerSessionScanner({
      apiBaseUrl: "http://127.0.0.1:8000",
      userId: "admin-1",
      fetcher,
    });
    const sessions = await scan(10);

    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/codex/interactive/sessions?limit=10",
      { headers: { "x-user-id": "admin-1" } },
    );
    expect(sessions[0]).toMatchObject({
      id: "codex_sess_runtime",
      workspaceId: "mmd-companion",
      workspacePath: "D:\\workspace\\MMD project",
      status: "running",
      lastOutputPreview: null,
      mode: "read_only",
    });
  });

  it("fails closed when the app-server registry is unavailable", async () => {
    const scan = createPetAppServerSessionScanner({
      apiBaseUrl: "http://127.0.0.1:8000",
      userId: "admin-1",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response("offline", { status: 503 })),
    });

    await expect(scan(10)).rejects.toThrow("app-server sessions failed: 503");
  });
});
