import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {MMDCompanionRuntime} from '../../web/src/features/stage/mmdCompanionRuntime.js';
const require=createRequire(new URL('../../web/package.json',import.meta.url));
const THREE=require('three');const {MMDAnimationHelper}=require('three-stdlib');
test('真实混合器与MMD骨骼缓存：定位、暂停、反向定位均保留目标姿态',()=>{
  const bone=new THREE.Bone();bone.name='HairA1';
  const mesh=new THREE.SkinnedMesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial());mesh.add(bone);mesh.bind(new THREE.Skeleton([bone]));mesh.geometry.userData.MMD={iks:[],grants:[]};
  const clip=new THREE.AnimationClip('trial',3,[new THREE.VectorKeyframeTrack('.bones[HairA1].position',[0,1,2,3],[0,0,0,1,0,0,2,0,0,3,0,0])]);
  const helper=new MMDAnimationHelper();helper.add(mesh,{animation:clip,physics:false});helper.enable('ik',false);helper.enable('grant',false);helper.update(.25);
  const mixer=helper.objects.get(mesh).mixer;
  const runtime=Object.assign(Object.create(MMDCompanionRuntime.prototype),{model:mesh,currentClip:clip,currentVmdAction:mixer.existingAction(clip),helper,calibrationCaptureMode:false,vmdAnchorBones:[],baseBoneTransforms:[],currentVmdLockLowerBody:false,renderScene(){}});
  for(const frame of [45,15,60,0,45]){
    assert.equal(runtime.seekVmdFrame(frame,30),true);assert.ok(Math.abs(bone.position.x-frame/30)<1e-6,`定位帧${frame}后骨骼位置${bone.position.x}，预期${frame/30}`);
    helper.update(.1);assert.ok(Math.abs(bone.position.x-frame/30)<1e-6,'暂停后姿态被旧缓存覆盖');
  }
});
test('连续定位不会把上次 Grant 旋转再次累加',()=>{
  const source=new THREE.Bone();source.name='Source';const target=new THREE.Bone();target.name='Deform';
  const mesh=new THREE.SkinnedMesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial());mesh.add(source,target);mesh.bind(new THREE.Skeleton([source,target]));mesh.geometry.userData.MMD={iks:[],grants:[{index:1,parentIndex:0,ratio:1,isLocal:false,affectRotation:true,affectPosition:false}]};
  const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),1);
  const clip=new THREE.AnimationClip('grant',3,[new THREE.QuaternionKeyframeTrack('.bones[Source].quaternion',[0,2],[0,0,0,1,...q.toArray()]),new THREE.QuaternionKeyframeTrack('.bones[Deform].quaternion',[0,2],[0,0,0,1,0,0,0,1])]);
  const helper=new MMDAnimationHelper();helper.add(mesh,{animation:clip,physics:false});helper.enable('ik',false);helper.update(.25);const mixer=helper.objects.get(mesh).mixer;
  const runtime=Object.assign(Object.create(MMDCompanionRuntime.prototype),{model:mesh,currentClip:clip,currentVmdAction:mixer.existingAction(clip),helper,calibrationCaptureMode:false,vmdAnchorBones:[],baseBoneTransforms:[],currentVmdLockLowerBody:false,renderScene(){}});
  for(const frame of [45,15,60,0,45]){runtime.seekVmdFrame(frame,30);assert.ok(target.quaternion.angleTo(source.quaternion)<.001,`Grant重复累加，帧${frame}旋转差${target.quaternion.angleTo(source.quaternion)}`);}
});
