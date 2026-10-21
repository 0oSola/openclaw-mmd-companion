import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("MMDStage imperative handle", () => {
  it("exposes the WebGPU stage rectangle when the Three.js container is not mounted", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../../web/src/features/stage/MMDStage.tsx"),
      "utf8",
    );

    expect(source).toContain("containerRef.current?.getBoundingClientRect()");
    expect(source).toContain("webGpuStageRef.current?.getStageRect?.()");
  });

  it("captures and restores the WebGPU camera instead of returning a no-op snapshot", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../../web/src/features/stage/RezeWebGpuStage.tsx"),
      "utf8",
    );

    expect(source).toContain("cameraSnapshotRef");
    expect(source).toContain("getPosition()");
    expect(source).toContain("engineRef.current");
    expect(source).not.toContain("captureCamera: () => null");
  });
});
