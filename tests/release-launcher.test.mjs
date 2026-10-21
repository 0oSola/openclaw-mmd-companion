import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(projectRoot, relativePath), "utf8");

test("release entrypoints expose build/start/stop/status/kill", () => {
  const script = read("scripts/release-stack.ps1");
  const wrapper = read("start-release.ps1");
  const cmd = read("start-release.cmd");

  assert.match(script, /ValidateSet\("build", "start", "stop", "status", "kill"\)/);
  assert.match(script, /release-stack\.json/);
  assert.ok(script.includes('.runtime\\release-stack'));
  assert.match(wrapper, /scripts\\release-stack\.ps1/);
  assert.match(cmd, /start-release\.ps1/i);
});

test("release build injects the configured API URL into Web and Pet", () => {
  const script = read("scripts/release-stack.ps1");

  assert.ok(script.includes('NEXT_PUBLIC_API_BASE_URL = $ResolvedApiBaseUrl'));
  assert.ok(script.includes('MMD_PET_API_BASE_URL = $ResolvedApiBaseUrl'));
  assert.ok(script.includes('NEXT_DIST_DIR = $script:WebDistDir'));
  assert.ok(script.includes('MMD_PET_RELEASE = "1"'));
});

test("default API data resolution recognizes invalid SQLite and preserves explicit configuration", () => {
  const script = read("scripts/release-stack.ps1");

  assert.match(script, /function Test-GitLfsPointer/);
  assert.match(script, /function Test-SqliteDatabaseFile/);
  assert.match(script, /function Resolve-ReleaseApiDataDir/);
  assert.match(script, /PSBoundParameters\.ContainsKey\("ApiDataDir"\)/);
  assert.match(script, /ConfiguredEnvironment/);
  assert.match(script, /\.runtime\\release-stack\\data/);
  assert.match(script, /Default API data directory is unusable/);
  assert.match(script, /if \(\$Action -in @\("build", "start"\)\)/);
  assert.match(script, /& \$python -c \$probe \$DatabasePath/);
  assert.doesNotMatch(script, /& \$python -c \$probe -- \$DatabasePath/);
});

test("release lifecycle tracks logs, PID identity, and Pet readiness", () => {
  const script = read("scripts/release-stack.ps1");

  assert.match(script, /Get-CimInstance Win32_Process/);
  assert.match(script, /command_signature/);
  assert.match(script, /Stop-ProcessDescendants/);
  assert.match(script, /MMD_PET_READY_FILE/);
  assert.match(script, /pet_renderer_files/);
  assert.match(script, /rendererWindow=/);
  assert.doesNotMatch(script, /taskkill\s+\/T/i);
});

test("release artifact assertions name all required production entry files", () => {
  const script = read("scripts/release-stack.ps1");

  for (const name of ["BUILD_ID", "dist\\index.html", "dist\\menu.html", "dist\\notification.html", "dist-electron\\main.js"]) {
    assert.match(script, new RegExp(name.replaceAll("\\", "\\\\")));
  }
  assert.equal(existsSync(path.join(projectRoot, "start-release.ps1")), true);
  assert.equal(existsSync(path.join(projectRoot, "start-release.cmd")), true);
});
