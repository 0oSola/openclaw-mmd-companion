import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(projectRoot, relativePath), "utf8");

test("portable launcher exposes package/start/status/stop/kill and package-local routing", () => {
  const launcher = read("start-mmd.ps1");

  assert.match(launcher, /ValidateSet\(\"package\", \"start\", \"status\", \"stop\", \"kill\"\)/);
  assert.match(launcher, /manifest\.json/);
  assert.match(launcher, /release-package\.ps1/);
  assert.match(launcher, /release-stack\.ps1/);
  assert.match(launcher, /PackageAction -eq \"start\"/);
  assert.match(launcher, /package_path=/);
  assert.ok(existsSync(path.join(projectRoot, "start-mmd.ps1")));
});

test("portable packager describes a deterministic layout and forbidden runtime data", () => {
  const packager = read("scripts/release-package.ps1");

  assert.match(packager, /package_type = \"mmd-portable-release\"/);
  assert.match(packager, /mmd-portable-\$version-\$timestamp/);
  assert.match(packager, /Compress-Archive/);
  assert.match(packager, /README-release\.md/);
  assert.ok(packager.includes('"web\\.next-codex-release"'));
  assert.ok(packager.includes('"desktop-pet\\dist-electron\\main.js"'));
  assert.match(packager, /api\/data\/ and trace\.db/);
  assert.match(packager, /third_party_asset_notice/);
  assert.match(packager, /latest\.json/);
  assert.match(packager, /start-mmd\.ps1 -Action kill/);
  assert.match(packager, /按 API、Web、Pet 分别复用/);
  assert.match(packager, /不会按端口、进程名或 PID 泛杀/);
});

test("portable package documentation states target-machine prerequisites and strict data-dir behavior", () => {
  const readme = read("README.md");
  const envDoc = read(".env.dev-stack.md");

  assert.match(readme, /便携 Release 包/);
  assert.match(readme, /目标机仍需已有 Python、Node\.js\/npm/);
  assert.match(readme, /显式数据目录无效则严格失败/);
  assert.match(envDoc, /start-mmd\.ps1 -Action package/);
  assert.match(readme, /start-mmd\.ps1 -Action kill/);
  assert.match(envDoc, /start-mmd\.ps1 -Action kill/);
  assert.match(envDoc, /只为缺失或不健康的组件启动新进程/);
});
