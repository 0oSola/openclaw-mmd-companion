import * as THREE from 'three';
import {MMDLoader} from '/vendor/three-stdlib/loaders/MMDLoader.js';
import {OrbitControls} from '/vendor/three-stdlib/controls/OrbitControls.js';
import {prepareBakedGarmentMorphs} from '/runtime/bakedGarmentMorphs.js';
import {enableVmdSubframeCurves} from '/runtime/vmdSubframeCurves.js';
import {isKoledaMaskMaterialName} from '/runtime/koledaDefaultAppearance.js';
import {attachGf2SecondaryUv,createGf2CharacterMaterials} from '/runtime/gf2CharacterMaterials.js';
import {createGf2CapturedMaterials} from '/runtime/gf2CapturedMaterials.js';

const $=id=>document.getElementById(id),host=$('viewer');
const captureMode=new URLSearchParams(location.search).has('capture');
const legacyMode=new URLSearchParams(location.search).has('legacy');
if(captureMode)document.body.classList.add('capture');
const state={ready:false,playing:false,frame:0,speed:1,mode:'game',poseMode:'motion',renderCount:0,errors:[],duration:0};
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
host.prepend(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#252a2e');
const camera=new THREE.PerspectiveCamera(33,1,0.01,100);camera.position.set(0,0.94,3.7);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0.86,0);controls.minDistance=.3;controls.maxDistance=7;controls.enableDamping=false;controls.update();
const key=new THREE.DirectionalLight(0xffffff,1.6);key.position.set(-2.5,4,5*Math.cos(Math.PI/6));key.target.position.set(0,.9,0);scene.add(key,key.target);
scene.add(new THREE.HemisphereLight(0xe3edff,0x6c6867,0.5));scene.add(new THREE.AmbientLight(0xffffff,0.22));
const fill=new THREE.DirectionalLight(0xb7cce4,0.2);fill.position.set(3,2,-4);scene.add(fill);
const floor=new THREE.Mesh(new THREE.CircleGeometry(2,96),new THREE.MeshBasicMaterial({color:0x202528}));floor.rotation.x=-Math.PI/2;floor.position.y=-.012;scene.add(floor);
let model,adapter,garments,samplers=[],last=performance.now();
function render(){adapter?.update(camera,key);if(adapter?.render)adapter.render(renderer,scene,camera);else renderer.render(scene,camera);state.renderCount++;}
function resize(){const b=host.getBoundingClientRect();renderer.setSize(b.width,b.height,false);camera.aspect=b.width/b.height;camera.updateProjectionMatrix();render();}
new ResizeObserver(resize).observe(host);controls.addEventListener('change',render);
function setView(view){
  const close=view==='face',target=new THREE.Vector3(0,close?1.40:.86,0),distance=close?.68:3.7;
  const direction={front:[0,0,1],left:[1,0,0],right:[-1,0,0],back:[0,0,-1],face:[0,0,1]}[view];
  if(close&&model){const head=model.skeleton.bones.find(b=>b.name==='頭');if(head){head.getWorldPosition(target);target.y+=.04;}}
  camera.position.copy(target).add(new THREE.Vector3(...direction).multiplyScalar(distance));controls.target.copy(target);controls.update();render();
}
function setPlaying(value){if(value&&state.poseMode==='reference')setReferencePose(false);state.playing=!!value;$('play').textContent=value?'暂停':'播放';last=performance.now();}
function setReferencePose(value){
 if(legacyMode||!state.ready)return;
 if(value){setPlaying(false);mode('game');}
 state.poseMode=value?'reference':'motion';adapter.setReferencePose(value);$('reference-pose').textContent=value?'返回现有动作':'原帧姿态';$('reference-pose').setAttribute('aria-pressed',String(value));$('classic').disabled=!!value;
 $('pose-note').textContent=value?'原帧姿态用于同机位比对；播放会返回现有动作。':'现有VMD动作 · 可旋转、播放和跳帧';render();
}
function applyCapturedCamera(){
  camera.fov=40;camera.position.set(-.013,.763999879,2.562000275);controls.target.copy(camera.position).add(new THREE.Vector3(.0050729816,.0209598728,-.9997675419).multiplyScalar(2.562));
  camera.updateProjectionMatrix();controls.update();floor.visible=false;state.capturedCamera={fov:40,position:camera.position.toArray(),target:controls.target.toArray(),sourceFrame:7480};render();
}
async function applyComparison(){
  const response=await fetch('/game-assets/comparison/camera.json');
  if(!response.ok)throw new Error('兵营对照机位尚未保存');
  const config=await response.json();
  setPlaying(false);seek(config.frame);
  camera.fov=config.fov;camera.position.fromArray(config.position);controls.target.fromArray(config.target);
  camera.updateProjectionMatrix();controls.update();floor.visible=false;render();
  state.comparison=config;
  return config;
}
function seek(frame){
  if(!state.ready)return;
  if(state.poseMode==='reference')setReferencePose(false);
  state.frame=THREE.MathUtils.clamp(Number(frame),0,state.duration*30);
  for(const sample of samplers)sample(state.frame/30);
  garments?.();model.updateMatrixWorld(true);model.skeleton.update();
  $('timeline').value=String(state.frame);$('time').textContent=`${(state.frame/30).toFixed(2)} / ${state.duration.toFixed(2)} 秒`;render();
}
function mode(value){state.mode=value;adapter?.setMode(value);$('game').setAttribute('aria-pressed',String(value==='game'));$('classic').setAttribute('aria-pressed',String(value==='classic'));render();}
function sampleClip(mesh,clip){
  enableVmdSubframeCurves(clip,{allBoneTracks:true});const bones=new Map(mesh.skeleton.bones.map(b=>[b.name,b]));
  return clip.tracks.map(track=>{
    const bone=/^\.bones\[(.+)\]\.(position|quaternion|scale)$/.exec(track.name),morph=/^\.morphTargetInfluences\[(\d+)\]$/.exec(track.name),interpolant=track.createInterpolant();
    if(bone){const target=bones.get(bone[1]);if(!target)throw new Error('动作骨骼缺失：'+bone[1]);return t=>target[bone[2]].fromArray(interpolant.evaluate(t));}
    if(morph)return t=>{mesh.morphTargetInfluences[Number(morph[1])]=interpolant.evaluate(t)[0];};
    throw new Error('未支持的动作通道：'+track.name);
  });
}
$('game').onclick=()=>mode('game');$('classic').onclick=()=>mode('classic');
$('play').onclick=()=>{if(state.frame>=state.duration*30)seek(0);setPlaying(!state.playing);};
$('restart').onclick=()=>{setPlaying(false);seek(0);};$('timeline').oninput=e=>{setPlaying(false);seek(e.target.value);};$('speed').onchange=e=>state.speed=Number(e.target.value);
$('light').oninput=e=>{const angle=Number(e.target.value)*Math.PI/180;key.position.set(5*Math.sin(angle),4,5*Math.cos(angle));adapter?.setLightAzimuth?.(Number(e.target.value));$('light-value').textContent=e.target.value+'°';render();};
$('exposure').oninput=e=>{renderer.toneMappingExposure=2**Number(e.target.value);$('exposure-value').textContent=Number(e.target.value).toFixed(1);render();};
for(const name of ['normal','ramp','specular'])$(name).onchange=e=>{if(adapter)adapter.controls[name].value=e.target.checked?1:0;render();};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));$('retry').onclick=()=>location.reload();
$('barrack-view').onclick=applyCapturedCamera;
$('reference-pose').onclick=()=>setReferencePose(state.poseMode!=='reference');
function animate(now){const dt=(now-last)/1000;last=now;if(state.ready&&state.playing){let next=state.frame+dt*30*state.speed;if(next>=state.duration*30){if($('loop').checked)next%=state.duration*30;else{next=state.duration*30;setPlaying(false);}}seek(next);}requestAnimationFrame(animate);}requestAnimationFrame(animate);

