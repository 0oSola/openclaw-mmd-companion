import fs from "node:fs";
import path from "node:path";
// 只读探针（不重命名/不改文件）：列出 reze-engine 里含骨骼/蒙皮字样的源文件行，
// 供骨骼主导语义分区的骨骼序取证。reze-engine 路径取本仓库 web/node_modules（process.cwd()
// 为仓库根），可用环境变量 REZE_ENGINE_DIR 覆盖；不硬编码任何 D:/ 绝对路径。
const NM = process.env.REZE_ENGINE_DIR || path.resolve(process.cwd(), "web/node_modules/reze-engine");
function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const fp = path.join(d, e.name);
    if (e.isDirectory()) walk(fp, out);
    else if (/\.(js|mjs|cjs)$/.test(e.name)) out.push(fp);
  }
  return out;
}
for (const fp of walk(NM)) {
  const src = fs.readFileSync(fp, "utf8");
  if (src.includes("bones") && (src.includes("joints") || src.includes("skinning"))) {
    console.log("==", fp);
    src.split("\n").forEach((l, i) => {
      if (/bones|getSkinning|joints/i.test(l) && l.length < 200) console.log(" ", i + 1, l.trim().slice(0, 140));
    });
  }
}
