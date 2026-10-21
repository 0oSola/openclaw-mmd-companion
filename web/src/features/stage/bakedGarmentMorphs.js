import { BufferAttribute, DynamicDrawUsage } from "three";

// 衣发补偿只涉及稀疏顶点。先合并其位移，避免GPU逐顶点遍历528张形态键纹理。
export function prepareBakedGarmentMorphs(mesh) {
  const geometry = mesh?.geometry;
  const targets = geometry?.morphAttributes?.position;
  if (!targets?.length || !Array.isArray(mesh?.morphTargetInfluences)) return null;
  const dictionary = mesh?.morphTargetDictionary || {};
  const garment = Object.entries(dictionary).filter(([name]) => /^V11(SC|SL|SR)\d{3}[PN]$/.test(name));
  if (!garment.length || geometry.morphTargetsRelative || Object.keys(geometry.morphAttributes).length !== 1) return null;
  const first = Math.min(...garment.map(([, index]) => index));
  if (!first || garment.length !== targets.length - first) return null;
  const indices = new Set(garment.map(([, index]) => index));
  if (targets.some((_, i) => i >= first && !indices.has(i))) return null;
  const base = geometry.attributes.position.array.slice();
  const sparse = targets.slice(first).map((attribute) => {
    const ids = [], values = [];
    for (let i = 0; i < base.length; i += 1) {
      const delta = attribute.array[i] - base[i];
      if (delta !== 0) { ids.push(i); values.push(delta); }
    }
    return { ids: new Uint32Array(ids), values: new Float64Array(values) };
  });
  geometry.morphAttributes.position = targets.slice(0, first).map((attribute) => {
    const result = new Float32Array(base.length);
    for (let i = 0; i < base.length; i += 1) result[i] = attribute.array[i] - base[i];
    return new BufferAttribute(result, 3);
  });
  geometry.morphTargetsRelative = true;
  geometry.attributes.position.setUsage(DynamicDrawUsage);
  const previous = new Float64Array(sparse.length).fill(NaN);
  const sum = new Float64Array(base.length);
  const authored = mesh.morphTargetInfluences;
  const visible = new Array(first);
  const before = mesh.onBeforeRender, after = mesh.onAfterRender;
  mesh.onBeforeRender = function (...args) {
    before?.apply(this, args);
    for (let i = 0; i < first; i += 1) visible[i] = authored[i];
    this.morphTargetInfluences = visible;
  };
  mesh.onAfterRender = function (...args) {
    this.morphTargetInfluences = authored;
    after?.apply(this, args);
  };
  return function update() {
    if (previous.every((value, i) => value === authored[first + i])) return;
    sum.set(base);
    for (let i = 0; i < sparse.length; i += 1) {
      const weight = authored[first + i]; previous[i] = weight;
      if (!weight) continue;
      const { ids, values } = sparse[i];
      for (let k = 0; k < ids.length; k += 1) sum[ids[k]] += values[k] * weight;
    }
    geometry.attributes.position.array.set(sum);
    geometry.attributes.position.needsUpdate = true;
  };
}
