/**
 * Stage 2C-M1 修正轮：HairA/HairB 分区取证的纯函数核心（node --test 可直接驱动）。
 *
 * 权威目标口径（非目测）：Blender CLI 取证（forensic-v14d-hair-state.py →
 * hair-forensic.json）确认 PROTO_GF2_HairA/HairB BaseColor = hair_d 纹理（sRGB）经
 * PROTO_HairTint（MIX_RGB MULTIPLY Factor=1）固定银白紫乘色 [0.84, 0.85, 0.96]。
 * 引擎侧 WGSL helper 对「sRGB 绑定采样后的线性 base」做同一乘法。因此可重复的
 * 权威参考公式（线性空间逐纹素）：
 *
 *   targetLinear(uv) = srgbToLinear(hair_d(uv)) × [0.84, 0.85, 0.96]
 *
 * 颜色空间对齐：舞台画布是 sRGB 显示字节，把参考线性色经 linearToSrgb 转回显示
 * 字节后与画布逐像素比较；绝对亮度差来自引擎灯光/Toon 乘性显示链（未迁移部分），
 * 收敛判据用「误差较 original 显著下降 + 绝对上限」，不用绝对零误差冒充逐像素对齐。
 */

import { V14D_HAIR_TINT } from "./v14dAuthority.js";

/** 权威头发 tint 的 Node 侧兼容导出；实际值来自共享纯 JS 权威模块。 */
export const V14D_HAIR_TINT_LINEAR = V14D_HAIR_TINT;

