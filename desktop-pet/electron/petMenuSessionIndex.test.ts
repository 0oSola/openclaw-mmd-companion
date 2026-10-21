import { describe, expect, it } from "vitest";

import { indexPetMenuSessions } from "./petMenuSessionIndex";

describe("Pet menu session index", () => {
  it("indexes both pet and Codex session identifiers for one task", () => {
    const session = {
      pet_session_id: "pet-session-1",
      codex_session_id: "codex_sess_0123456789abcdef",
      workspace_path: "D:\\workspace\\MMD project",
    };

    const index = indexPetMenuSessions([session]);

    expect(index.get(session.pet_session_id)).toBe(session);
    expect(index.get(session.codex_session_id)).toBe(session);
  });
});

