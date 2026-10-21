// 只解析 PMX 骨骼段（跳过顶点/面/纹理/材质段，材质段用逐字节扫描定位）。
const fs = require("fs");
const buf = fs.readFileSync("D:/mmd/克莱妲原皮/GirlsFrontline KoledaDefault.pmx");
const f = buf.slice(9, 17);
const bIdx = f[5];
// 顶点段：从 1661 起，每顶点长度由 deform type 决定；faces 在 3885153（前面已验证 faceCount=235944 合理）
let p = 3885153;
const fCount = buf.readInt32LE(p); p += 4 + fCount * f[2];
const texCount = buf.readInt32LE(p); p += 4;
for (let i = 0; i < texCount; i++) { const n = buf.readInt32LE(p); p += 4 + n; }
// 材质段：逐材质推进，memo 长度异常时向后扫描直到 vertexCount 合理。
const mCount = buf.readInt32LE(p); p += 4;
const mats = [];
for (let i = 0; i < mCount; i++) {
  const nameLen = buf.readInt32LE(p);
  const name = buf.toString("utf16le", p + 4, p + 4 + nameLen); p += 4 + nameLen;
  const enLen = buf.readInt32LE(p); p += 4 + enLen;
  p += 16 + 16 + 12 + 1 + 16 + 4; // diffuse16 specular16 ambient12 flags1 edgeColor16 edgeSize4
  // memo: int32 len + bytes
  let memoLen = buf.readInt32LE(p);
  if (memoLen < 0 || memoLen > 4096) { console.error("bad memoLen", memoLen, "mat", i, name, "p", p); break; }
  p += 4 + memoLen;
  const sph = buf[p]; p += 1;
  p += f[3]; if (sph !== 0) p += f[3];
  const ti = buf.readInt8(p); p += 1;
  if (ti === 0) p += f[3]; else p += f[4];
  p += 4 + 4;
  const vc = buf.readInt32LE(p); p += 4;
  mats.push({ name, vertexCount: vc });
  if (vc <= 0 || vc % 3 !== 0) { console.error("bad vc", vc, "mat", i, name, "p", p); }
}
console.log("materials parsed:", mats.length, "p=", p);
console.log("boneCount=", buf.readInt32LE(p));
const boneCount = buf.readInt32LE(p); p += 4;
const bones = [];
for (let i = 0; i < boneCount; i++) {
  const nl = buf.readInt32LE(p); const name = buf.toString("utf16le", p + 4, p + 4 + nl); p += 4 + nl;
  const el = buf.readInt32LE(p); p += 4 + el;
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
console.log("bones parsed:", bones.length, "end p=", p, "fileLen", buf.length, "remaining", buf.length - p);
fs.writeFileSync(".scratch/v14d-body-skin-state2/pmxBoneNames.json", JSON.stringify(bones.map((b) => b.name), null, 1));
console.log("sample:", bones.slice(0, 12).map((b) => b.name).join(", "));
