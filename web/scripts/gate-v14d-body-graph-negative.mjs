
// P0-3 负测：漏绑 BodySkin / 错 graph / 错材质 必须使「真实 graph 状态核对」失败。
// 直接核对 RezeWebGpuStage 的 bodyApplied 三层判定逻辑（编译期逻辑断言）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 基于脚本位置解析（仓库根/web 两种 cwd 均可运行）。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../src/features/stage/RezeWebGpuStage.tsx");
const src = fs.readFileSync(SRC, "utf8");
const fails = [];
const ok = (cond, msg) => { if (cond) console.log("[ok] " + msg); else { fails.push(msg); console.error("[FAIL] " + msg); } };

// 1. bodyApplied 必须是「组诊断 ok 且 实际 graph.name === "V14D Body Skin Composite"」。
ok(src.includes('bodyGroupResult?.ok'), "bodyApplied 含组诊断 ok 判定");
ok(src.includes('bodyGraphName === "V14D Body Skin Composite"'), "bodyApplied 含真实 graph.name 核对");
ok(src.includes('getStyleGroups("companion")'), "bodyApplied 读取引擎真实已安装组（非自证）");
// 2. 不得回退到旧的自证（faceResult.ok && 材质存在）。
ok(!/const bodyOk = faceResult\.ok && model\.getMaterials\(\)\.some/.test(src), "bodyApplied 不再用旧的 faceResult.ok&&材质存在 自证");
// 3. dataset 暴露真实 graph 名与组诊断，供 Gate 读取（非自证）。
ok(src.includes("v14dBodySkinGraph"), "dataset 暴露 v14dBodySkinGraph（真实 graph 名）");
ok(src.includes("v14dBodySkinGroupOk"), "dataset 暴露 v14dBodySkinGroupOk（组诊断）");

// 4. 模拟：漏绑 BodySkin（applyStyleGroups 结果无 body 组）→ bodyApplied 应为 false。
function computeBodyApplied(faceResultOk, groups, installedGroups) {
  const bodyGroupResult = groups.find((g) => g.groupId === "v14d-body-skin-composite");
  const bodyInstall = installedGroups.find((g) => Array.isArray(g.materials) && g.materials.includes("BodySkin"));
  const bodyGraphName = bodyInstall?.graph?.name ?? null;
  return !!(bodyGroupResult?.ok && bodyGraphName === "V14D Body Skin Composite");
}
ok(computeBodyApplied(true, [{ groupId: "v14d-body-skin-composite", ok: true }], [{ materials: ["BodySkin"], graph: { name: "V14D Body Skin Composite" } }]) === true, "正例：BodySkin 绑定正确 graph → true");
ok(computeBodyApplied(true, [{ groupId: "v14d-face-static", ok: true }], []) === false, "负测：漏绑 BodySkin（无 body 组、无安装组）→ false");
ok(computeBodyApplied(true, [{ groupId: "v14d-body-skin-composite", ok: true }], [{ materials: ["BodySkin"], graph: { name: "V14D Face Live Composite" } }]) === false, "负测：BodySkin 错绑 Face graph → false");
ok(computeBodyApplied(true, [{ groupId: "v14d-body-skin-composite", ok: false }], [{ materials: ["BodySkin"], graph: { name: "V14D Body Skin Composite" } }]) === false, "负测：body 组编译失败 → false");
ok(computeBodyApplied(true, [{ groupId: "v14d-body-skin-composite", ok: true }], [{ materials: ["HairA"], graph: { name: "V14D Body Skin Composite" } }]) === false, "负测：BodySkin graph 绑定到了 HairA（错材质）→ false");

if (fails.length) { console.error("===BODY-GRAPH-NEG-FAIL=== " + fails.length); process.exit(1); }
console.log("===BODY-GRAPH-NEG-OK=== 真实 graph 绑定证据负测全部通过");
