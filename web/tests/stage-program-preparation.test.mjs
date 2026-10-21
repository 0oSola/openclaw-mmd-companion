import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareStagePrograms, prepareStageTextures } from '../src/features/stage/stageProgramPreparation.js';

test('全部程序变体完成之前不读取同步日志或uniform',async()=>{
  let ready=false,reads=0;
  const renderer={info:{programs:[{isReady:()=>ready,getUniforms(){reads++;}},{isReady:()=>true,getUniforms(){reads++;}}]}};
  const job=prepareStagePrograms(renderer,()=>{});
  await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(reads,0);
  ready=true;await job;assert.equal(reads,2);
});
test('取消等待后不触碰已释放的程序',async()=>{
  const controller=new AbortController();let reads=0;
  const renderer={info:{programs:[{isReady:()=>false,getUniforms(){reads++;}}]}};
  const job=prepareStagePrograms(renderer,()=>{},controller.signal);
  controller.abort();await assert.rejects(job,{name:'AbortError'});assert.equal(reads,0);
});
test('编译失败不能报告就绪',async()=>{
  const renderer={info:{programs:[{isReady:()=>true,getUniforms(){this.diagnostics={runnable:false};}}]}};
  await assert.rejects(prepareStagePrograms(renderer,()=>{}),/着色器/);
});
test('共享贴图只上传一次，上传之间让出主线程且取消后不再上传',async()=>{
  const a={isTexture:true},b={isTexture:true},c={isTexture:true};
  const material={map:a};
  const scene={traverse:fn=>fn({material})};
  const controller=new AbortController();const uploaded=[];
  const renderer={properties:{get:()=>({uniforms:{mask:{value:b}}})},initTexture:t=>{uploaded.push(t);if(t===b)controller.abort();}};
  const job=prepareStageTextures(renderer,scene,[a,c],controller.signal);
  assert.equal(uploaded.length,0);
  await assert.rejects(job,{name:'AbortError'});
  assert.deepEqual(uploaded,[a,b]);
});
test('页面未再出帧时取消准备也能立即结束',async(t)=>{
  const previous=globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame=()=>1;
  t.after(()=>{if(previous)globalThis.requestAnimationFrame=previous;else delete globalThis.requestAnimationFrame;});
  const controller=new AbortController();let uploaded=false;
  const renderer={properties:{get:()=>({})},initTexture:()=>{uploaded=true;}};
  const job=prepareStageTextures(renderer,{traverse(){}},[{isTexture:true}],controller.signal).then(()=> 'ready',error=>error.name);
  controller.abort();
  assert.equal(await Promise.race([job,new Promise(resolve=>setTimeout(()=>resolve('pending'),30))]),'AbortError');
  assert.equal(uploaded,false);
});
