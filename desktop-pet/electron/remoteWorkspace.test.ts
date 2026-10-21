import { describe, expect, it } from "vitest";

import { isSshWorkspaceUri, remoteAuthorityFromUri, remoteWorkspaceLabel } from "./remoteWorkspace.js";

describe("Remote-SSH workspace identity", () => {
  const uri = "vscode-remote://ssh-remote+dev-box/home/ksg/MMD%20project";

  it("recognizes Remote-SSH workspace URIs", () => {
    expect(isSshWorkspaceUri(uri)).toBe(true);
    expect(isSshWorkspaceUri("D:/workspace/MMD project")).toBe(false);
  });

  it("extracts the SSH authority and readable project label", () => {
    expect(remoteAuthorityFromUri(uri)).toBe("dev-box");
    expect(remoteWorkspaceLabel(uri)).toBe("dev-box:MMD project");
  });
});
