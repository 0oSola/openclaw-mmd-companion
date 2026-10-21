const fs = require("fs");
const buf = fs.readFileSync(process.argv[2] || "D:/mmd/克莱妲原皮/GirlsFrontline KoledaDefault.pmx");
let p = 17;
const f = buf.slice(9, 17);
const enc = f[0], aUV = f[1], vIdx = f[2], bIdx = f[5];
function rdStr() {
  const n = buf.readInt32LE(p); p += 4;
  const s = enc === 0 ? buf.toString("utf16le", p, p + n) : buf.toString("utf8", p, p + n);
  p += n; return s;
}
rdStr(); rdStr(); rdStr(); rdStr();
const vCount = buf.readInt32LE(p); p += 4;
console.error("debug: vCount", vCount, "p now", p, "aUV", aUV);
const boneRefs = [];
let dbgDumped = false;
for (let v = 0; v < vCount; v++) {
  // 本 PMX addUV=1 组，但变形类型字节前有 4 字节填充（总 vertex 长度 51：
  // pos12 normal12 uv8 edge4 addUV8 pad4 deform1 bone2 outline4）。
  // 从字节对齐实测：deform type 位于 +48（0-based 相对 pos）。
  p += 12 + 12 + 8 + 4 + 8 * aUV + 4;
  const type = buf[p]; p += 1;
  if (v < 3 && !dbgDumped) {
    console.error("v", v, "type", type, "p", p - 1, "bytes", Array.from(buf.slice(p - 12, p + 8)).join(","));
    if (v === 2) dbgDumped = true;
  }
  const refs = [];
  const rb = () => { let x; if (bIdx === 1) x = buf.readInt8(p); else if (bIdx === 2) x = buf.readInt16LE(p); else x = buf.readInt32LE(p); p += bIdx; return x; };
  if (type === 0) { const a = rb(); refs.push([a, 1]); if (v < 3) console.error("  type0 bone", a, "p now", p); }
  else if (type === 1) { const a = rb(), b = rb(); const w = buf.readFloatLE(p); p += 4; refs.push([a, w], [b, 1 - w]); }
  else if (type === 2 || type === 4) { const idx = [rb(), rb(), rb(), rb()]; for (let k = 0; k < 4; k++) refs.push([idx[k], buf.readFloatLE(p + 4 * k)]); p += 16; }
  else if (type === 3) { const a = rb(), b = rb(); const w = buf.readFloatLE(p); p += 4; p += 12; refs.push([a, w], [b, 1 - w]); }
  else { console.error("type", type, "vert", v, "at", p - 1, "bytes", Array.from(buf.slice(p - 1, p + 16)).join(",")); process.exit(1); }
  boneRefs.push(refs);
  p += 4;
}
console.error("verts done p=", p, "faceCount=", buf.readInt32LE(p));
const fCount = buf.readInt32LE(p); p += 4;
const indices = [];
for (let i = 0; i < fCount; i++) { let x; if (vIdx === 1) x = buf.readUInt8(p); else if (vIdx === 2) x = buf.readUInt16LE(p); else x = buf.readInt32LE(p); p += vIdx; indices.push(x); }
console.error("faces done p=", p, "texCount=", buf.readInt32LE(p));
const texCount = buf.readInt32LE(p); p += 4;
for (let i = 0; i < texCount; i++) { const s = rdStr(); if (i < 3) console.error("tex", i, s, "p", p); }
console.error("textures done p=", p, "matCount=", buf.readInt32LE(p));
const mCount = buf.readInt32LE(p); p += 4;
const mats = [];
for (let i = 0; i < mCount; i++) {
  const name = rdStr(); rdStr();
  p += 16 + 12 + 4 + 12 + 1 + 16 + 4;
  const memo = rdStr();
  const sph = buf[p]; p += 1;
  p += f[3]; if (sph !== 0) p += f[3];
  const ti = buf.readInt8(p); p += 1;
  if (ti === 0) p += f[3]; else p += f[4];
  p += 4 + 4;
  const vc = buf.readInt32LE(p); p += 4;
  mats.push({ name, vertexCount: vc });
  if (i < 3 || i > mCount - 2) console.error("mat", i, name, "vc", vc, "p", p);
}
console.log("materials:", mats.map((m, i) => i + ":" + m.name + "(" + (m.vertexCount / 3) + ")").join(" | "));
const boneCount = buf.readInt32LE(p); p += 4;
const bones = [];
for (let i = 0; i < boneCount; i++) {
  const name = rdStr(); rdStr();
  p += 12 + 4;
  const fl = buf.readUInt16LE(p); p += 2;
  if ((fl & 0x0001) !== 0) p += bIdx; else p += 12;
  if ((fl & 0x0100) !== 0 || (fl & 0x0200) !== 0) p += bIdx + 4;
  if ((fl & 0x0400) !== 0) p += 12;
  if ((fl & 0x2000) !== 0) p += 4;
  if ((fl & 0x0020) !== 0) p += bIdx;
  if ((fl & 0x0800) !== 0) { p += bIdx; p += 12; p += 24; p += 4; bones.push({ name, ik: true }); continue; }
  bones.push({ name });
}
console.log("bones", boneCount, "end p=", p, "len", buf.length, "diff", buf.length - p);
const bi = mats.findIndex((m) => m.name === "BodySkin");
const first = mats.slice(0, bi).reduce((a, m) => a + m.vertexCount, 0);
const cnt = mats[bi].vertexCount;
const dom = {}; const vertSet = new Set();
for (let t = first; t < first + cnt; t++) vertSet.add(indices[t]);
for (const v of vertSet) {
  const refs = boneRefs[v]; let best = -1, bw = -1;
  for (const [b, w] of refs) { if (w > bw) { bw = w; best = b; } }
  const bn = bones[best] ? bones[best].name : ("idx" + best);
  dom[bn] = (dom[bn] || 0) + 1;
}
const sorted = Object.entries(dom).sort((a, b) => b[1] - a[1]);
console.log("BodySkin unique verts:", vertSet.size, "tris:", cnt / 3);
for (const [n, c] of sorted) console.log("  " + JSON.stringify(n) + ": " + c);
fs.writeFileSync(".scratch/boneNames.json", JSON.stringify(bones.map((b) => b.name), null, 1));