async function main(){
  const response=await fetch('/motion/manifest.json');if(!response.ok)throw new Error('动作清单读取失败');const motion=await response.json();
  const manager=new THREE.LoadingManager(),errors=[];let resolveTextures;
  const textures=new Promise(resolve=>resolveTextures=resolve);manager.onLoad=resolveTextures;manager.onError=url=>errors.push(url);
  manager.setURLModifier(url=>{const normalized=url.replaceAll('\\','/');if(/\/spa\/?$/i.test(normalized))return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==';return normalized;});
  const loader=new MMDLoader(manager);
  model=await new Promise((resolve,reject)=>loader.loadPMX('/model/'+encodeURIComponent('Koleda_v1.1_动作兼容.pmx'),data=>{
    try{const mesh=loader.meshBuilder.build(data,'/model/',undefined,reject);attachGf2SecondaryUv(mesh,data);resolve(mesh);}catch(error){reject(error);}
  },undefined,reject));
  await textures;if(errors.length)throw new Error('PMX贴图读取失败：'+errors[0]);
  for(const [name,list]of Object.entries(model.geometry.morphAttributes))if(!list.length)delete model.geometry.morphAttributes[name];
  for(const material of model.material){if(isKoledaMaskMaterialName(material.name))material.visible=false;if(material.map)material.map.colorSpace=THREE.SRGBColorSpace;material.emissive?.set(0);material.emissiveIntensity=0;if(!material.gradientMap?.image)material.gradientMap=null;material.needsUpdate=true;}
  model.scale.setScalar(.08);model.frustumCulled=false;
  garments=prepareBakedGarmentMorphs(model);
  $('status').textContent='正在加载原始材质贴图…';
  adapter=legacyMode?await createGf2CharacterMaterials(model,'/game-assets/'):await createGf2CapturedMaterials(model,'/game-assets/frame/',{resourceMode:new URLSearchParams(location.search).get('resources')==='files'?'files':'bundle',onProgress:({loaded,total,unit})=>{$('status').textContent=`正在加载${unit} ${loaded} / ${total}…`;}});
  state.renderMethod=legacyMode?'原预览材质公式':'原抓帧着色程序';
  if(!legacyMode){
    document.querySelector('.checks').style.display='none';$('light').value='36';$('light').disabled=true;$('light-value').textContent='兵营原参数 · 36°';
    $('reference-pose').disabled=false;
    document.querySelector('.boundary').textContent='兵营原光照与反射、脸部受影、眼部叠加、刘海透视及衣料前后表面已接入。原帧姿态可单独核对角色；播放使用现有VMD。';
  }
  $('binding').textContent=`${adapter.stats.bound.length} / ${adapter.originals?.length||model.material.length}`;$('uv').textContent='已接入';
  const motionUrl='/motion/'+encodeURIComponent(motion.motion_file);
  const clip=await new Promise((resolve,reject)=>loader.loadAnimation(motionUrl,model,resolve,undefined,reject));
  samplers=sampleClip(model,clip);state.duration=clip.duration;state.pmx=motion.pmx_sha256;state.vmd=motion.motion_sha256;
  scene.add(model);state.ready=true;$('timeline').max=String(clip.duration*30);
  for(const name of ['game','classic','play','restart','timeline'])$(name).disabled=false;
  $('status').textContent=`已就绪 · ${adapter.stats.textureCount} 张原始贴图 · 现有 PMX / VMD`;
  seek(0);setView('front');
  if(!legacyMode)applyCapturedCamera();else if(captureMode)await applyComparison();
}
window.gf2Preview={state,renderer,scene,camera,key,controls,seek,setView,setPlaying,setReferencePose,mode,applyComparison,applyCapturedCamera,render,get model(){return model;},get materials(){return adapter;}};
main().catch(error=>{state.errors.push(String(error));$('status').textContent='加载失败：'+error.message;$('status').classList.add('error');$('retry').hidden=false;console.error(error);});
