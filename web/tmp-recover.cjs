const fs = require("fs");
const iconvPaths = ["D:/workspace/MMD project/web/node_modules/iconv-lite"];
let iconv = null;
for (const p of iconvPaths) { try { iconv = require(p); break; } catch {} }
if (!iconv) { console.log("NO_ICONV"); process.exit(0); }
for (const f of ["D:/workspace/MMD project/web/src/features/stage/mmdCompanionRuntime.js",
                 "D:/workspace/MMD project/web/tests/mmd-render-runtime.test.mjs"]) {
  const s = fs.readFileSync(f, "utf8");           // 读回当前（已损坏的）字符串
  const b = iconv.encode(s, "gbk");                // 反编码回 GBK 字节 ≈ 原始 UTF-8 字节
  fs.writeFileSync(f, b);                          // 写回（恢复为无 BOM UTF-8）
  console.log("recovered", f, b.length);
}
