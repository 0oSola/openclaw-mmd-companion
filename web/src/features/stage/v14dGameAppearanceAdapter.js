import * as THREE from "three";
import {isKoledaModelIdentifier} from "./koledaDefaultAppearance.js";
import {V14D_GAME_DEFAULT_SETTINGS,V14D_GAME_MANIFEST_URL,validateV14dGameManifest,normalizeV14dGameSettings} from "./v14dGameAppearanceAssets.js";
import {createV14dGameMaterials} from "./v14dGameMaterials.js";
const idle=()=>({pipeline:"v14d-game",phase:"idle",realAppearanceAvailable:false,label:"V14D 游戏外观未安装"});
export function createV14dGameAppearanceAdapter({fetchImpl=globalThis.fetch?.bind(globalThis),manifestUrl=V14D_GAME_MANIFEST_URL,manifest:initialManifest=null,textureLoader=new THREE.TextureLoader(),createMaterials=createV14dGameMaterials}={}) {
 let status=idle(),installed=null,generation=0,resources=initialManifest;
 const settings={...V14D_GAME_DEFAULT_SETTINGS};
 const getStatus=()=>({...status,installed:!!installed,manifestId:resources?.id||null,settings:{...settings},materials:installed?.factory.evidence?.()||null});
 function cleanup(state){if(!state)return;if(state.model.material===state.factory.materials)state.model.material=state.originals;state.factory.dispose();for(const t of state.textures)t.dispose();}
 function release(){generation++;cleanup(installed);installed=null;status=idle();return getStatus();}
 async function bytes(url,sha){const response=await fetchImpl(url,{cache:"default"});if(!response?.ok)throw Error("本机资源读取失败："+url);const buffer=await response.arrayBuffer();if(!sha||!/^[a-f0-9]{64}$/i.test(sha))throw Error("本机资源缺少有效SHA256："+url);const actual=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",buffer))).map(v=>v.toString(16).padStart(2,"0")).join("");if(actual!==sha)throw Error("本机资源哈希不符："+url);return {buffer,type:response.headers?.get?.("content-type")||"application/octet-stream"};}
 async function install({model,modelUrl="",manifest=null,runtime}={}) {
  release();const token=generation;
  if(!model||!isKoledaModelIdentifier(modelUrl,model.name,model.userData?.modelUrl)){status={...idle(),phase:"unsupported",reason:"仅支持克莱妲模型",label:"V14D 游戏外观不可用：模型不匹配"};return getStatus();}
  let factory=null;const textures=[];const originals=model.material;
  try{
   if(manifest)resources=manifest;
   if(!resources){const response=await fetchImpl(manifestUrl,{cache:"no-store"});if(!response?.ok)throw Error("本机资源清单读取失败");resources=await response.json();}
   const check=validateV14dGameManifest(resources);if(!check.ok)throw Error(check.reason);
   if(!resources.materialSource?.url||resources.masks?.length!==5)throw Error("冻结材质配方或五张脸部遮罩缺失");
   if(!runtime?.renderer||runtime.v14dGameLights?.length!==6)throw Error("渲染器或六灯未就绪");
   status={...idle(),phase:"loading",label:"正在安装冻结预览材质和五张遮罩"};
   const source=JSON.parse(new TextDecoder().decode((await bytes(resources.materialSource.url,resources.materialSource.sha256)).buffer));
   const resolveTexture=(url,sha)=>{if(sha)return {url,sha256:sha};const relative=url.replace(/^\/model\//,"");const entry=resources.textures.find(e=>e.relativePath?.toLowerCase()===relative.toLowerCase());if(!entry)throw Error("配方纹理未在白名单登记："+relative);return entry;};
   const loadTexture=async(url,sha)=>{const e=resolveTexture(url,sha);const data=await bytes(e.url,e.sha256);const objectUrl=URL.createObjectURL(new Blob([data.buffer],{type:data.type}));try{const texture=await textureLoader.loadAsync(objectUrl);texture.colorSpace=THREE.NoColorSpace;texture.flipY=false;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;textures.push(texture);return texture;}finally{URL.revokeObjectURL(objectUrl);}};
   factory=await createMaterials({model,manifest:source,renderer:runtime.renderer,settings,loadTexture,maskEntries:resources.masks,lights:runtime.v14dGameLights});
   if(token!==generation){factory.dispose();for(const t of textures)t.dispose();return getStatus();}
   model.material=factory.materials;installed={model,originals,factory,textures};
   status={pipeline:"v14d-game",phase:"ready",realAppearanceAvailable:true,label:"V14D 本机冻结预览外观已接入",resources:{sourceCommit:"cd973980e08e09739d620cc948472638a4e1c7f2",materialSource:resources.materialSource.sha256,maskHashes:resources.masks.map(m=>m.sha256)}};
   return getStatus();
  }catch(error){factory?.dispose();for(const t of textures)t.dispose();if(token===generation)status={...idle(),phase:"unavailable",label:"V14D 游戏外观加载失败，明确拒绝接入",reason:String(error.message||error)};return getStatus();}
 }
 return {getStatus,install,release,getSettings:()=>({...settings}),setSettings(patch){const next=normalizeV14dGameSettings({...settings,...patch});Object.assign(settings,next);return {...settings};},draw(draw,options){return installed?installed.factory.draw(draw,options):draw();},markUnavailable(reason){release();status={...idle(),phase:"unavailable",reason:String(reason),label:"V14D 游戏外观不可用"};return getStatus();}};
}
