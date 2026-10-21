// 仅为用户两张截图的美术试调；不得回写冻结Blender参数。
export {buildHairRegionMask,installHairRegionVertex,HAIR_REGION_MAP_GLSL,HAIR_REGION_OUTPUT_GLSL} from './hairRegionMask.mjs';
export function gameReferenceProfile(name,source){
  if(!source)return source;
  if(name==='Face')return {...source,tint:[1.14,1.045,1.0],toonMix:0.91};
  // 恢复原版头发染色和色阶；只返回副本，不修改冻结来源。
  if(name==='HairA'||name==='HairB')return {...source,tint:source.tint.slice(),roughness:0.34,specularLevel:0.38,
    ramp:source.ramp.map(r=>({...r,color:r.color.slice()}))};
  return source;
}
export function gameReferenceVisible(name,originalVisible){return name==='Eyes+'?false:originalVisible;}
export const GAME_HAIR_TEXTURE_SOFTEN=0.20;
export function installGameFaceLineSoftening(shader){
  const anchor='#include <opaque_fragment>';
  if(shader.fragmentShader.split(anchor).length!==2||shader.fragmentShader.includes('float gameNoseLine='))throw new Error('鼻口柔化接缝不唯一');
  shader.fragmentShader=shader.fragmentShader.replace(anchor,[
    '#ifdef USE_MAP',
    'float gameNoseLine=(1.0-smoothstep(0.012,0.030,abs(vMapUv.x-0.5)))*(1.0-smoothstep(0.025,0.055,abs(vMapUv.y-0.05)));',
    'float gameMouthLine=1.0-smoothstep(0.70,1.0,length((vMapUv-vec2(0.5,0.865))/vec2(0.105,0.018)));',
    'float gameFeatureDark=1.0-smoothstep(0.04,0.40,dot(outgoingLight,vec3(0.2126,0.7152,0.0722)));',
    'vec3 gameFeatureFloor=mix(vec3(0.22,0.12,0.10),vec3(0.34,0.22,0.20),gameMouthLine);',
    'outgoingLight=mix(outgoingLight,max(outgoingLight,gameFeatureFloor),max(gameNoseLine,gameMouthLine)*gameFeatureDark*0.65);',
    '#endif',anchor,
  ].join(String.fromCharCode(10)));
}
export const GAME_EXPOSURE_EV=-0.35;
export function validateGameExposure(value){if(typeof value!=='number'||!Number.isFinite(value)||value< -2||value>1)throw new Error('游戏版曝光必须为-2到1的有限数');return value;}
export function gameExposureForMode(mode,gameExposure,referenceExposure){return mode==='game'?validateGameExposure(gameExposure):referenceExposure;}
export function validateFabricDetail(value){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>2)throw new Error('织纹对比必须为0到2的有限数');return value;}
export const FABRIC_FADE_START=0.75;
export const FABRIC_FADE_END=1.75;
export function fabricSamplingWeight(texelFootprint,renderScale=1){
  if(typeof texelFootprint!=='number'||!Number.isFinite(texelFootprint)||texelFootprint<0||typeof renderScale!=='number'||!Number.isFinite(renderScale)||renderScale<=0)throw new Error('织纹采样密度非法');
  const footprint=texelFootprint*Math.max(1,renderScale),t=Math.min(1,Math.max(0,(footprint-FABRIC_FADE_START)/(FABRIC_FADE_END-FABRIC_FADE_START)));
  return 1-t*t*(3-2*t);
}
export function validateLegStructure(value){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>2)throw new Error('纵向细线强度必须为0到2的有限数');return value;}
export function installGameLegStructure(shader,strength,renderScale){
  validateLegStructure(strength);if(!Number.isFinite(renderScale)||renderScale<1)throw new Error('裤腿显示比例非法');
  const anchor='vec3 gameRmo=texture2D(gameSurface,vMapUv).rgb;';
  const outputAnchor='#include <opaque_fragment>';
  if(shader.fragmentShader.split(anchor).length!==2||shader.fragmentShader.split(outputAnchor).length!==2||shader.fragmentShader.includes('uniform float gameLegStructure'))throw new Error('裤腿细线接缝不唯一');
  shader.uniforms.gameLegStructure={value:strength};shader.uniforms.gameLegRenderScale={value:renderScale};
  shader.fragmentShader='uniform float gameLegStructure;uniform float gameLegRenderScale;'+String.fromCharCode(10)+shader.fragmentShader.replace(anchor,anchor+String.fromCharCode(10)+[
    'float gameLegD0=vMapUv.x-0.320;float gameLegD1=vMapUv.x-0.487;',
    'float gameLegD=abs(gameLegD0)<abs(gameLegD1)?gameLegD0:gameLegD1;',
    'float gameLegRegion=smoothstep(0.270,0.285,vMapUv.y)*(1.0-smoothstep(0.700,0.718,vMapUv.y));',
    'float gameLegWidth=max(0.0012,fwidth(vMapUv.x)*gameLegRenderScale*0.75);',
    'float gameLegLine=(1.0-smoothstep(gameLegWidth*0.45,gameLegWidth*1.40,abs(gameLegD)))*min(1.0,0.004/gameLegWidth);',
    'float gameLegMask=gameLegRegion*(1.0-smoothstep(0.25,0.75,gameRmo.g));',
  ].join(String.fromCharCode(10)));
  shader.fragmentShader=shader.fragmentShader.replace(outputAnchor,'outgoingLight*=max(0.18,1.0-gameLegStructure*gameLegMask*gameLegLine*0.55);'+String.fromCharCode(10)+outputAnchor);
}

