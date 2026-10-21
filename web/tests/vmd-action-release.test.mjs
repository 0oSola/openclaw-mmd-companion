import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { withVmdBindingRelease } from '../src/features/stage/vmdActionRelease.js';

function fixture(count=12){
  const root=new THREE.Object3D();root.values=Array(count).fill(0);
  const clip=(name,start,end)=>new THREE.AnimationClip(name,1,Array.from({length:end-start},(_,j)=>new THREE.NumberKeyframeTrack(`.values[${start+j}]`,[0,1],[start+j,10+start+j])));
  const mixer=new THREE.AnimationMixer(root),old=clip('old',0,count),next=clip('next',0,3);
  mixer.clipAction(old).play();mixer.update(.25);mixer.clipAction(next).play();mixer.update(.1);
  return {root,mixer,old,next};
}
function state({root,mixer}){return {values:[...root.values],actions:mixer.stats.actions.total,bindings:mixer.stats.bindings.total,inUse:mixer.stats.bindings.inUse,roots:Object.keys(mixer._bindingsByRootAndName).length};}
test('共享轨道、播放状态、回收再播放与原Three行为一致',()=>{
  const original=fixture(),fast=fixture();
  for(const method of ['old','next','old']){
    for(const [f,release] of [[original,(_m,fn)=>fn()],[fast,withVmdBindingRelease]]){
      f.mixer.clipAction(f[method]).stop();
      release(f.mixer,()=>{f.mixer.uncacheAction(f[method],f.root);f.mixer.uncacheClip(f[method]);});
      f.mixer.update(.15);
    }
    assert.deepEqual(state(fast),state(original));
  }
  fast.mixer.clipAction(fast.old).play();original.mixer.clipAction(original.old).play();
  fast.mixer.update(.1);original.mixer.update(.1);assert.deepEqual(state(fast),state(original));
});
test('根对象释放后没有残留绑定，异常后恢复原方法',()=>{
  const f=fixture(100),method=f.mixer._removeInactiveBinding;
  assert.throws(()=>withVmdBindingRelease(f.mixer,()=>{throw Error('中断');}),/中断/);
  assert.equal(f.mixer._removeInactiveBinding,method);
  withVmdBindingRelease(f.mixer,()=>f.mixer.uncacheRoot(f.root));
  assert.equal(f.mixer.stats.bindings.total,0);assert.equal(f.mixer.stats.actions.total,0);
  assert.equal(Object.keys(f.mixer._bindingsByRootAndName).length,0);
  assert.equal(f.mixer._removeInactiveBinding,method);
});
test('真实一万条绑定回收不再出现秒级停顿',()=>{
  const f=fixture(10279);f.mixer.clipAction(f.old).stop();
  const start=performance.now();
  withVmdBindingRelease(f.mixer,()=>f.mixer.uncacheClip(f.old));
  assert.ok(performance.now()-start<200,'一万条绑定清理应低于200ms');
  assert.equal(f.mixer.stats.bindings.total,3);
  f.mixer.update(.1);assert.ok(f.root.values[0]>0);
});
