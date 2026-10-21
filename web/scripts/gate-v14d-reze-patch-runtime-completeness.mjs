// Stage 2B-P1 P0 回归：binding(5) 在普通材质路径必须始终是有效 GPUTextureView。
// 读取实际 reze-engine src/dist 的 createMaterialBindGroup 方法并以最小 GPU stub 执行；
// 修复前当前 baseEntries 含 undefined binding(5) 时会变红，修复后 src/dist 均通过。
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ENGINE_SRC = path.join(root, "web", "node_modules", "reze-engine", "src", "engine.ts");
const ENGINE_DIST = path.join(root, "web", "node_modules", "reze-engine", "dist", "engine.js");
const fails = [];
let assertCount = 0;
const ok = (condition, message) => {
  assertCount += 1;
  if (condition) console.log("[ok] " + message);
  else { fails.push(message); console.error("[FAIL] " + message); }
};

function extractMethod(source, marker, endMarker) {
  const start = source.indexOf(marker);
  const end = source.indexOf(endMarker, start);
  return start >= 0 && end > start ? source.slice(start, end) : "";
}

function compileDistMethod(source) {
  const method = extractMethod(source, "createMaterialBindGroup(label, baseEntries, styleBuffer, maskView) {", "\n    setMaterialVisible");
  if (!method) return null;
  try { return new Function("return ({" + method + "}).createMaterialBindGroup")(); }
  catch (error) {
    console.error("[compile-fail] " + String(error));
    return null;
  }
}

function runCases(label, method) {
  ok(typeof method === "function", label + " 可执行实际 createMaterialBindGroup");
  if (typeof method !== "function") return;
  const fallbackView = { kind: "fallback-view" };
  const object = {
    device: { createBindGroup: (descriptor) => descriptor },
    mainPerMaterialBindGroupLayout: { kind: "layout" },
    fallbackMaterialTexture: { createView: () => fallbackView },
  };
  const cases = [
    {
      name: "普通/default：预留 binding(5) 但无 aux",
      baseEntries: [{ binding: 0, resource: { kind: "diffuse" } }, { binding: 5, resource: undefined }],
      maskView: undefined,
      expected: fallbackView,
    },
    {
      name: "Face/aux：binding(5) 使用真实 mask",
      baseEntries: [{ binding: 0, resource: { kind: "diffuse" } }, { binding: 5, resource: { kind: "mask-view" } }],
      maskView: { kind: "mask-view-argument" },
      expected: { kind: "mask-view" },
    },
    {
      name: "旧 baseEntries：未预留 binding(5)",
      baseEntries: [{ binding: 0, resource: { kind: "diffuse" } }],
      maskView: undefined,
      expected: fallbackView,
    },
  ];
  for (const test of cases) {
    const group = method.call(object, test.name, test.baseEntries, { kind: "style-buffer" }, test.maskView);
    const binding5 = group.entries.filter((entry) => entry.binding === 5);
    const resource = binding5[0]?.resource;
    ok(binding5.length === 1, label + " " + test.name + " 恰好一个 binding(5)");
    ok(resource !== undefined && resource !== null, label + " " + test.name + " resource 非 undefined/null");
    ok(resource === test.expected || (resource !== undefined && resource !== null && resource.kind === test.expected.kind), label + " " + test.name + " resource 语义正确");
  }
}

const src = fs.readFileSync(ENGINE_SRC, "utf8");
const dist = fs.readFileSync(ENGINE_DIST, "utf8");
const srcMethod = extractMethod(src, "private createMaterialBindGroup(", "\n  setMaterialVisible");
ok(srcMethod.length > 0, "src/engine.ts 存在实际 createMaterialBindGroup 方法");
ok(srcMethod.includes("const hasBinding5 = baseEntries.some((e) => e.binding === 5)"), "src/engine.ts 包含 binding(5) resource 归一化门控");
ok(srcMethod.includes("maskView ?? this.fallbackMaterialTexture.createView()"), "src/engine.ts fallback 使用 fallbackMaterialTexture view");
runCases("dist/engine.js", compileDistMethod(dist));

if (fails.length) {
  console.error("===PATCH-RUNTIME-COMPLETENESS-FAIL=== 断言数=" + assertCount + "\n" + fails.join("\n"));
  process.exit(1);
}
console.log("===PATCH-RUNTIME-COMPLETENESS-OK=== binding(5) src/dist 普通/default fallback 与 aux mask 均有效，断言数=" + assertCount);
