import { MMDLoader } from 'three-stdlib';
import { BufferAttribute, BufferGeometry, Sphere, Vector3, AnimationClip, VectorKeyframeTrack, QuaternionKeyframeTrack, NumberKeyframeTrack } from 'three';
import { inspectVmdStructure } from './vmdStructureGuard.js';

const loader = new MMDLoader();
const trackTypes = { vector: VectorKeyframeTrack, quaternion: QuaternionKeyframeTrack, number: NumberKeyframeTrack };
let BezierInterpolant;
const attributeData = attribute => ({ array: attribute.array, itemSize: attribute.itemSize, normalized: attribute.normalized, name: attribute.name });
const restoreAttribute = data => {
  const attribute = new BufferAttribute(data.array, data.itemSize, data.normalized);
  attribute.name = data.name;
  return attribute;
};

export function prepareMmdAsset(type, { buffer, target }) {
  if (type === 'pmx') {
    const data = loader._getParser().parsePmx(buffer, true);
    const source = loader.meshBuilder.geometryBuilder.build(data);
    if (data.vertices[0]?.auvs?.[0]) {
      const uv = new Float32Array(data.vertices.length * 2);
      for (let i = 0; i < data.vertices.length; i++) uv.set(data.vertices[i].auvs[0].slice(0, 2), i * 2);
      source.setAttribute('gf2Uv', new BufferAttribute(uv, 2));
    }
    const geometry = {
      attributes: Object.fromEntries(Object.entries(source.attributes).map(([name, a]) => [name, attributeData(a)])),
      index: attributeData(source.index),
      morphAttributes: Object.fromEntries(Object.entries(source.morphAttributes).map(([name, list]) => [name, list.map(attributeData)])),
      morphTargetsRelative: source.morphTargetsRelative, morphTargets: source.morphTargets,
      bones: source.bones, groups: source.groups, userData: source.userData,
      boundingSphere: { center: source.boundingSphere.center.toArray(), radius: source.boundingSphere.radius },
    };
    const transfer = [...new Set([geometry.index, ...Object.values(geometry.attributes), ...Object.values(geometry.morphAttributes).flat()].map(a => a.array.buffer))];
    // 主线程材质构建只需纹理、材质与材质形态；不复制几十万个原始顶点对象。
    return { geometry, data: { metadata: data.metadata, textures: data.textures, materials: data.materials,
      morphs: data.morphs.map(m => ({ ...m, elements: m.type === 0 || m.type === 8 ? m.elements : [] })) }, transfer };
  }
  if (type !== 'vmd') throw new Error('未知MMD准备类型。');
  const structure = inspectVmdStructure(buffer);
  if (!structure.ok) throw new Error(`Invalid VMD: ${structure.reason}`);
  const bones = target.bones.map(bone => ({ name: bone.name, position: new Vector3().fromArray(bone.position) }));
  const byName = new Map(bones.map(bone => [bone.name, bone]));
  const vmd = loader._getParser().parseVmd(buffer, true);
  const clip = target.isCamera ? loader.animationBuilder.buildCameraAnimation(vmd)
    : loader.animationBuilder.build(vmd, { skeleton: { bones, getBoneByName: name => byName.get(name) }, morphTargetDictionary: target.morphTargetDictionary });
  const arrays = [];
  let length = 0;
  const append = array => {
    if (!array) return null;
    const range = [length, array.length]; length += array.length; arrays.push(array); return range;
  };
  const tracks = clip.tracks.map(track => ({ name: track.name, type: track.ValueTypeName,
    times: append(track.times), values: append(track.values), params: append(track.createInterpolant().interpolationParams) }));
  // 单块转移，避免上万轨道产生三万多个跨线程ArrayBuffer消息附件。
  const packed = new Float32Array(length);
  let offset = 0;
  for (const array of arrays) { packed.set(array, offset); offset += array.length; }
  return { clip: { name: clip.name, duration: clip.duration, blendMode: clip.blendMode, tracks, packed }, transfer: [packed.buffer] };
}

export function restorePreparedGeometry(data) {
  const geometry = new BufferGeometry();
  for (const [name, attribute] of Object.entries(data.attributes)) geometry.setAttribute(name, restoreAttribute(attribute));
  geometry.setIndex(restoreAttribute(data.index));
  geometry.morphAttributes = Object.fromEntries(Object.entries(data.morphAttributes).map(([name, list]) => [name, list.map(restoreAttribute)]));
  geometry.morphTargetsRelative = data.morphTargetsRelative;
  geometry.morphTargets = data.morphTargets;
  geometry.bones = data.bones;
  geometry.groups = data.groups;
  geometry.userData = data.userData;
  for (const ik of geometry.userData.MMD?.iks || []) {
    for (const link of ik.links) {
      for (const key of ['rotationMin', 'rotationMax', 'limitation']) {
        const value = link[key];
        if (value) link[key] = new Vector3(value.x, value.y, value.z);
      }
    }
  }
  geometry.boundingSphere = new Sphere(new Vector3().fromArray(data.boundingSphere.center), data.boundingSphere.radius);
  return geometry;
}

export function restorePreparedClip(data) {
  // 沿用安装版本MMDLoader的插值器，保留其连续帧和非线性曲线语义。
  BezierInterpolant ||= loader.animationBuilder._createTrack('', VectorKeyframeTrack, [0], [0, 0, 0], new Array(12).fill(0)).createInterpolant().constructor;
  const view = range => data.packed.subarray(range[0], range[0] + range[1]);
  const tracks = data.tracks.map(source => {
    const Type = trackTypes[source.type];
    if (!Type) throw new Error('不支持的MMD轨道类型：' + source.type);
    const track = new Type(source.name, view(source.times), view(source.values));
    if (source.params) {
      // 缓存会克隆times/values；独立参数块避免一个小轨道仍引用整个传输包。
      const params = view(source.params).slice();
      track.createInterpolant = function(result) { return new BezierInterpolant(this.times, this.values, this.getValueSize(), result, params); };
    }
    return track;
  });
  return new AnimationClip(data.name, data.duration, tracks, data.blendMode);
}
