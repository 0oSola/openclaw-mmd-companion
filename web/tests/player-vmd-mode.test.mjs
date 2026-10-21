import test from 'node:test';
import assert from 'node:assert/strict';
import {readPlayerVmdMode,writePlayerVmdMode,applyPlayerVmdMode} from '../src/features/mapping/playerVmdMode.js';

test('播放器默认烘焙，按用户保存普通模式且不读取旧资源记忆',()=>{
  const values=new Map([['mmd_vmd_baked_memory_v1:u','{"old":false}']]);
  const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  assert.equal(readPlayerVmdMode(storage,'u'),'baked');
  assert.equal(writePlayerVmdMode(storage,'u','standard'),true);
  assert.equal(readPlayerVmdMode(storage,'u'),'standard');
  assert.equal(readPlayerVmdMode(storage,'other'),'baked');
  assert.equal(readPlayerVmdMode({getItem(){throw Error('denied')}},'u'),'baked');
  assert.equal(writePlayerVmdMode({setItem(){throw Error('denied')}},'u','baked'),false);
});

test('新资源、旧资源及聊天动作统一覆盖旧锁定与逐URL模式',()=>{
  for(const mode of ['baked','standard'])for(const url of ['/old.vmd','/new.vmd']){
    const value=applyPlayerVmdMode({mode:'vmd',vmdUrl:url,lockLowerBody:true,lockRootPosition:true,
      bakedBoneAnimation:mode!=='baked',vmdBakedBoneAnimationByUrl:{[url]:false}},mode);
    assert.equal(value.playerVmdMode,mode);
    assert.equal(value.bakedBoneAnimation,mode==='baked');
    assert.equal(value.lockLowerBody,false);assert.equal(value.lockRootPosition,false);
    assert.equal(value.vmdBakedBoneAnimationByUrl,undefined);
  }
});
