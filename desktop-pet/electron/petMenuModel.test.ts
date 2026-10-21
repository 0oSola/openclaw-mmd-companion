import { describe, expect, it } from "vitest";

import {
  buildActiveWorkspaceSummaries,
  buildPetMenuModel,
  formatSessionMenuLabel,
  shortSessionId,
} from "./petMenuModel.js";

describe("desktop pet menu model", () => {
  const defaultMenuOptions = {
    interactionMode: "window-drag",
    notificationProfile: "medium",
    menuLanguage: "en",
    sessions: [],
    apiAvailable: true,
    now: new Date("2026-06-03T00:00:00+08:00"),
    alwaysOnTop: true,
  } satisfies Parameters<typeof buildPetMenuModel>[0];

  it("formats readable restore labels without uuid noise", () => {
    const label = formatSessionMenuLabel(
      {
        display_title: "web login layout fix",
        workspace_path: "D:/workspace/MMD project",
        last_status: "waiting_approval",
        last_seen_at: "2026-06-02T15:18:00Z",
        codex_session_id: "11111111-2222-3333-4444-555555555555",
      },
      new Date("2026-06-03T00:00:00+08:00"),
    );

    expect(label).toContain("Continue: web login layout fix");
    expect(label).toContain("waiting approval");
    expect(label).not.toContain("11111111-2222");
  });

  it("translates idle status in both menu languages", () => {
    const session = {
      display_title: "background review",
      workspace_path: "D:/workspace/MMD project",
      last_status: "idle",
      last_seen_at: "2026-06-02T15:18:00Z",
    };

    expect(formatSessionMenuLabel(session, new Date("2026-06-03T00:00:00+08:00"))).toContain("idle");
    expect(
      formatSessionMenuLabel(session, new Date("2026-06-03T00:00:00+08:00"), "zh-CN"),
    ).toContain("空闲");
  });

  it("redacts sensitive fallback prompt text in recent session labels", () => {
    const label = formatSessionMenuLabel(
      {
        first_prompt_preview: "resume deploy with password=hunter2 and api_key=sk-live-secret",
        workspace_path: "D:/workspace/MMD project",
        last_status: "running",
        last_seen_at: "2026-06-02T15:18:00Z",
      },
      new Date("2026-06-03T00:00:00+08:00"),
    );

    expect(label).toContain("password=[redacted]");
    expect(label).toContain("api_key=[redacted]");
    expect(label).not.toContain("hunter2");
    expect(label).not.toContain("sk-live-secret");
  });

  it("shortens ids only for details", () => {
    expect(shortSessionId("11111111-2222-3333-4444-555555555555")).toBe("11111111...55555555");
  });

  it("groups active workspace summaries and ignores finished sessions", () => {
    expect(
      buildActiveWorkspaceSummaries([
        {
          pet_session_id: "pet-1",
          codex_session_id: "codex-1",
          display_title: "update login card",
          workspace_path: "D:\\workspace\\MMD project",
          last_status: "running",
          last_seen_at: "2026-06-03T09:10:00+08:00",
        },
        {
          pet_session_id: "pet-2",
          codex_session_id: "codex-2",
          first_prompt_preview: "fix approval flow",
          workspace_path: "D:\\workspace\\MMD project",
          last_status: "waiting_approval",
          last_seen_at: "2026-06-03T09:15:00+08:00",
        },
        {
          pet_session_id: "pet-3",
          workspace_path: "D:\\workspace\\done project",
          last_status: "completed",
          last_seen_at: "2026-06-03T09:20:00+08:00",
        },
      ]),
    ).toEqual([
      {
        workspacePath: "D:\\workspace\\MMD project",
        activeSessionCount: 2,
        lastStatus: "waiting_approval",
        lastSeenAt: "2026-06-03T09:15:00+08:00",
        activeTasks: [
          {
            petSessionId: "pet-2",
            codexSessionId: "codex-2",
            title: "fix approval flow",
            status: "waiting_approval",
            lastSeenAt: "2026-06-03T09:15:00+08:00",
          },
          {
            petSessionId: "pet-1",
            codexSessionId: "codex-1",
            title: "update login card",
            status: "running",
            lastSeenAt: "2026-06-03T09:10:00+08:00",
          },
        ],
      },
    ]);
  });

  it("builds the expected top-level menu actions", () => {
    const model = buildPetMenuModel(defaultMenuOptions);

    expect(model.map((item) => item.id)).toEqual([
      "workspace",
      "new-session",
      "send-prompt",
      "recent-sessions",
      "more-sessions",
      "separator:settings",
      "interaction-mode",
      "notification-detail",
      "menu-language",
      "agent",
      "codex-env",
      "codex-launch-target",
      "always-on-top",
      "focus-vscode",
      "sync-main-site",
      "separator:close",
      "close",
    ]);
    expect(model.find((item) => item.id === "focus-vscode")?.label).toBe("Open VSCode Workspace");
    expect(model.find((item) => item.id === "send-prompt")?.label).toBe("Send Prompt...");
  });

  it("defaults the new-session label and agent submenu to Codex", () => {
    const model = buildPetMenuModel(defaultMenuOptions);

    expect(model.find((item) => item.id === "new-session")?.label).toBe("New Codex Session");
    const agentItem = model.find((item) => item.id === "agent");
    expect(agentItem?.label).toBe("Coding Agent");
    expect(agentItem?.submenu).toEqual([
      { id: "agent:codex", label: "Codex", type: "radio", checked: true, action: { type: "agent", agent: "codex" } },
      { id: "agent:claude", label: "Claude", type: "radio", checked: false, action: { type: "agent", agent: "claude" } },
    ]);
  });

  it("labels the new session and checks the agent submenu for the selected Claude agent", () => {
    const model = buildPetMenuModel({ ...defaultMenuOptions, agent: "claude" });

    expect(model.find((item) => item.id === "new-session")?.label).toBe("New Claude Session");
    const agentSubmenu = model.find((item) => item.id === "agent")?.submenu;
    expect(agentSubmenu?.find((item) => item.id === "agent:codex")?.checked).toBe(false);
    expect(agentSubmenu?.find((item) => item.id === "agent:claude")?.checked).toBe(true);
  });

  it("checks the persisted WSL environment in the Codex environment submenu", () => {
    const model = buildPetMenuModel({ ...defaultMenuOptions, codexEnvMode: "wsl" });
    const envSubmenu = model.find((item) => item.id === "codex-env")?.submenu;

    expect(envSubmenu?.find((item) => item.id === "codex-env:win")?.checked).toBe(false);
    expect(envSubmenu?.find((item) => item.id === "codex-env:wsl")?.checked).toBe(true);
  });

  it("defaults Codex launches to VSCode CLI and exposes a persisted Desktop alternative", () => {
    const defaultTarget = buildPetMenuModel(defaultMenuOptions).find((item) => item.id === "codex-launch-target");
    expect(defaultTarget).toEqual({
      id: "codex-launch-target",
      label: "Codex Launch Tool",
      submenu: [
        {
          id: "codex-launch-target:vscode-cli",
          label: "VSCode + Codex CLI",
          type: "radio",
          checked: true,
          action: { type: "codex-launch-target", target: "vscode-cli" },
        },
        {
          id: "codex-launch-target:codex-desktop",
          label: "Codex Desktop",
          type: "radio",
          checked: false,
          action: { type: "codex-launch-target", target: "codex-desktop" },
        },
      ],
    });

    const desktopTarget = buildPetMenuModel({
      ...defaultMenuOptions,
      codexLaunchTarget: "codex-desktop",
    }).find((item) => item.id === "codex-launch-target");
    expect(desktopTarget?.submenu?.find((item) => item.id === "codex-launch-target:codex-desktop")?.checked).toBe(true);
  });

  it("shows the selected workspace and exposes a select workspace action", () => {
    const workspace = buildPetMenuModel({
      ...defaultMenuOptions,
      selectedWorkspacePath: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet",
    }).find((item) => item.id === "workspace");

    expect(workspace).toMatchObject({
      id: "workspace",
      label: "Workspace",
      submenu: [
        {
          id: "workspace:current",
          label: "Current: desktop-mmd-codex-pet",
          enabled: false,
        },
        {
          id: "workspace:select",
          label: "Select Workspace...",
          action: { type: "select-workspace" },
        },
      ],
    });
  });

  it("shows multiple Codex Desktop remote projects and selects the active project", () => {
    const workspace = buildPetMenuModel({
      ...defaultMenuOptions,
      selectedWorkspacePath: "D:\\workspace\\MMD project",
      codexRemoteWorkspaces: [
        { id: "mmd-companion", path: "D:\\workspace\\MMD project", source: "codex-desktop-ssh", label: "mmd-companion · MMD project" },
        {
          id: "other-project",
          path: "D:\\workspace\\other project",
          source: "codex-desktop-ssh",
          label: "other-project · other project",
        },
      ],
    }).find((item) => item.id === "workspace");

    expect(workspace?.submenu?.find((item) => item.id === "workspace:codex-remote")?.submenu).toEqual([
      {
        id: "workspace:codex-remote:refresh",
        label: "Refresh macCodex projects",
        action: { type: "refresh-remote-projects" },
      },
      { id: "workspace:codex-remote:separator", type: "separator" },
      {
        id: "workspace:codex-remote:mmd-companion",
        label: "mmd-companion · MMD project",
        type: "radio",
        checked: true,
        action: {
          type: "select-codex-workspace",
          workspaceId: "mmd-companion",
          workspacePath: "D:\\workspace\\MMD project",
        },
      },
      {
        id: "workspace:codex-remote:other-project",
        label: "other-project · other project",
        type: "radio",
        checked: false,
        action: {
          type: "select-codex-workspace",
          workspaceId: "other-project",
          workspacePath: "D:\\workspace\\other project",
        },
      },
    ]);
  });

  it("only shows Codex Desktop SSH projects in the Codex remote submenu", () => {
    const workspace = buildPetMenuModel({
      ...defaultMenuOptions,
      codexRemoteWorkspaces: [
        { id: "mmd-companion", path: "D:\\workspace\\MMD project", source: "env" },
        {
          id: "desktop-remote",
          path: "/Users/sola/workspace/voice-workflow-service",
          source: "codex-desktop-ssh",
          label: "voice-workflow-service · macCodex",
        },
      ],
    }).find((item) => item.id === "workspace");

    const remoteMenu = workspace?.submenu?.find((item) => item.id === "workspace:codex-remote");
    expect(remoteMenu?.submenu?.find((item) => item.id === "workspace:codex-remote:desktop-remote")).toEqual(
      expect.objectContaining({
        id: "workspace:codex-remote:desktop-remote",
        label: "voice-workflow-service · macCodex",
      }),
    );
  });

  it("labels SSH-discovered and cached remote projects", () => {
    const workspace = buildPetMenuModel({
      ...defaultMenuOptions,
      menuLanguage: "zh-CN",
      codexRemoteWorkspaces: [
        {
          id: "momask",
          path: "/Users/sola/workspace/MoMask",
          source: "codex-desktop-ssh",
          label: "MoMask · macCodex",
          availability: "ssh_discovered",
        },
        {
          id: "qwen",
          path: "/Users/sola/Desktop/kscc/Qwen3-TTS",
          source: "codex-desktop-ssh",
          label: "Qwen3-TTS · macCodex",
          availability: "cached_offline",
        },
      ],
    }).find((item) => item.id === "workspace");
    const remoteItems = workspace?.submenu?.find((item) => item.id === "workspace:codex-remote")?.submenu ?? [];
    expect(remoteItems.find((item) => item.id === "workspace:codex-remote:momask")?.label).toBe("MoMask · macCodex · SSH 已发现");
    expect(remoteItems.find((item) => item.id === "workspace:codex-remote:qwen")?.label).toBe("Qwen3-TTS · macCodex · 离线缓存");
  });

  it("states that Codex Desktop remote tasks still require project confirmation", () => {
    const items = buildPetMenuModel({
      ...defaultMenuOptions,
      menuLanguage: "zh-CN",
      selectedWorkspacePath: "/Users/sola/workspace/MoMask",
      codexLaunchTarget: "codex-desktop",
      codexRemoteWorkspaces: [
        {
          id: "momask",
          path: "/Users/sola/workspace/MoMask",
          source: "codex-desktop-ssh",
          label: "MoMask · macCodex",
        },
      ],
    });

    expect(items.find((item) => item.id === "new-session")?.label).toBe(
      "打开 Codex Desktop 新任务（需确认远程项目）",
    );
  });

  it("shows active workspaces and lets users switch from the workspace menu", () => {
    const workspace = buildPetMenuModel({
      ...defaultMenuOptions,
      selectedWorkspacePath: "D:\\workspace\\MMD project",
      activeWorkspaces: [
        {
          workspacePath: "D:\\workspace\\MMD project",
          activeSessionCount: 2,
          lastStatus: "waiting_approval",
          lastSeenAt: "2026-06-03T09:15:00+08:00",
          activeTasks: [
            {
              petSessionId: "pet-approval",
              title: "approval unblock",
              status: "waiting_approval",
              lastSeenAt: "2026-06-03T09:15:00+08:00",
            },
            {
              petSessionId: "pet-build",
              title: "run desktop-pet check",
              status: "running",
              lastSeenAt: "2026-06-03T09:10:00+08:00",
            },
          ],
        },
        {
          workspacePath: "D:\\workspace\\other project",
          activeSessionCount: 1,
          lastStatus: "command_running",
          lastSeenAt: "2026-06-03T09:12:00+08:00",
          activeTasks: [
            {
              petSessionId: "pet-other",
              title: "ship menu grouping",
              status: "command_running",
              lastSeenAt: "2026-06-03T09:12:00+08:00",
            },
          ],
        },
      ],
    }).find((item) => item.id === "workspace");

    const activeWorkspaces = workspace?.submenu?.find((item) => item.id === "workspace:active");
    expect(activeWorkspaces).toMatchObject({
      id: "workspace:active",
      label: "Active Workspaces",
      enabled: true,
    });
    expect(activeWorkspaces?.submenu?.[0]).toMatchObject({
      id: "workspace:active:D:\\workspace\\MMD project",
      label: "MMD project - waiting approval - 2 active tasks",
      enabled: true,
      action: { type: "focus-active-session", petSessionId: "pet-approval" },
    });
    expect(activeWorkspaces?.submenu?.[1]).toMatchObject({
      id: "workspace:active-task:pet-approval",
      label: "approval unblock - waiting approval",
      action: { type: "focus-active-session", petSessionId: "pet-approval" },
    });
    expect(activeWorkspaces?.submenu?.[2]).toMatchObject({
      id: "workspace:active-task:pet-build",
      label: "run desktop-pet check - running",
      action: { type: "focus-active-session", petSessionId: "pet-build" },
    });
    expect(activeWorkspaces?.submenu?.[3]).toMatchObject({
      id: "workspace:active:D:\\workspace\\other project",
      label: "other project - running command",
      enabled: true,
      action: { type: "switch-workspace", workspacePath: "D:\\workspace\\other project" },
    });
    expect(activeWorkspaces?.submenu?.[4]).toMatchObject({
      id: "workspace:active-task:pet-other",
      label: "ship menu grouping - running command",
      action: { type: "focus-active-session", petSessionId: "pet-other" },
    });
  });

  it("builds Chinese workspace labels", () => {
    const workspace = buildPetMenuModel({
      ...defaultMenuOptions,
      menuLanguage: "zh-CN",
      selectedWorkspacePath: "D:\\workspace\\MMD project",
    }).find((item) => item.id === "workspace");

    expect(workspace?.label).toBe("工作区");
    expect(workspace?.submenu?.[0]).toMatchObject({
      id: "workspace:current",
      label: "当前：MMD project",
      enabled: false,
    });
    expect(workspace?.submenu?.[1]).toMatchObject({
      id: "workspace:select",
      label: "选择工作区...",
      action: { type: "select-workspace" },
    });
  });

  it("builds a checked always-on-top checkbox that toggles to disabled", () => {
    const item = buildPetMenuModel({ ...defaultMenuOptions, alwaysOnTop: true }).find(
      (menuItem) => menuItem.id === "always-on-top",
    );

    expect(item).toEqual({
      id: "always-on-top",
      label: "Always on Top",
      type: "checkbox",
      checked: true,
      action: { type: "always-on-top", enabled: false },
    });
  });

  it("builds an unchecked Chinese always-on-top checkbox that toggles to enabled", () => {
    const item = buildPetMenuModel({
      ...defaultMenuOptions,
      menuLanguage: "zh-CN",
      alwaysOnTop: false,
    }).find((menuItem) => menuItem.id === "always-on-top");

    expect(item).toEqual({
      id: "always-on-top",
      label: "固定在顶部",
      type: "checkbox",
      checked: false,
      action: { type: "always-on-top", enabled: true },
    });
  });


  it("limits recent sessions and avoids raw uuid labels", () => {
    const sessions = Array.from({ length: 12 }, (_, index) => ({
      pet_session_id: `pet-${index}`,
      codex_session_id: `11111111-2222-3333-4444-5555555555${String(index).padStart(2, "0")}`,
      display_title: `session ${index}`,
      last_status: "running",
      last_seen_at: "2026-06-02T15:18:00Z",
    }));

    const recent = buildPetMenuModel({
      interactionMode: "window-drag",
      notificationProfile: "low",
      menuLanguage: "en",
      sessions,
      apiAvailable: true,
      now: new Date("2026-06-03T00:00:00+08:00"),
    }).find((item) => item.id === "recent-sessions");

    expect(recent?.submenu).toHaveLength(10);
    expect(recent?.submenu?.[0].label).toContain("Continue: session 0");
    expect(recent?.submenu?.[0].label).not.toContain("11111111-2222");
  });

  it("builds Chinese menu labels when language is Chinese", () => {
    const model = buildPetMenuModel({
      interactionMode: "camera-adjust",
      notificationProfile: "high",
      menuLanguage: "zh-CN",
      sessions: [
        {
          pet_session_id: "pet-1",
          display_title: "修复登录页布局",
          last_status: "waiting_approval",
          last_seen_at: "2026-06-03T10:18:00+08:00",
        },
      ],
      apiAvailable: false,
      now: new Date("2026-06-03T11:00:00+08:00"),
    });

    expect(model.find((item) => item.id === "new-session")?.label).toBe("新建 Codex 会话");
    expect(model.find((item) => item.id === "send-prompt")?.label).toBe("发送 Prompt...");
    expect(model.find((item) => item.id === "recent-sessions")?.label).toBe("最近会话");
    expect(model.find((item) => item.id === "sync-main-site")?.label).toBe("从主站同步");
    expect(model.find((item) => item.id === "focus-vscode")?.label).toBe("打开 VSCode 工作区");
    expect(model.find((item) => item.id === "menu-language")?.submenu?.map((item) => item.label)).toEqual([
      "English",
      "中文",
    ]);
    expect(model.find((item) => item.id === "recent-sessions")?.submenu?.[0].label).toContain(
      "继续：修复登录页布局",
    );
    expect(model.find((item) => item.id === "recent-sessions")?.submenu?.[0].label).toContain("等待审批");
  });
});
