import * as THREE from 'three';
import {isKoledaMaskMaterialName,selectKoledaClosedEyeMorphNames} from './koledaDefaultAppearance.js';
import {selectFaceShadow} from './v14dGameSource/faceShadowSelection.mjs';
import {withMorphOverride,eyePreviewWeight} from './v14dGameSource/eyePreview.mjs';
import {installHairDiskCandidate} from './v14dGameSource/hairDiskCandidate.mjs';
import {gameReferenceProfile,gameReferenceVisible,buildHairRegionMask,installHairRegionVertex,HAIR_REGION_MAP_GLSL,HAIR_REGION_OUTPUT_GLSL,gameOutfitProfile,gameOutfitTexturePaths,installGameIrisGlow,installGameFaceLineSoftening,FABRIC_FADE_START,FABRIC_FADE_END,installGameLegStructure} from './v14dGameSource/gameReferenceLook.mjs';

// 每批最多四张，保留输入顺序。失败后停止领新任务，并等在途任务结束再交由适配器释放纹理。
async function prepareTextures(entries, prepare) {
 const results=new Array(entries.length);let next=0,failure=null;
 async function worker(){
  while(!failure && next<entries.length){
   const index=next++;
   try{results[index]=await prepare(entries[index]);}catch(error){failure=error;}
  }
 }
 await Promise.all(Array.from({length:Math.min(4,entries.length)},()=>worker()));
 if(failure)throw failure;
 return results;
}