export function srgbByteToLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function linearToSrgbByte(l) {
  const v = Math.max(0, Math.min(1, l));
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/** 权威 BaseColor 目标（显示字节）：hair_d sRGB 字节 → 线性 × tint → sRGB 字节。 */
export function v14dHairTargetDisplay(rgb) {
  return [
    linearToSrgbByte(srgbByteToLinear(rgb[0]) * V14D_HAIR_TINT_LINEAR[0]),
    linearToSrgbByte(srgbByteToLinear(rgb[1]) * V14D_HAIR_TINT_LINEAR[1]),
    linearToSrgbByte(srgbByteToLinear(rgb[2]) * V14D_HAIR_TINT_LINEAR[2]),
  ];
}

/**
 * 对已经解码为线性 RGB 的 hair_d 纹理做 WebGPU 语义的双线性采样。
 * 纹理对象形状为 { width, height, linear }，linear 按行优先保存 RGB。
 * UV 采用 PMX/引擎同一坐标方向；越界按 repeat 后在纹理边界取样。
 */
export function sampleHairTextureLinear(texture, u, v) {
  if (!texture || !Number.isInteger(texture.width) || !Number.isInteger(texture.height)
    || texture.width <= 0 || texture.height <= 0 || !texture.linear) {
    throw new Error("invalid hair texture sampler");
  }
  const wrap = (value) => {
    const w = value - Math.floor(value);
    return w < 0 ? w + 1 : w;
  };
  const x = wrap(u) * texture.width - 0.5;
  const y = wrap(v) * texture.height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const repeatIndex = (value, size) => {
    const remainder = value % size;
    return remainder < 0 ? remainder + size : remainder;
  };
  const at = (px, py, channel) => texture.linear[(repeatIndex(py, texture.height) * texture.width + repeatIndex(px, texture.width)) * 3 + channel];
  return [0, 1, 2].map((channel) =>
    at(x0, y0, channel) * (1 - fx) * (1 - fy)
    + at(x0 + 1, y0, channel) * fx * (1 - fy)
    + at(x0, y0 + 1, channel) * (1 - fx) * fy
    + at(x0 + 1, y0 + 1, channel) * fx * fy,
  );
}

/** 权威 V14D 头发目标：同一 UV 的线性 hair_d 样本 × authority tint，再转显示字节。 */
export function v14dHairTargetDisplayFromLinear(linearRgb) {
  return [
    linearToSrgbByte(linearRgb[0] * V14D_HAIR_TINT_LINEAR[0]),
    linearToSrgbByte(linearRgb[1] * V14D_HAIR_TINT_LINEAR[1]),
    linearToSrgbByte(linearRgb[2] * V14D_HAIR_TINT_LINEAR[2]),
  ];
}

/**
 * 计算屏幕像素 UV 在该局部三角形 UV 中的重心坐标。
 * triangleUvs 为 [u0,v0,u1,v1,u2,v2]，返回 null 表示退化三角形。
 */
export function barycentricForTriangleUv(u, v, triangleUvs) {
  if (!triangleUvs || triangleUvs.length < 6) return null;
  const ax = triangleUvs[0], ay = triangleUvs[1];
  const bx = triangleUvs[2], by = triangleUvs[3];
  const cx = triangleUvs[4], cy = triangleUvs[5];
  const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (!Number.isFinite(den) || Math.abs(den) < 1e-12) return null;
  const w0 = ((by - cy) * (u - cx) + (cx - bx) * (v - cy)) / den;
  const w1 = ((cy - ay) * (u - cx) + (ax - cx) * (v - cy)) / den;
  return [w0, w1, 1 - w0 - w1];
}

export function barycentricInside(values, epsilon = 1e-4) {
  return Array.isArray(values) && values.length === 3
    && values.every((value) => Number.isFinite(value) && value >= -epsilon && value <= 1 + epsilon);
}

/**
 * 解析 PMX 二进制，抽出 HairA/HairB 两个材质区间顶点的 UV，统计单位格归属。
 * 只读、不修改 PMX。header/权重布局与 docs/handoff/evidence/pmx_audit.py 同口径
 * （globals[0..7]=encoding/addUV/vertex/texture/material/bone/morph/rigid index size；
 * 顶点 = pos12+normal12+uv8+addUV*16+weight+edgeScale4；SDEF=2骨+w4+C/R0/R1 36）。
 */
export function buildHairUvGridFromPmx(pmx, ranges, gridU = 48, gridV = 48) {
  const view = new DataView(pmx, pmx.byteOffset || 0, pmx.byteLength);
  let off = 0;
  const u32 = () => { const v = view.getUint32(off, true); off += 4; return v; };
  const u8 = () => { const v = view.getUint8(off); off += 1; return v; };
  const f32 = () => { const v = view.getFloat32(off, true); off += 4; return v; };
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "PMX ") throw new Error("not a PMX file: " + magic);
  off += 4; // magic
  off += 4; // version f32
  const headerSize = u8();
  const cfg = [];
  for (let i = 0; i < headerSize; i++) cfg.push(u8());
  const textEncoding = cfg[0];
  const additionalUv = cfg[1];
  const vertexIndexSize = cfg[2];
  const boneIndexSize = cfg[5];
  if (vertexIndexSize !== 2) throw new Error("vertex_index_size != 2 (got " + vertexIndexSize + ")");
  off = 4 + 4 + 1 + headerSize;
  // PMX text：i32 字节长度 + 原始字节（encoding 0=utf-16le，1=utf-8）。长度即字节数。
  for (let i = 0; i < 4; i++) {
    const byteLen = u32();
    off += byteLen;
  }
  const vertexCount = u32();
  const stride = 12 + 12 + 8 + additionalUv * 16;
  const uvs = new Float32Array(vertexCount * 2);
  const u16 = () => { const v = view.getUint16(off, true); off += 2; return v; };
  const boneIndex = () => {
    let v = 0;
    if (boneIndexSize === 1) v = view.getInt8(off);
    else if (boneIndexSize === 2) v = view.getInt16(off, true);
    else v = view.getInt32(off, true);
    off += boneIndexSize;
    return v;
  };
  for (let i = 0; i < vertexCount; i++) {
    const vStart = off;
    const uvU = view.getFloat32(off + 24, true);
    const uvV = view.getFloat32(off + 28, true);
    uvs[i * 2] = uvU;
    uvs[i * 2 + 1] = uvV;
    off += stride; // pos+normal+uv+additional uv
    const weightType = u8();
    if (weightType === 0) { boneIndex(); }
    else if (weightType === 1) { boneIndex(); boneIndex(); off += 4; }
    else if (weightType === 2) { boneIndex(); boneIndex(); boneIndex(); boneIndex(); off += 16; }
    else if (weightType === 3) { boneIndex(); boneIndex(); off += 4 + 12 + 12 + 12; } // SDEF: 2骨+w4+C/R0/R1
    else { boneIndex(); boneIndex(); boneIndex(); boneIndex(); off += 16; } // QDEF 同 BDEF4
    off += 4; // edge scale
  }
  const faceIndexCount = u32();
  // 面索引区起点（绝对偏移）：vertex_index_size=2 → 每索引 2 字节，支持随机访问。
  const faceIndexBase = off;
  const readIndex = (i) => view.getUint16(faceIndexBase + i * 2, true);
  const hairA = new Uint32Array(gridU * gridV);
  const hairB = new Uint32Array(gridU * gridV);
  const stamp = (range, target) => {
    if (range.startIndex + range.indexCount > faceIndexCount) {
      throw new Error(range.name + " index range out of bounds");
    }
    for (let i = range.startIndex; i < range.startIndex + range.indexCount; i++) {
      const vi = readIndex(i);
      const u = Math.max(0, Math.min(gridU - 1, Math.floor(uvs[vi * 2] * gridU)));
      // PMX uv.v 向下为正；图像行 y 向下为正，二者同向（引擎按 flipY 绑定纹理）。
      const vv = Math.max(0, Math.min(gridV - 1, Math.floor(uvs[vi * 2 + 1] * gridV)));
      target[vv * gridU + u] += 1;
    }
  };
  const ordered = [
    { range: ranges.hairA, target: hairA },
    { range: ranges.hairB, target: hairB },
  ].sort((x, y) => x.range.startIndex - y.range.startIndex);
  for (const { range, target } of ordered) stamp(range, target);
  return { gridU, gridV, hairA, hairB };
}

/**
 * 纹理像素坐标 → 单位归属（"hairA" | "hairB" | null）。
 * 单位格内两槽顶点数取多数；格内无任一槽顶点返回 null（非头发区）。
 */
export function classifyHairPixel(grid, px, py, texW, texH) {
  const gu = Math.max(0, Math.min(grid.gridU - 1, Math.floor((px / texW) * grid.gridU)));
  const gv = Math.max(0, Math.min(grid.gridV - 1, Math.floor((py / texH) * grid.gridV)));
  const unit = gv * grid.gridU + gu;
  const a = grid.hairA[unit];
  const b = grid.hairB[unit];
  if (a === 0 && b === 0) return null;
  return a >= b ? "hairA" : "hairB";
}
