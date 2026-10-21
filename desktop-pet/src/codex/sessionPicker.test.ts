import { describe, expect, it } from "vitest";

import { buildSessionPickerItems, filterSessionPickerItems } from "./sessionPicker";

describe("desktop pet session picker", () => {
  const sessions = [
    {
      pet_session_id: "pet-login",
      codex_session_id: "019e88e4-4f27-7f20-be48-fd1ef50e9492",
      display_title: "fix login layout",
      workspace_path: "D:\\workspace\\MMD project",
      last_status: "waiting_approval",
      last_seen_at: "2026-06-03T10:18:00+08:00",
    },
    {
      pet_session_id: "pet-api",
      codex_session_id: "019e88e5-4f27-7f20-be48-fd1ef50e9492",
      first_prompt_preview: "wire podcast API",
      workspace_path: "D:\\workspace\\Other project",
      last_status: "completed",
      updated_at: "2026-06-02T09:00:00+08:00",
    },
  ];

  it("builds readable picker rows without raw uuid noise", () => {
    const items = buildSessionPickerItems(sessions, new Date("2026-06-03T11:00:00+08:00"));

    expect(items[0]).toMatchObject({
      petSessionId: "pet-login",
      title: "fix login layout",
      subtitle: "MMD project · waiting approval · 10:18",
      isActive: true,
    });
    expect(items[0].searchText).toContain("fix login layout");
    expect(items[0].searchText).toContain("mmd project");
    expect(items[0].searchText).toContain("waiting approval");
    expect(items[0].title).not.toContain("019e88e4");
  });

  it("shows the discovered agent runtime when it is available", () => {
    const items = buildSessionPickerItems(
      [
        {
          ...sessions[0],
          agent: "codex",
          runtime: "desktop",
        },
      ],
      new Date("2026-06-03T11:00:00+08:00"),
    );

    expect(items[0]?.subtitle).toBe("Codex Desktop · MMD project · waiting approval · 10:18");
    expect(items[0]?.searchText).toContain("codex desktop");
  });

  it("labels idle sessions instead of exposing the raw status key", () => {
    const items = buildSessionPickerItems([
      {
        pet_session_id: "codex:idle",
        codex_session_id: "idle",
        display_title: "background review",
        workspace_path: "D:\\workspace\\MMD project",
        last_status: "idle",
        last_seen_at: "2026-08-05T10:00:00.000Z",
      },
    ]);

    expect(items[0]?.status).toBe("idle");
    expect(items[0]?.subtitle).toContain("idle");
  });

  it("filters by title, workspace, and status terms", () => {
    const items = buildSessionPickerItems(sessions, new Date("2026-06-03T11:00:00+08:00"));

    expect(filterSessionPickerItems(items, "login").map((item) => item.petSessionId)).toEqual(["pet-login"]);
    expect(filterSessionPickerItems(items, "Other completed").map((item) => item.petSessionId)).toEqual(["pet-api"]);
    expect(filterSessionPickerItems(items, "missing")).toEqual([]);
  });

  it("marks active tasks so the bottom dialog can focus their existing window", () => {
    const items = buildSessionPickerItems(sessions, new Date("2026-06-03T11:00:00+08:00"));

    expect(items.map((item) => [item.petSessionId, item.isActive])).toEqual([
      ["pet-login", true],
      ["pet-api", false],
    ]);
  });

  it("builds readable session details with redacted and truncated prompt and summary previews", () => {
    const items = buildSessionPickerItems(
      [
        {
          pet_session_id: "pet-sensitive",
          codex_session_id: "019e88e6-4f27-7f20-be48-fd1ef50e9492",
          display_title: "audit deployment config",
          workspace_path: "D:\\workspace\\MMD project",
          last_status: "running",
          last_seen_at: "2026-06-03T10:18:00+08:00",
          first_prompt_preview:
            "Review deploy settings with password=hunter2 and OPENAI_API_KEY=sk-live-secret-value before release. ".repeat(
              3,
            ),
          last_summary:
            "Found the failing rollout guard, updated the validation path, and kept token: ghp_super_secret_token out of logs. ".repeat(
              3,
            ),
        },
      ],
      new Date("2026-06-03T11:00:00+08:00"),
    );

    expect(items[0]).toMatchObject({
      workspace: "MMD project",
      status: "running",
      time: "10:18",
    });
    expect(items[0].promptPreview).toContain("password=[redacted]");
    expect(items[0].promptPreview).toContain("OPENAI_API_KEY=[redacted]");
    expect(items[0].promptPreview).toMatch(/^Review deploy settings.*\.\.\.$/);
    expect(items[0].summaryPreview).toContain("token: [redacted]");
    expect(items[0].summaryPreview).toMatch(/^Found the failing rollout guard.*\.\.\.$/);
    expect(items[0].promptPreview.length).toBeLessThanOrEqual(104);
    expect(items[0].summaryPreview.length).toBeLessThanOrEqual(104);
    expect(items[0].promptPreview).not.toContain("hunter2");
    expect(items[0].promptPreview).not.toContain("sk-live-secret-value");
    expect(items[0].summaryPreview).not.toContain("ghp_super_secret_token");
  });

  it("filters by redacted prompt and summary content without exposing secrets", () => {
    const items = buildSessionPickerItems(
      [
        {
          pet_session_id: "pet-summary",
          codex_session_id: "019e88e7-4f27-7f20-be48-fd1ef50e9492",
          display_title: "quiet title",
          first_prompt_preview:
            "Investigate playwright screenshot clipping with secret=my-password. ".repeat(4) +
            "Needle prompt phrase.",
          last_summary:
            "Session summary mentions translucent hit surface and approval retry behavior. ".repeat(4) +
            "Needle summary phrase.",
          workspace_path: "D:\\workspace\\MMD project",
          last_status: "completed",
        },
      ],
      new Date("2026-06-03T11:00:00+08:00"),
    );

    expect(filterSessionPickerItems(items, "screenshot translucent").map((item) => item.petSessionId)).toEqual([
      "pet-summary",
    ]);
    expect(filterSessionPickerItems(items, "needle prompt summary").map((item) => item.petSessionId)).toEqual([
      "pet-summary",
    ]);
    expect(items[0].searchText).toContain("secret=[redacted]");
    expect(items[0].searchText).not.toContain("my-password");
  });

  it("redacts fallback titles and search text when no display title is available", () => {
    const items = buildSessionPickerItems(
      [
        {
          pet_session_id: "pet-title-secret",
          codex_session_id: "019e88e8-4f27-7f20-be48-fd1ef50e9492",
          first_prompt_preview: "resume deploy with password=hunter2 and api_key=sk-live-secret",
          workspace_path: "D:\\workspace\\MMD project",
          last_status: "running",
        },
      ],
      new Date("2026-06-03T11:00:00+08:00"),
    );

    expect(items[0].title).toContain("password=[redacted]");
    expect(items[0].title).toContain("api_key=[redacted]");
    expect(items[0].title).not.toContain("hunter2");
    expect(items[0].title).not.toContain("sk-live-secret");
    expect(items[0].searchText).not.toContain("hunter2");
    expect(items[0].searchText).not.toContain("sk-live-secret");
  });

  it("does not show injected context as a session title or prompt preview", () => {
    const items = buildSessionPickerItems([
      {
        pet_session_id: "pet-injected",
        codex_session_id: "019e88e9-4f27-7f20-be48-fd1ef50e9492",
        display_title: "<recommended_plugins> Here is a list of plugins...",
        first_prompt_preview: "<app-context> Codex desktop runtime details...",
        workspace_path: "D:\\workspace\\MMD project",
        last_status: "running",
      },
    ]);

    expect(items[0]).toMatchObject({
      title: "MMD project",
      promptPreview: "No prompt preview",
    });
    expect(items[0].title).not.toContain("<recommended_plugins>");
    expect(items[0].promptPreview).not.toContain("<app-context>");
  });
});