// 材质工厂来自冻结预览 cd973980；只替换资源入口、状态来源和生命周期。
export async function createV14dGameMaterials({model,manifest,renderer,settings,loadTexture,maskEntries,lights}) {
 const state={shaderCompiles:0,assetWarnings:[],irisGlowStrength:settings.iris,gameExposureEV:settings.exposure,fabricDetailStrength:settings.fabricDetail,legStructureStrength:settings.legStructure,hairDiskCandidate:false,hairView:0,hairSlot:'both',mask:settings.manualMask,faceSelection:null};
 const $=id=>id==='hairMaskView'?{checked:settings.hairMaskView}:{value:settings.hairMaskStrength};
 const compiled=[],hairShaders=[],irisShaders=[],outfitDetailShaders=[],legStructureShaders=[];
 const outfitMaps=new Map(),outfitBaseMaps=new Map();
 const areaRecords=manifest.lights.map(l=>({sourceShape:l.shape}));
 const masks=await prepareTextures(maskEntries,m=>loadTexture(m.url,m.sha256));
 for(const t of masks){t.colorSpace=THREE.NoColorSpace;t.flipY=false;t.wrapS=t.wrapT=THREE.RepeatWrapping;}
 const originals=Array.isArray(model.material)?model.material:[model.material];
 const colorSpaces=new Map();
 for(const m of originals)if(m.map&&!colorSpaces.has(m.map)){colorSpaces.set(m.map,m.map.colorSpace);m.map.colorSpace=THREE.SRGBColorSpace;m.map.needsUpdate=true;}
 const inputs=originals.map(m=>{const c=m.clone();if(isKoledaMaskMaterialName(c.name)||manifest.referenceVisiblePolygonCounts?.[c.name]===0)c.visible=false;return c;});
 const priorMask=model.geometry.getAttribute('gameHairMask'),priorFront=model.geometry.getAttribute('frontPurpleMask');
 const mask=buildHairRegionMask(model.geometry,originals);
 model.geometry.setAttribute('gameHairMask',new THREE.BufferAttribute(mask.data,3));
 model.geometry.setAttribute('frontPurpleMask',new THREE.BufferAttribute(mask.frontData,1));
 let materials=[];
 const head=model.skeleton.bones.find(b=>b.name==='頭');model.updateMatrixWorld(true);
 const headRestInverse=head?.getWorldQuaternion(new THREE.Quaternion()).invert();
 const convert=([x,y,z])=>new THREE.Vector3(x,z,-y);
 const eyeNames=selectKoledaClosedEyeMorphNames(Object.keys(model.morphTargetDictionary||{}));
 const eyeSlots=eyeNames.map(n=>model.morphTargetDictionary[n]);
 const smileSlot=model.morphTargetDictionary?.['口角上げ'];
 const smileSlots=Number.isInteger(smileSlot)?[smileSlot]:[];
const glslVec=v=>'vec3('+v.map(x=>Number(x).toFixed(8)).join(',')+')';

async function prepareOutfitMaps(){
  const entries=[];
  for(const family of [1,2,4,5]){
    const paths=gameOutfitTexturePaths(family),maps={};
    outfitMaps.set(family,maps);
    for(const [kind,url] of Object.entries(paths))entries.push({family,maps,kind,url});
  }
  await prepareTextures(entries,async({family,maps,kind,url})=>{
    try{const texture=await loadTexture(url);texture.colorSpace=THREE.NoColorSpace;texture.flipY=false;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());maps[kind]=texture;}
    catch(error){throw new Error('服装组'+family+'纹理加载失败 '+url+': '+error.message);}
  });
  state.outfitMapsReady=[...outfitMaps.values()].every(m=>m.normal&&m.surface);
}
function outfitMaterialFor(original,profile){
  const maps=outfitMaps.get(profile.family)||{};
  let colorMap=original.map;
  if(colorMap){if(!outfitBaseMaps.has(colorMap.uuid)){const clone=colorMap.clone();clone.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());clone.needsUpdate=true;outfitBaseMaps.set(colorMap.uuid,clone);}colorMap=outfitBaseMaps.get(colorMap.uuid);}
  const material=new THREE.MeshPhysicalMaterial({name:original.name+' / game-outfit',map:colorMap,
    color:new THREE.Color().setRGB(...profile.tint),roughness:profile.roughness[1],metalness:0,ior:1.5,specularIntensity:0.64,
    normalMap:maps.normal||null,normalScale:new THREE.Vector2(profile.normalStrength,profile.normalStrength),
    side:original.side,opacity:original.opacity,transparent:profile.cutout?false:original.transparent,
    alphaTest:profile.cutout?0.35:(original.alphaTest||0.001),depthWrite:profile.cutout?true:original.depthWrite});
  material.visible=profile.restoreVisible?true:original.visible;material.userData.sourceMaterial=original.name;
  material.customProgramCacheKey=()=>original.name+':game-outfit:'+Boolean(maps.surface);
  material.onBeforeCompile=shader=>{
    state.shaderCompiles++;
    if(maps.surface){
      shader.uniforms.gameSurface={value:maps.surface};
      shader.fragmentShader='uniform sampler2D gameSurface;'+String.fromCharCode(10)+shader.fragmentShader;
      const anchors=['#include <map_fragment>','#include <roughnessmap_fragment>','#include <metalnessmap_fragment>'];
      if(anchors.some(a=>shader.fragmentShader.split(a).length!==2))throw new Error('服装材质接缝不唯一');
      shader.fragmentShader=shader.fragmentShader.replace(anchors[0],anchors[0]+String.fromCharCode(10)+'vec3 gameRmo=texture2D(gameSurface,vMapUv).rgb;diffuseColor.rgb*=mix(1.0,gameRmo.b,0.18);');
      if(profile.detailContrast&&colorMap){
        shader.uniforms.gameFabricDetail={value:state.fabricDetailStrength};
        shader.uniforms.gameFabricRenderScale={value:Math.max(1,renderer.getPixelRatio())};
        shader.uniforms.gameFabricTexel={value:new THREE.Vector2(1/colorMap.image.width,1/colorMap.image.height)};
        outfitDetailShaders.push(shader);
        shader.fragmentShader='uniform float gameFabricDetail;uniform vec2 gameFabricTexel;uniform float gameFabricRenderScale;'+String.fromCharCode(10)+shader.fragmentShader;
        const surfaceRead='vec3 gameRmo=texture2D(gameSurface,vMapUv).rgb;';
        shader.fragmentShader=shader.fragmentShader.replace(surfaceRead,surfaceRead+String.fromCharCode(10)+[
          'vec2 gameDetailStep=gameFabricTexel*1.75;',
          'vec3 gameDetailCenter=sampledDiffuseColor.rgb;',
          'vec3 gameDetailAverage=(texture2D(map,vMapUv+vec2(gameDetailStep.x,0.0)).rgb+texture2D(map,vMapUv-vec2(gameDetailStep.x,0.0)).rgb+texture2D(map,vMapUv+vec2(0.0,gameDetailStep.y)).rgb+texture2D(map,vMapUv-vec2(0.0,gameDetailStep.y)).rgb)*0.25;',
          'float gameDetailY=dot(gameDetailCenter,vec3(0.2126,0.7152,0.0722));float gameAverageY=dot(gameDetailAverage,vec3(0.2126,0.7152,0.0722));',
          'float gameDetailDelta=(gameDetailY-gameAverageY)/max(gameAverageY,0.02);',
          'float gameDetailEdge=1.0-smoothstep(0.06,0.22,abs(gameDetailDelta));',
          'float gameDetailFootprint=max(length(dFdx(vMapUv)/gameFabricTexel),length(dFdy(vMapUv)/gameFabricTexel))*gameFabricRenderScale;',
          'float gameDetailFade=1.0-smoothstep('+FABRIC_FADE_START.toFixed(8)+','+FABRIC_FADE_END.toFixed(8)+',gameDetailFootprint);',
          'float gameFabricMask=1.0-smoothstep(0.25,0.75,gameRmo.g);',
          'diffuseColor.rgb*=clamp(1.0+gameDetailDelta*gameDetailEdge*gameDetailFade*gameFabricMask*gameFabricDetail*'+Number(profile.detailContrast).toFixed(8)+',0.65,1.35);',
        ].join(String.fromCharCode(10)));
      }
      shader.fragmentShader=shader.fragmentShader.replace(anchors[1],anchors[1]+String.fromCharCode(10)+'float gameFabricRough=mix('+profile.roughness[0].toFixed(8)+','+profile.roughness[1].toFixed(8)+',gameRmo.r);float gameMetalRough=mix('+profile.metalRoughness[0].toFixed(8)+','+profile.metalRoughness[1].toFixed(8)+',gameRmo.r);roughnessFactor=mix(gameFabricRough,gameMetalRough,smoothstep(0.25,0.75,gameRmo.g));');
      shader.fragmentShader=shader.fragmentShader.replace(anchors[2],anchors[2]+String.fromCharCode(10)+'metalnessFactor=gameRmo.g*'+profile.metalMax.toFixed(8)+';');
      if(original.name==='Cth2-Pants'){installGameLegStructure(shader,state.legStructureStrength,Math.max(1,renderer.getPixelRatio()));legStructureShaders.push(shader);}
    }
  };
  return material;
}

