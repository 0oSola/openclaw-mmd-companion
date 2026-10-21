import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routePath = path.resolve(__dirname, "../src/app/mmd-calibration-render/page.tsx");

test("mmd calibration render route reuses the shared MMDStage runtime", () => {
  const source = readFileSync(routePath, "utf8");

  assert.match(source, /MMDStage/);
  assert.match(source, /modelUrl/);
  assert.match(source, /vmdUrl/);
  assert.match(source, /renderPipeline/);
  assert.match(source, /mmd-calibration-render/);
});

test("mmd calibration render route accepts v14d-game as a shared-runtime pipeline", () => {
  const source = readFileSync(routePath, "utf8");

  assert.match(source, /value === "v14d-game"/);
});
