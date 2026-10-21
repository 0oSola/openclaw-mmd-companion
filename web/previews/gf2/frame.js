import {CapturedFrameRenderer} from './frame-renderer.js';
const params=new URLSearchParams(location.search), status=document.querySelector('#status');
if(params.has('capture'))document.body.classList.add('capture');
else document.querySelector('#pair').classList.add('focus');
const state={ready:false,errors:[],draws:0};window.gf2Frame={state};
async function showRenderedImage(renderer){const image=document.querySelector('#render-image');image.src=renderer.canvas.toDataURL('image/png');await image.decode();}
document.querySelector('#side').onclick=()=>document.querySelector('#pair').classList.remove('overlay');
document.querySelector('#overlay').onclick=()=>document.querySelector('#pair').classList.add('overlay');
document.querySelector('#crop').onclick=e=>{const focus=document.querySelector('#pair').classList.toggle('focus');e.target.textContent=focus?'完整场景':'人物局部';};
document.querySelector('#mix').oninput=e=>{document.querySelector('#pair').style.setProperty('--mix',Number(e.target.value)/100);document.querySelector('#mix-value').textContent=e.target.value+'%';};
document.querySelector('#retry').onclick=()=>location.reload();
try{
 const renderer=new CapturedFrameRenderer(document.querySelector('#frame'),'/game-assets/frame/');
 window.gf2Frame.renderer=renderer;
 await renderer.load(message=>status.textContent=message);
 renderer.render({pipeline:!params.has('capture')});await showRenderedImage(renderer);state.ready=true;state.draws=renderer.draws.length;state.info=renderer.info;
 status.textContent=`已重新绘制 ${state.draws} 次角色绘制与原后期流程。相机、灯光和环境反射均取自实机帧。`;
 document.querySelector('#display').onchange=async e=>{
  const mode=e.target.value;
  if(mode==='pipeline')renderer.render({pipeline:true});else{renderer.render({through:mode==='linear'?2849:3717});if(mode==='post')renderer.presentPost();}
  await showRenderedImage(renderer);
  const source=document.querySelector('figure img');source.src='/game-assets/frame/'+(mode==='linear'?'scene-after-character-display.png':'reference-post-display.png');source.classList.toggle('source-linear',mode==='linear');
  document.querySelector('#source-caption').textContent=mode==='linear'?'原游戏 · 不透明角色阶段':'原游戏 · 界面叠加前';
  document.querySelector('#pair').classList.toggle('focus',mode==='pipeline'&&!params.has('capture'));document.querySelector('#crop').textContent=mode==='pipeline'?'完整场景':'人物局部';
 };
}catch(error){state.errors.push(String(error.stack||error));status.textContent=`加载失败：${error.message}`;console.error(error);}