function materialFor(original,mode){
  const outfit=mode==='game'?gameOutfitProfile(original.name):null;
  if(outfit)return outfitMaterialFor(original,outfit);
  const name=original.name,source=mode==='game'?gameReferenceProfile(name,manifest.materials[name]):manifest.materials[name];
  if(!source){
    // 非目标槽只展示PMX基础贴图，不宣称其原着色或Blender材质已迁移。
    const base=new THREE.MeshBasicMaterial({name:name+' / 原贴图展示',map:original.map,color:original.color,side:original.side,transparent:original.transparent,opacity:original.opacity,alphaTest:original.alphaTest||0.001});
    base.visible=original.visible;return base;
  }
  const hair=name==='HairA'||name==='HairB';
  const target=mode==='target'||mode==='game';
  const roughness=hair&&mode!=='game'?0.34:source.roughness;
  const m=new THREE.MeshPhysicalMaterial({
    name:name+' / '+mode,map:original.map,color:new THREE.Color().setRGB(...source.tint),
    roughness,metalness:0,ior:1.5,specularIntensity:Math.min(1,2*(hair&&mode!=='game'?0.38:source.specularLevel)),
    side:original.side,alphaTest:original.alphaTest||0.001,transparent:original.transparent,opacity:original.opacity,depthWrite:original.depthWrite,
  });
  m.visible=mode==='game'?gameReferenceVisible(name,original.visible):original.visible;
  if(m.map)m.map.colorSpace=THREE.SRGBColorSpace;
  m.userData.sourceMaterial=name;
  m.customProgramCacheKey=()=>['v14d-head-candidate',mode,name].join(':');
  m.onBeforeCompile=shader=>{
    state.shaderCompiles++;
    if(mode==='game'&&name==='Eyes'){installGameIrisGlow(shader,state.irisGlowStrength);irisShaders.push(shader);}
    if(mode==='game'&&hair){
      installHairRegionVertex(shader);
      shader.uniforms.gameHairMaskView={value:$('hairMaskView').checked?1:0};
      shader.uniforms.gameHairMaskStrength={value:Number($('hairMaskStrength').value)};
      const anchor='#include <map_fragment>';
      if(!shader.fragmentShader.includes(anchor))throw new Error('头发贴图接缝缺失');
      shader.fragmentShader=shader.fragmentShader.replace(anchor,anchor+HAIR_REGION_MAP_GLSL);
    }
    if(name==='Face'){
      shader.uniforms.faceMaskA={value:masks[state.faceSelection?.layerA??state.mask]};
      shader.uniforms.faceMaskB={value:masks[state.faceSelection?.layerB??state.mask]};
      shader.uniforms.faceBlend={value:state.faceSelection?.weight??0};compiled.push(shader);
      shader.fragmentShader='uniform sampler2D faceMaskA; uniform sampler2D faceMaskB; uniform float faceBlend;'+String.fromCharCode(10)+shader.fragmentShader;
      const anchor='#include <map_fragment>';
      if(!shader.fragmentShader.includes(anchor))throw new Error('面部贴图接缝缺失');
      shader.fragmentShader=shader.fragmentShader.replace(anchor,anchor+String.fromCharCode(10)+[
        '#ifdef USE_MAP',
        'vec4 artMask = mix(texture2D(faceMaskA, vMapUv),texture2D(faceMaskB, vMapUv),faceBlend);',
        'float artValid = 1.0-artMask.b;',
        'diffuseColor.rgb *= mix(vec3(1.0),vec3(0.66,0.58,0.60),artMask.r*artValid);',
        'diffuseColor.rgb *= mix(vec3(1.0),vec3(0.70,0.64,0.69),artMask.g*artValid);',
        '#endif',
      ].join(String.fromCharCode(10)));
    }
    if(target&&(source.emissionBranch==='ramp'||source.emissionBranch==='masked-face-color')){
      // Face最终发光支路直接消费遮罩后的颜色，未连接的历史Ramp不能加入配方。
      // Hair/BodySkin仍保留真正连接到发光支路的Ramp。
      const ramp=source.ramp;
      let lines=(source.emissionBranch==='masked-face-color'?[
        'outgoingLight = mix(outgoingLight,diffuseColor.rgb,'+Number(source.toonMix).toFixed(8)+');',
      ]:[
        'vec3 whiteDiffuse = totalDiffuse / max(diffuseColor.rgb,vec3(0.00001));',
        'float lightValue = dot(whiteDiffuse,vec3(0.2126,0.7152,0.0722));',
        'vec3 toonColor = '+glslVec(ramp[0].color)+';',
        ...ramp.slice(1).map(e=>'if(lightValue >= '+Number(e.position).toFixed(8)+') toonColor = '+glslVec(e.color)+';'),
        'outgoingLight = mix(outgoingLight,diffuseColor.rgb*toonColor,'+Number(source.toonMix).toFixed(8)+');',
      ]).join(String.fromCharCode(10));
      if(hair){
        if(mode==='game')lines+=HAIR_REGION_OUTPUT_GLSL;
        installHairDiskCandidate(shader,areaRecords.map(a=>a.sourceShape==='DISK'?1:0),state.hairDiskCandidate);
        shader.uniforms.hairView={value:state.hairSlot==='both'||state.hairSlot===name?state.hairView:0};hairShaders.push({shader,name});
        shader.fragmentShader='uniform int hairView;'+String.fromCharCode(10)+shader.fragmentShader;
        lines+=String.fromCharCode(10)+[
          'if(hairView==1) outgoingLight=diffuseColor.rgb;',
          'else if(hairView==2) outgoingLight=totalDiffuse+totalSpecular;',
          'else if(hairView==3) outgoingLight=diffuseColor.rgb*toonColor;',
          'else if(hairView==4) outgoingLight=totalSpecular*'+Number(1-source.toonMix).toFixed(8)+';',
        ].join(String.fromCharCode(10));
      }
      const anchor='#include <opaque_fragment>';
      if(!shader.fragmentShader.includes(anchor))throw new Error('明暗合成接缝缺失');
      shader.fragmentShader=shader.fragmentShader.replace(anchor,lines+String.fromCharCode(10)+anchor);
    }
    if(mode==='game'&&name==='Face')installGameFaceLineSoftening(shader);
  };
  return m;
}

 function dispose(){for(const m of materials)m.dispose();for(const m of inputs)m.dispose();for(const t of outfitBaseMaps.values())t.dispose();for(const [t,colorSpace] of colorSpaces){t.colorSpace=colorSpace;t.needsUpdate=true;}if(priorMask)model.geometry.setAttribute('gameHairMask',priorMask);else model.geometry.deleteAttribute('gameHairMask');if(priorFront)model.geometry.setAttribute('frontPurpleMask',priorFront);else model.geometry.deleteAttribute('frontPurpleMask');}
 try{await prepareOutfitMaps();for(const m of inputs)materials.push(materialFor(m,'game'));}catch(error){dispose();throw error;}
 function update(){
  for(const light of lights)light.visible=settings.lightingEnabled;
  const key=lights.find(l=>l.name==='PROTO_Key');
  if(head&&key&&manifest.faceSelector){model.updateMatrixWorld(true);const rotation=head.getWorldQuaternion(new THREE.Quaternion()).multiply(headRestInverse);const forward=convert(manifest.faceSelector.neutralForward).applyQuaternion(rotation).normalize();const up=convert(manifest.faceSelector.neutralUp).applyQuaternion(rotation).normalize();const right=new THREE.Vector3().crossVectors(forward,up).normalize();const direction=key.getWorldPosition(new THREE.Vector3()).sub(head.getWorldPosition(new THREE.Vector3())).normalize();const angle=THREE.MathUtils.radToDeg(Math.atan2(direction.dot(right),direction.dot(forward)));state.faceSelection=settings.autoFace?selectFaceShadow(angle,state.faceSelection?.state??2,manifest.faceSelector):{layerA:settings.manualMask,layerB:settings.manualMask,weight:0};
   for(const s of compiled){s.uniforms.faceMaskA.value=masks[state.faceSelection.layerA];s.uniforms.faceMaskB.value=masks[state.faceSelection.layerB];s.uniforms.faceBlend.value=state.faceSelection.weight;}}
  for(const s of outfitDetailShaders){s.uniforms.gameFabricDetail.value=settings.fabricDetail;s.uniforms.gameFabricRenderScale.value=Math.max(1,renderer.getPixelRatio());}
  for(const s of legStructureShaders){s.uniforms.gameLegStructure.value=settings.legStructure;s.uniforms.gameLegRenderScale.value=Math.max(1,renderer.getPixelRatio());}
  for(const {shader:s} of hairShaders){s.uniforms.gameHairMaskStrength.value=settings.hairMaskStrength;s.uniforms.gameHairMaskView.value=settings.hairMaskView?1:0;}
  for(const s of irisShaders)s.uniforms.gameIrisGlowStrength.value=settings.iris;
 }
 return {materials,dispose,update,draw(draw,{speaking=false}={}){update();return withMorphOverride(model.morphTargetInfluences,smileSlots,speaking?null:settings.smile,()=>withMorphOverride(model.morphTargetInfluences,eyeSlots,eyePreviewWeight(settings.closedEye,0),draw)).result.result;},evidence:()=>({sourceCommit:'cd973980e08e09739d620cc948472638a4e1c7f2',maskCount:masks.length,materialCount:materials.length,physicalCount:materials.filter(m=>m.isMeshPhysicalMaterial).length,shaderCompiles:state.shaderCompiles,faceSelection:state.faceSelection,hairMask:mask.summary})};
}
