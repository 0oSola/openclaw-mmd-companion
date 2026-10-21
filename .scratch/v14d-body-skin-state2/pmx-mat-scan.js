const fs = require("fs");
const buf = fs.readFileSync("D:/mmd/克莱妲原皮/GirlsFrontline KoledaDefault.pmx");
const f = buf.slice(9, 17);
const enc = f[0], tIdx = f[3], mIdx = f[4];
let p = 4358213; // texture end
const mCount = buf.readInt32LE(p); p += 4;
function rdStr(pp) { const n = buf.readInt32LE(pp); return { s: buf.toString("utf16le", pp + 4, pp + 4 + n), end: pp + 4 + n }; }
const mats = [];
for (let i = 0; i < mCount; i++) {
  const a = rdStr(p); p = a.end;
  const b = rdStr(p); p = b.end;
  p += 16 + 16 + 12 + 1 + 16 + 4; // diffuse16 specular16 ambient12 flags1 edgeColor16 edgeSize4
  const memoLen = buf.readInt32LE(p);
  const memo = rdStr(p); p = memo.end;
  if (i === 0) console.log("memoLen", memoLen, "sphNext", buf[p]);
  const sph = buf[p]; p += 1;
  p += tIdx; if (sph !== 0) p += tIdx;
  const ti = buf.readInt8(p); p += 1;
  if (ti === 0) p += tIdx; else p += mIdx;
  p += 4 + 4;
  const vc = buf.readInt32LE(p); p += 4;
  mats.push({ name: a.s, vertexCount: vc });
  console.log(i, JSON.stringify(a.s), "vc", vc, "tris", vc / 3, "p", p);
}