export function validateIrisGlowStrength(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>2)throw new Error('虹膜亮弧强度必须为0到2的有限数');
  return value;
}
export function installGameIrisGlow(shader,strength){
  validateIrisGlowStrength(strength);
  const anchor='#include <opaque_fragment>';
  if(shader.fragmentShader.split(anchor).length!==2||shader.fragmentShader.includes('uniform float gameIrisGlowStrength'))throw new Error('虹膜亮弧接缝不唯一');
  shader.uniforms.gameIrisGlowStrength={value:strength};
  shader.fragmentShader='uniform float gameIrisGlowStrength;'+String.fromCharCode(10)+shader.fragmentShader.replace(anchor,[
    '#ifdef USE_MAP',
    'vec2 irisP=(vMapUv-vec2(0.5,0.49))*vec2(1.0,1.02);',
    'float irisR=length(irisP);',
    'float irisGate=smoothstep(0.12,0.15,irisR)*(1.0-smoothstep(0.36,0.43,irisR));',
    'float irisArc=exp(-pow((irisR-0.21)/0.042,2.0))*smoothstep(-0.035,0.075,irisP.y)*irisGate;',
    'float irisFill=smoothstep(0.14,0.21,irisR)*(1.0-smoothstep(0.34,0.46,irisR))*smoothstep(-0.025,0.13,irisP.y);',
    'vec2 irisVioletP=(irisP-vec2(0.0,0.30))*vec2(6.0,11.0);',
    'float irisViolet=exp(-dot(irisVioletP,irisVioletP))*irisGate;',
    'vec2 irisGlintP=(irisP-vec2(-0.14,0.005))/vec2(0.020,0.011);',
    'float irisGlint=exp(-dot(irisGlintP,irisGlintP));',
    'outgoingLight+=gameIrisGlowStrength*(vec3(0.015,1.0,2.2)*irisArc+vec3(0.01,0.08,0.22)*irisFill+vec3(0.28,0.012,0.62)*irisViolet+vec3(1.3,1.4,1.55)*irisGlint);',
    '#endif',anchor,
  ].join(String.fromCharCode(10)));
}

// 服装名称为实际PMX槽；只在game模式使用。R/G/B用途按只读Blend连接核对，
// 本地normalmap目录素材与失联的Blend原路径未证明同源，因此仍是美术候选。
const OUTFIT={
  'Cth1-Top':{family:1,tint:[0.90,0.93,0.97],roughness:[0.56,0.88],metalMax:0.82,normalStrength:0.40,detailContrast:1.4},
  'Cth1-Glove':{family:1,tint:[0.90,0.91,0.98],roughness:[0.42,0.84],metalMax:0.52,normalStrength:0.28},
  'Cth1-Cape':{family:1,tint:[0.74,0.79,0.92],roughness:[0.54,0.86],metalMax:0.75,normalStrength:0.55,detailContrast:0.9,restoreVisible:true,cutout:true},
  'Cth1-Cape2':{family:1,tint:[0.74,0.79,0.92],roughness:[0.54,0.86],metalMax:0.75,normalStrength:0.55,detailContrast:0.9,restoreVisible:true,cutout:true},
  'Cth2-Pants':{family:2,tint:[0.84,0.86,0.91],roughness:[0.40,0.90],metalMax:0.85,normalStrength:0.50,detailContrast:2.6},
  'Cth2-Shoes':{family:2,tint:[0.90,0.92,0.98],roughness:[0.36,0.82],metalMax:0.72,normalStrength:0.34},
  'Cth2-Pouch':{family:2,tint:[0.9,0.92,0.98],roughness:[0.36,0.82],metalMax:0.72,normalStrength:0.34},
  'Cth4-Glove':{family:4,tint:[0.94,0.95,1],roughness:[0.36,0.82],metalMax:0.72,normalStrength:0.34},
  'Cth5-ShoesZip':{family:5,tint:[1,1,1],roughness:[0.36,0.82],metalMax:0.72,normalStrength:0.34},
};
export function gameOutfitProfile(name){const p=Object.hasOwn(OUTFIT,name)?OUTFIT[name]:null;return p?{...p,tint:p.tint.slice(),roughness:p.roughness.slice(),metalRoughness:[0.18,0.40]}:null;}
export function gameOutfitTexturePaths(family){
  if(![1,2,4,5].includes(family))throw new Error('未知服装贴图组');
  return {normal:'/model/normalmap/c_KoledaSSR01_slg_cloth'+family+'_n.png',surface:'/model/normalmap/c_koledassr01_slg_cloth'+family+'_rmo_06_11_2026.png'};
}
