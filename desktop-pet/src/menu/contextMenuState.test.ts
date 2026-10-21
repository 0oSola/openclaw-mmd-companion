import { describe, expect, it } from "vitest";

import {
  clampContextMenuPosition,
  enterContextMenuSubmenu,
  leaveContextMenuSubmenu,
} from "./contextMenuState";

describe("renderer context menu state", () => {
  it("keeps the menu inside the Pet viewport", () => {
    expect(
      clampContextMenuPosition({
        requested: { x: 230, y: 270 },
        viewport: { width: 250, height: 290 },
        menu: { width: 218, height: 250 },
        margin: 6,
      }),
    ).toEqual({ x: 26, y: 34 });
  });

  it("preserves a valid requested position", () => {
    expect(
      clampContextMenuPosition({
        requested: { x: 12, y: 18 },
        viewport: { width: 360, height: 420 },
        menu: { width: 218, height: 250 },
        margin: 6,
      }),
    ).toEqual({ x: 12, y: 18 });
  });

  it("enters and leaves nested submenu levels without horizontal flyouts", () => {
    const workspacePath = enterContextMenuSubmenu([], "workspace");
    const activePath = enterContextMenuSubmenu(workspacePath, "workspace:active");

    expect(activePath).toEqual(["workspace", "workspace:active"]);
    expect(leaveContextMenuSubmenu(activePath)).toEqual(["workspace"]);
    expect(leaveContextMenuSubmenu([])).toEqual([]);
  });
});
