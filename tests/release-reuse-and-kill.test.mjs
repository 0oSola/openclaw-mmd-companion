import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(projectRoot, relativePath), "utf8");
const stackScript = () => read("scripts/release-stack.ps1");
const launcher = () => read("start-mmd.ps1");

test("release start exposes kill and reconciles API/Web/Pet independently", () => {
  const script = stackScript();
  const entry = launcher();

  assert.match(script, /ValidateSet\("build", "start", "stop", "status", "kill"\)/);
  assert.match(entry, /ValidateSet\("package", "start", "status", "stop", "kill"\)/);
  assert.match(script, /function Get-ReleaseComponentCandidates/);
  assert.match(script, /function Test-ProcessBelongsToCurrentPackage/);
  assert.match(script, /component_action\s*=\s*"reused"/);
  assert.match(script, /只启动缺失组件|only the missing|missing component/i);
  assert.doesNotMatch(script, /Assert-NoActiveReleaseStack\s*\r?\n/);
});
test("state loss can adopt only current-package processes and preserve conflicts", () => {
  const script = stackScript();

  assert.match(script, /state file.*missing|状态文件.*缺失/i);
  assert.match(script, /command_signature/);
  assert.match(script, /identity_marker/);
  assert.match(script, /not owned by current release package|不属于当前 Release 包/i);
  assert.match(script, /--app-dir/);
  assert.match(script, /Get-ListeningProcessId/);
});

test("kill is controlled by ownership, process tree, and current package scope", () => {
  const script = stackScript();

  assert.match(script, /function Kill-ReleaseStack/);
  assert.match(script, /Stop-TrackedProcessTree/);
  assert.match(script, /Test-ProcessBelongsToCurrentPackage/);
  assert.match(script, /current package|当前.*包/i);
  assert.match(script, /Remove-Item -LiteralPath \$script:StateFile/);
  assert.doesNotMatch(script, /taskkill\s+\/T/i);
  assert.doesNotMatch(script, /Stop-Process\s+.*Get-ListeningProcessId/i);
});
