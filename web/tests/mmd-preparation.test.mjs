import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MMDLoader } from 'three-stdlib';
import { Vector3 } from 'three';
import { prepareMmdAsset, restorePreparedGeometry, restorePreparedClip } from '../src/features/stage/mmdPreparationData.js';

const loader=new MMDLoader();
const modelUrl=new URL('../../ak-12/vmd/v1.1/Koleda_v1.1_动作兼容.pmx',import.meta.url);
const motionUrl=new URL('../../ak-12/vmd/v1.1/查验_2026.10.12_09.59.39/A03_Koleda_进场叉腰_左手接触修正_v1.1_1倍速_眼睑完整修复.vmd',import.meta.url);
const bytes=url=>{const b=fs.readFileSync(url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
let referenceGeometry;
test('真实PMX异步准备的数据逐数组保持几何、骨骼、形态与碰撞元数据',()=>{
  const input=bytes(modelUrl),data=loader._getParser().parsePmx(input,true);
  referenceGeometry=loader.meshBuilder.geometryBuilder.build(data);
  const prepared=prepareMmdAsset('pmx',{buffer:input});
  const received=structuredClone(prepared,{transfer:prepared.transfer});
  const geometry=restorePreparedGeometry(received.geometry);
  for(const name of Object.keys(referenceGeometry.attributes))assert.deepEqual(geometry.attributes[name].array,referenceGeometry.attributes[name].array,name);
  assert.deepEqual(geometry.index.array,referenceGeometry.index.array);
  assert.deepEqual(geometry.groups,referenceGeometry.groups);
  assert.deepEqual(geometry.bones,referenceGeometry.bones);
  assert.deepEqual(geometry.userData,referenceGeometry.userData);
  assert.equal(geometry.morphAttributes.position.length,referenceGeometry.morphAttributes.position.length);
  for(let i=0;i<geometry.morphAttributes.position.length;i++)assert.deepEqual(geometry.morphAttributes.position[i].array,referenceGeometry.morphAttributes.position[i].array,`形态${i}`);
  assert.deepEqual(received.data.materials,data.materials);
  assert.deepEqual(received.data.textures,data.textures);
});
test('真实A03全部轨道数值、亚帧插值与主线程原构建一致',()=>{
  const input=bytes(motionUrl);
  const bones=referenceGeometry.bones.map(b=>({name:b.name,position:new Vector3().fromArray(b.pos)}));
  const map=new Map(bones.map(b=>[b.name,b]));
  const morphTargetDictionary=Object.fromEntries(referenceGeometry.morphTargets.map((m,i)=>[m.name,i]));
  const target={skeleton:{bones,getBoneByName:name=>map.get(name)},morphTargetDictionary};
  const original=loader.animationBuilder.build(loader._getParser().parseVmd(input,true),target);
  const prepared=prepareMmdAsset('vmd',{buffer:input,target:{bones:bones.map(b=>({name:b.name,position:b.position.toArray()})),morphTargetDictionary}});
  const received=structuredClone(prepared,{transfer:prepared.transfer});
  const actual=restorePreparedClip(received.clip);
  assert.equal(actual.tracks.length,original.tracks.length);assert.equal(actual.duration,original.duration);
  for(let i=0;i<original.tracks.length;i++){
    const a=actual.tracks[i],b=original.tracks[i];
    assert.equal(a.name,b.name);assert.deepEqual(a.times,b.times);assert.deepEqual(a.values,b.values);
    const ia=a.createInterpolant(),ib=b.createInterpolant();
    if(ia.interpolationParams)assert.equal(ia.interpolationParams.buffer.byteLength,ia.interpolationParams.byteLength,'缓存插值参数不能保留无关轨道的整块传输数据');
    for(const t of [0,.017,.123,1.25,actual.duration])assert.deepEqual(ia.evaluate(t),ib.evaluate(t),a.name);
  }
});
test('损坏动作显式失败',()=>{assert.throws(()=>prepareMmdAsset('vmd',{buffer:new ArrayBuffer(10),target:{bones:[],morphTargetDictionary:{}}}),/Invalid VMD/);});
