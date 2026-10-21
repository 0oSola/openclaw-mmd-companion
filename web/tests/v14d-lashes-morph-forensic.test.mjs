import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FORENSIC_SCRIPT = path.join(WEB_ROOT, "scripts", "forensic-v14d-lashes-morph-offsets.py");
const RUNTIME_SCRIPT = path.join(WEB_ROOT, "scripts", "repro-v14d-lashes-morph-offsets.mjs");
const PMX = process.env.V14D_TEST_PMX || "D:\\mmd\\克莱妲原皮\\GirlsFrontline KoledaDefault.pmx";

function runUvPython(args) {
  return spawnSync("uv", ["run", "python", FORENSIC_SCRIPT, ...args], {
    cwd: WEB_ROOT,
    encoding: "utf8",
  });
}

function extractCsrRows(source) {
  const match = source.match(/const csrRows = \(computeData, morphIndex\) => \{[\s\S]*?^    \};/m);
  assert.ok(match, "runtime probe must keep a named CSR reconstruction function");
  return new Function(`${match[0]}; return csrRows;`)();
}

test("取证数值口径：引用数、严格非零数、近零分桶和材质交集彼此分离", () => {
  const result = runUvPython(["--self-test"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /LASHES-MORPH-SELF-TEST-OK/);
  const jsonLine = result.stdout.trim().split(/\r?\n/).find((line) => line.startsWith("{"));
  const report = JSON.parse(jsonLine);
  assert.deepEqual(report.offsetStats.zeroNearZeroBuckets, {
    exactZero: 1,
    "positiveUpTo1e-8": 1,
    "above1e-8UpTo1e-6": 1,
    "above1e-6UpTo1e-4": 1,
    "above1e-4": 2,
  });
  assert.equal(report.offsetStats.totalOffsetReferences, 6);
  assert.equal(report.offsetStats.strictNonZeroVertexCount, 4);
  assert.equal(report.offsetStats.duplicateReferenceCount, 1);
  assert.equal(report.materialIntersections.Brows.strictNonZeroVertexCount, 2);
  assert.equal(report.materialIntersections.Lashes.strictNonZeroVertexCount, 4);
  assert.equal(report.materialIntersections.Lashes.strictNonZeroOffsetCount, 5);
});

test("CSR 取证：按 rowStart 行边界恢复真实顶点索引，不产生 vertex=null", () => {
  const source = readFileSync(RUNTIME_SCRIPT, "utf8");
  const csrRows = extractCsrRows(source);
  const rows = csrRows({
    vertexCount: 4,
    rowStart: [0, 2, 2, 3, 3],
    colMorph: [7, 3, 7],
    colOffset: [-1, 0, 0, 99, 99, 99, 2, 3, 4],
  }, 7);
  assert.deepEqual(rows, [
    { vertex: 0, offset: [-1, 0, 0] },
    { vertex: 2, offset: [2, 3, 4] },
  ]);
  assert.ok(rows.every((row) => Number.isInteger(row.vertex)));
  assert.doesNotMatch(source, /vertex:\s*null/);
});

test("探针隔离：默认外观锁控制证据和 probe-only 权重覆盖必须落在取证脚本", () => {
  const runtimeSource = readFileSync(RUNTIME_SCRIPT, "utf8");
  assert.match(runtimeSource, /defaultAppearanceLockControl/);
  assert.match(runtimeSource, /confirmsProductionDefaultAppearanceLock/);
  assert.match(runtimeSource, /updateWithProductionAppearancePolicy/);
  assert.match(runtimeSource, /defaultAppearanceLockBypassedByProbe/);
  assert.match(runtimeSource, /model\.update = \(\.\.\.args\) =>/);
});

test("当前权威 PMX：完整消费，506 只来自 Lashes 严格非零顶点而非引用数", (t) => {
  if (!existsSync(PMX)) {
    t.skip("权威 PMX 不在本机");
    return;
  }
  const out = path.join(WEB_ROOT, ".scratch", "v14d-brows-lashes", `pmx-forensic-regression-${process.pid}.json`);
  const result = runUvPython(["--pmx-only", "--pmx", PMX, "--out", out]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(readFileSync(out, "utf8"));
  const bytes = statSync(PMX).size;
  assert.equal(report.pmx.readerOffset, bytes);
  assert.equal(report.pmx.trailingBytes, 0);
  assert.deepEqual(report.sourceRoutes, ["pmx-binary-direct", "not-run"]);
  assert.equal(report.productionDrawIndexSets.pmxSource.Brows.firstIndex, 9330);
  assert.equal(report.productionDrawIndexSets.pmxSource.Brows.count, 312);
  assert.equal(report.productionDrawIndexSets.pmxSource.Brows.uniqueVertexCount, 82);
  assert.equal(report.productionDrawIndexSets.pmxSource.Lashes.firstIndex, 9642);
  assert.equal(report.productionDrawIndexSets.pmxSource.Lashes.count, 1866);
  assert.equal(report.productionDrawIndexSets.pmxSource.Lashes.uniqueVertexCount, 506);
  const byName = Object.fromEntries(report.morphs.map((morph) => [morph.name, morph]));
  assert.deepEqual(
    Object.fromEntries(Object.entries(byName).map(([name, morph]) => [name, {
      type: morph.type,
      references: morph.offsetStats.pmx.totalOffsetReferences,
      strictNonZero: morph.offsetStats.pmx.strictNonZeroVertexCount,
      browsVerts: morph.browsVerts,
      lashesVerts: morph.lashesVerts,
      pmxSource: morph.sourceRoute.pmx,
      lashesIntersection: report.morphDrawSetProof[name].Lashes.referenceDrawIntersectionCount,
      lashesOnly: report.morphDrawSetProof[name].Lashes.referenceOnlyCount,
      lashesDrawOnly: report.morphDrawSetProof[name].Lashes.drawOnlyCount,
    }])),
    {
      "まばたき": { type: 1, references: 846, strictNonZero: 846, browsVerts: 0, lashesVerts: 506, pmxSource: "pmx-binary-direct", lashesIntersection: 506, lashesOnly: 340, lashesDrawOnly: 0 },
      "笑い": { type: 1, references: 862, strictNonZero: 862, browsVerts: 0, lashesVerts: 506, pmxSource: "pmx-binary-direct", lashesIntersection: 506, lashesOnly: 356, lashesDrawOnly: 0 },
    },
  );
});

test("当前 runtime 报告：H6 锁干扰已确认，隔离后首个生产边界未丢失", (t) => {
  const reportPath = path.join(WEB_ROOT, ".scratch", "v14d-brows-lashes", "morph-offset-runtime-forensic.json");
  if (!existsSync(reportPath)) {
    t.skip("当前机没有 runtime 取证报告");
    return;
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(report.mappingProof.consistent, true);
  assert.equal(report.runtime.clipIsolation.defaultAppearanceLockControl.confirmsProductionDefaultAppearanceLock, true);
  assert.equal(report.runtime.clipIsolation.defaultAppearanceLockBypassedByProbe, true);
  assert.equal(report.firstLostBoundary.status, "not-lost-after-probe-isolation");
  assert.equal(report.hypotheses.H6_productionDefaultAppearanceLockInterference, "confirmed");
  assert.equal(report.verdict.blinkObservedMoved, true);
  assert.equal(report.verdict.expressionObservedMoved, true);
});
