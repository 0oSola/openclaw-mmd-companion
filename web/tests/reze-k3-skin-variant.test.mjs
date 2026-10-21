import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateRezeK3V1Eligibility,
  findV14dState2MaskFile,
  isRezeK3V1Eligible,
  readRezeK3SkinVariant,
  rezeK3SkinVariantStorageKey,
  resolveRezeK3SkinVariantActivation,
  resolveRezeK3SkinVariant,
  writeRezeK3SkinVariant,
} from "../src/features/stage/rezeSkinVariantPreference.js";

// 权威常量与生产同源（v14dAuthority.js 单一事实源），消除测试内字面量复制。
import {
  V14D_AUTHORITY_PMX_FILE_NAME as AUTHORITY_PMX,
  V14D_STATE2_MASK_FILE_NAME as MASK_NAME,
} from "../src/features/stage/v14dAuthority.js";

function fakeFile(name, rel) {
  const f = { name };
  if (rel) f.webkitRelativePath = rel;
  return f;
}

function fakeImport(pmxName, files) {
  return { pmxFile: fakeFile(pmxName), files };
}

test("资格谓词：权威 PMX + 完整 State2 mask 才可启用 V1", () => {
  const ok = evaluateRezeK3V1Eligibility(
    fakeImport(AUTHORITY_PMX, [fakeFile("body_d.png"), fakeFile(MASK_NAME, "Textures/" + MASK_NAME)]),
  );
  assert.equal(ok.eligible, true);
  assert.equal(ok.hasAuthorityPmx, true);
  assert.equal(ok.hasState2Mask, true);
  assert.ok(ok.state2Mask);
});

test("资格负测：权威 PMX 但缺 mask 不可启用", () => {
  const r = evaluateRezeK3V1Eligibility(fakeImport(AUTHORITY_PMX, [fakeFile("body_d.png")]));
  assert.equal(r.eligible, false);
  assert.equal(r.hasAuthorityPmx, true);
  assert.equal(r.hasState2Mask, false);
});

test("资格负测：非克莱妲 + 同名 mask 不可启用", () => {
  const r = evaluateRezeK3V1Eligibility(fakeImport("Ayaka.pmx", [fakeFile(MASK_NAME, "Textures/" + MASK_NAME)]));
  assert.equal(r.eligible, false);
  assert.equal(r.hasAuthorityPmx, false);
});

test("资格负测：有 mask 但无 PMX / 空导入不可启用", () => {
  assert.equal(evaluateRezeK3V1Eligibility(null).eligible, false);
  assert.equal(evaluateRezeK3V1Eligibility(undefined).eligible, false);
  assert.equal(evaluateRezeK3V1Eligibility({ pmxFile: null, files: [] }).eligible, false);
});

test("mask 定位支持 webkitRelativePath 与纯文件名", () => {
  assert.ok(findV14dState2MaskFile([fakeFile("x.png", "Textures/v14d-01234-face-shadow-state-2.png")]));
  assert.ok(findV14dState2MaskFile([fakeFile(MASK_NAME)]));
  assert.equal(findV14dState2MaskFile([fakeFile("other.png")]), null);
  assert.equal(findV14dState2MaskFile(null), null);
});

test("effective 变体：资格不满足时持久化 v1 安全回退 original", () => {
  const good = fakeImport(AUTHORITY_PMX, [fakeFile(MASK_NAME)]);
  const bad = fakeImport(AUTHORITY_PMX, []);
  assert.equal(resolveRezeK3SkinVariant("v1", good), "v1");
  assert.equal(resolveRezeK3SkinVariant("v1", bad), "original");
  assert.equal(resolveRezeK3SkinVariant("v1", null), "original");
  assert.equal(resolveRezeK3SkinVariant("original", good), "original");
});

// P0-1 持久化水合回归：预置 v1 → 读取恢复；original → 不残留；键按用户+模型隔离。
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    has: (k) => map.has(k),
  };
}

test("持久化：预置 v1 刷新后恢复为 v1", () => {
  const s = fakeStorage();
  const key = rezeK3SkinVariantStorageKey("u1", "models/koleda.pmx");
  s.setItem(key, "v1");
  assert.equal(readRezeK3SkinVariant(s, key), "v1");
});

test("持久化：original 写入后清除键，不残留", () => {
  const s = fakeStorage();
  const key = rezeK3SkinVariantStorageKey("u1", "models/koleda.pmx");
  writeRezeK3SkinVariant(s, key, "v1");
  assert.equal(s.has(key), true);
  writeRezeK3SkinVariant(s, key, "original");
  assert.equal(s.has(key), false);
  assert.equal(readRezeK3SkinVariant(s, key), "original");
});

test("持久化：存储键按 用户+模型+管线 三维隔离", () => {
  const a = rezeK3SkinVariantStorageKey("u1", "models/koleda.pmx");
  const b = rezeK3SkinVariantStorageKey("u1", "models/ayaka.pmx");
  const c = rezeK3SkinVariantStorageKey("u2", "models/koleda.pmx");
  assert.ok(a.includes(":reze-k3:"));
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  // 切换模型时读新键不受旧键影响（隔离）。
  const s = fakeStorage();
  s.setItem(a, "v1");
  assert.equal(readRezeK3SkinVariant(s, b), "original");
});

test("持久化：非法值回退 original", () => {
  const s = fakeStorage();
  const key = rezeK3SkinVariantStorageKey("u1", "m.pmx");
  s.setItem(key, "garbage");
  assert.equal(readRezeK3SkinVariant(s, key), "original");
});

// 主会话第二次验收第 4 项：权威 PMX+mask 时，identifier 只影响诊断，不影响激活。
// 直接调用 boot 使用的生产契约函数，禁止用 void identifier 或源码字符串匹配冒充行为测试。
test("资格单一权威：不同 identifier 不改变 active/effective，只改变诊断", () => {
  const good = fakeImport(AUTHORITY_PMX, [fakeFile(MASK_NAME)]);
  const eligibility = evaluateRezeK3V1Eligibility(good);
  assert.equal(eligibility.eligible, true);
  const matching = resolveRezeK3SkinVariantActivation("v1", eligibility, "Koleda.pmx");
  const arbitrary = resolveRezeK3SkinVariantActivation("v1", eligibility, "Ayaka.pmx");
  const absent = resolveRezeK3SkinVariantActivation("v1", eligibility, []);

  assert.deepEqual(
    [matching, arbitrary, absent].map(({ active, effective }) => ({ active, effective })),
    [
      { active: true, effective: "v1" },
      { active: true, effective: "v1" },
      { active: true, effective: "v1" },
    ],
  );
  assert.equal(matching.diagnosticIdentifierMismatch, false);
  assert.equal(arbitrary.diagnosticIdentifierMismatch, true);
  assert.equal(absent.diagnosticIdentifierMismatch, true);

  const original = resolveRezeK3SkinVariantActivation("original", eligibility, ["Ayaka.pmx"]);
  assert.deepEqual(original, { effective: "original", active: false, diagnosticIdentifierMismatch: false });
});

test("资格单一权威：非克莱妲时三处一致回退 original", () => {
  const bad = fakeImport("Ayaka.pmx", [fakeFile(MASK_NAME)]);
  assert.equal(evaluateRezeK3V1Eligibility(bad).eligible, false);
  assert.equal(resolveRezeK3SkinVariant("v1", bad), "original");
});
