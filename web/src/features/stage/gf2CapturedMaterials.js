import * as THREE from 'three';
import { loadGf2CapturedResources } from './gf2CapturedResources.js';

// 绘制编号来自兵营第 7480 帧的真实绑定；同贴图的多个 PMX 分区共用原材质。
import { DRAW_BY_MATERIAL, SHADOW_BY_DRAW, OUTLINE_BY_DRAW, getGf2ResourceInputs } from './gf2CapturedResourcePlan.js';
const C=new THREE.Matrix4().makeScale(1,1,-1);
const POST_VERTEX='varying vec2 screenUv;void main(){screenUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
const POST_FRAGMENT=`precision highp float;
uniform sampler2D sceneColor;uniform sampler2D colorLut;uniform float exposure;uniform bool transparentOutput;varying vec2 screenUv;
void main(){vec4 src=texture2D(sceneColor,screenUv);if(transparentOutput&&src.a>.000001)src.rgb/=src.a;vec3 v=clamp(log2(max(src.rgb*exposure*5.55555582+.047996,vec3(.000001)))*.0734997839+.386036009,0.,1.);
vec3 p=v*31.;float slice=floor(p.b);vec2 uvLut=vec2((p.r+.5)/1024.+slice/32.,(p.g+.5)/32.);
vec3 c=mix(texture2D(colorLut,uvLut).rgb,texture2D(colorLut,uvLut+vec2(1./32.,0.)).rgb,p.b-slice);
gl_FragColor=vec4(c,src.a);
#include <colorspace_fragment>
if(transparentOutput)gl_FragColor.rgb*=src.a;
}`;

function replaceBlockReads(source,prefix){
 source=source.replace(/layout\(std140\) uniform \w+\s*\{[^}]+\} cb(\d+)_0;/g,(_,slot)=>`uniform highp usampler2D ${prefix}${slot};\nvec4 ${prefix}Read${slot}(int i){return uintBitsToFloat(texelFetch(${prefix}${slot},ivec2(i,0),0));}`);
 // 原程序包含动态索引，按括号深度读取，保留整个索引表达式。
 const pattern=/cb(\d+)_0\._m0\[/g;let match;
 while((match=pattern.exec(source))){let end=pattern.lastIndex,depth=1;while(depth){const ch=source[end++];if(ch==='[')depth++;if(ch===']')depth--;}
  source=source.slice(0,match.index)+`${prefix}Read${match[1]}(int(${source.slice(pattern.lastIndex,end-1)}))`+source.slice(end);pattern.lastIndex=match.index;
 }
 return source;
}

export async function createGf2CapturedMaterials(mesh,root,{fetchImpl=fetch,transparentOutput=false,onProgress,resourceMode='bundle'}={}){
 const started=performance.now(),timings={resourceMode,started};
 const base=new URL(root,location.href),cache=new Map(),requests=new Map(),owned=[],blockStates=[],originals=mesh.material;
 let get=async(name,type='arrayBuffer')=>{
  const key=name+':'+type;if(!requests.has(key))requests.set(key,(async()=>{const r=await fetchImpl(new URL(name,base));if(!r.ok)throw new Error(`抓帧资源 ${name} 返回 ${r.status}`);return r[type]();})());
  const value=await requests.get(key);return type==='arrayBuffer'?value.slice(0):value;
 };
 if(resourceMode==='bundle')get=await loadGf2CapturedResources(base,fetchImpl,onProgress,timings);
 const manifest=await get('frame.json','json'),draws=new Map([...manifest.draws,...manifest.shadows].map(d=>[d.eventId,d]));
 if(resourceMode==='files'){
  const reference=await get('pmx-reference.json','json'),pending=getGf2ResourceInputs(manifest,reference);
  let next=0,loaded=0;onProgress?.({loaded,total:pending.length,unit:'文件'});
  await Promise.all(Array.from({length:6},async()=>{while(next<pending.length){const [name,type]=pending[next++];await get(name,type);loaded++;onProgress?.({loaded,total:pending.length,unit:'文件'});}}));
  timings.resourcesMs=performance.now()-started;timings.resourceCount=pending.length;timings.requestCount=pending.length;
 }
 const constructionStarted=performance.now();
 const reference=await get('pmx-reference.json','json'),referenceData=new Float32Array(await get(reference.file)),referenceParts=await get('pmx-reference-parts.json','json'),referencePose={value:false};
 if(reference.vertexCount!==mesh.geometry.attributes.position.count)throw new Error('原帧姿态数据与当前PMX顶点数量不一致');
 const referenceBuffer=new THREE.InterleavedBuffer(referenceData,reference.strideFloats);
 const activeMorphs=new Array(mesh.geometry.morphAttributes.position?.length||0).fill(0);
 for(const [name,size,offset]of[['Position',3,0],['Normal',3,3],['Tangent',4,6],['Color',4,10],['Uv',4,14],['Valid',1,18]])mesh.geometry.setAttribute('gf2Reference'+name,new THREE.InterleavedBufferAttribute(referenceBuffer,size,offset));
 const shadowTargets=[4096,512].map(size=>{
  const depth=new THREE.DepthTexture(size,size,THREE.UnsignedShortType);depth.compareFunction=THREE.LessCompare;depth.minFilter=depth.magFilter=THREE.LinearFilter;
  return new THREE.WebGLRenderTarget(size,size,{depthTexture:depth,depthBuffer:true,stencilBuffer:false});
 });
 const stats={bound:[],retained:[],textureCount:0,shaderCompiles:0,mode:'game',sourceFrame:7480,reference,referencePose:false,timings};
 const globals=[],headBlocks=[],head=mesh.skeleton.bones.find(b=>b.name==='頭'),headCalibration=await get('head-calibration.json','json');
 const headBindQuaternion=new THREE.Quaternion();head.getWorldQuaternion(headBindQuaternion);headBindQuaternion.invert();
 const basis3=new THREE.Matrix3().fromArray(headCalibration.rotationColumnMajor),headBasis=new THREE.Matrix4().setFromMatrix3(basis3);
 stats.headCalibration=headCalibration;
 async function block(file,prefix,slot,shadow){
  const bytes=await get(file),words=new Uint32Array(bytes),texture=new THREE.DataTexture(words,words.length/4,1,THREE.RGBAIntegerFormat,THREE.UnsignedIntType);
  texture.internalFormat='RGBA32UI';texture.needsUpdate=true;owned.push(texture);
  const data=new Float32Array(bytes),record={data,texture,prefix,slot,captured:data.slice()};blockStates.push(record);if(slot===0&&!shadow)globals.push(record);
  if(prefix==='vertexCB'&&slot===1){
   // 顶点先经过 MMD 蒙皮并换算到 Unity 世界坐标，原顶点程序的对象矩阵置为单位矩阵。
   data.set(new THREE.Matrix4().elements,0);if(data.length>=32)data.set(new THREE.Matrix4().elements,16);
   if(data.length>39)data[39]=1;
   if(data.length>128)data[128]=0;
  }
  return texture;
 }
 async function texture(id,sampler){
  if(id==='ResourceId::8076')return shadowTargets[0].depthTexture;
  if(id==='ResourceId::8733')return shadowTargets[1].depthTexture;
  const t=manifest.textures[id],key=id+':'+JSON.stringify(sampler);if(cache.has(key))return cache.get(key);
  const promise=(async()=>{
   let result;const levels=[];
   for(const s of t.subresources){const raw=await get(s.file);levels.push({...s,width:Math.max(1,t.width>>s.mip),height:Math.max(1,t.height>>s.mip),data:new Uint8Array(raw)});}
   const compressed={BC1_SRGB:THREE.RGB_S3TC_DXT1_Format,BC6_UFLOAT:THREE.RGB_BPTC_UNSIGNED_Format,BC7_SRGB:THREE.RGBA_BPTC_Format,BC7_UNORM:THREE.RGBA_BPTC_Format};
   if(t.cubemap){const faces=Array.from({length:6},(_,i)=>({width:t.width,height:t.height,mipmaps:levels.filter(l=>l.slice===i)}));result=new THREE.CompressedCubeTexture(faces,compressed[t.format]);}
   else if(compressed[t.format])result=new THREE.CompressedTexture(levels,t.width,t.height,compressed[t.format]);
   else if(t.format==='R16_TYPELESS'){
    result=new THREE.DataTexture(new Uint16Array(levels[0].data.buffer),t.width,t.height,THREE.DepthFormat,THREE.UnsignedShortType);result.internalFormat='DEPTH_COMPONENT16';result.compareFunction=THREE.GreaterCompare;
   }else if(t.format.includes('R16G16B16A16'))result=new THREE.DataTexture(new Uint16Array(levels[0].data.buffer),t.width,t.height,THREE.RGBAFormat,THREE.HalfFloatType);
   else result=new THREE.DataTexture(levels[0].data,t.width,t.height,THREE.RGBAFormat,THREE.UnsignedByteType);
   result.colorSpace=t.format.endsWith('SRGB')?THREE.SRGBColorSpace:THREE.NoColorSpace;result.flipY=false;result.generateMipmaps=false;
   const wrap=[THREE.RepeatWrapping,THREE.MirroredRepeatWrapping,THREE.ClampToEdgeWrapping,THREE.ClampToEdgeWrapping];
   result.wrapS=wrap[sampler.addressU];result.wrapT=wrap[sampler.addressV];result.magFilter=sampler.filter.magnify===1?THREE.NearestFilter:THREE.LinearFilter;
   result.minFilter=t.mips===1?(sampler.filter.minify===1?THREE.NearestFilter:THREE.LinearFilter):(sampler.filter.mip===1?THREE.LinearMipmapNearestFilter:THREE.LinearMipmapLinearFilter);
   result.anisotropy=sampler.maxAnisotropy||1;result.needsUpdate=true;owned.push(result);stats.textureCount++;return result;
  })();cache.set(key,promise);return promise;
 }
 mesh.geometry.computeTangents();
 const colors=new Float32Array(mesh.geometry.attributes.position.count*4),colorCache=new Map();stats.vertexColors=[];
 for(let i=0;i<colors.length;i+=4)colors.set([.5,.5,1,1],i);
 const nearestHalf=x=>{
  const h=THREE.DataUtils.toHalfFloat(x),a=THREE.DataUtils.fromHalfFloat(h),b=THREE.DataUtils.fromHalfFloat(h+1),da=Math.abs(x-a),db=Math.abs(x-b);
  return db<da||(db===da&&(h&1))?h+1:h;
 };
 const uv=mesh.geometry.attributes.uv,uvKey=(x,y)=>nearestHalf(x)+','+nearestHalf(y);
 for(const group of mesh.geometry.groups){
  const original=originals[group.materialIndex],eid=DRAW_BY_MATERIAL[original.name],colorId=eid===3368?3356:eid,file=manifest.vertexColors[colorId];if(!file)continue;
  if(!colorCache.has(file)){
   const data=new Float32Array(await get(file)),map=new Map();
   for(let i=0;i<data.length;i+=8){const key=uvKey(data[i],data[i+1]),previous=map.get(key);if(!previous)map.set(key,{color:data.slice(i+4,i+8),count:1});else{for(let j=0;j<4;j++)previous.color[j]+=data[i+j+4];previous.count++;}}
   for(const value of map.values())for(let i=0;i<4;i++)value.color[i]/=value.count;colorCache.set(file,map);
  }
  const map=colorCache.get(file),seen=new Set();let matched=0;
  for(let i=group.start;i<group.start+group.count;i++){const vertex=mesh.geometry.index.getX(i);if(seen.has(vertex))continue;seen.add(vertex);const value=map.get(uvKey(uv.getX(vertex),1-uv.getY(vertex)));if(value){colors.set(value.color,vertex*4);matched++;}}
  stats.vertexColors.push({material:original.name,matched,total:seen.size});
 }
 mesh.geometry.setAttribute('gf2Color',new THREE.BufferAttribute(colors,4));
 for(let i=0;i<reference.vertexCount;i++)if(referenceData[i*reference.strideFloats+18])colors.set(referenceData.subarray(i*reference.strideFloats+10,i*reference.strideFloats+14),i*4);
 async function materialFor(original,overrideId,shadow=false,outline=false){
  const eid=overrideId??DRAW_BY_MATERIAL[original.name];if(!eid){if(!shadow)stats.retained.push(original.name);return original;}
  const d=draws.get(eid),uniforms={gf2ReferencePose:referencePose},vertexBuffers=[];
  for(const [list,prefix]of[[d.blocks,'pixelCB'],[d.vertexBlocks,'vertexCB']])for(const b of list){
   const tex=await block(b.file,prefix,b.slot,shadow);uniforms[prefix+b.slot]={value:tex};if(prefix==='vertexCB')vertexBuffers.push(blockStates.at(-1));
   if(!shadow&&!outline&&b.slot===1&&((prefix==='pixelCB'&&[2500,2510,2685].includes(eid))||(prefix==='vertexCB'&&eid===2539)))headBlocks.push(blockStates.at(-1));
  }
  let vs=(await get(d.vertexShader,'text')).replace(/^#version 300 es\s*/,'');
  let fs=(await get(d.fragment,'text')).replace(/^#version 300 es\s*/,'').replace('precision mediump float;','precision highp float;');
  if(eid===2539)vs=vs.replace(/(\w+)\.([xyz]) = dot\(v1, cb1_0\._m0\[[456]u\]\.xyz\);/g,(_,name,component)=>`${name}.${component}=v1.${component};`);
  vs=replaceBlockReads(vs,'vertexCB');fs=replaceBlockReads(fs,'pixelCB');
  const declarations=[];
  vs=vs.replace(/layout\(location = (\d+)\) in (\w+) v(\d+);/g,(_,loc,type,reg)=>{declarations.push({reg:+reg,type});return `${type} sourceInput${reg};`;});
  vs=vs.replace(/\bv(\d+)\b/g,'sourceInput$1').replace(/\bo(\d+)\b/g,'captureV$1').replace('void main()','void sourceVertex()');
  fs=fs.replace(/\bv(\d+)\b/g,(whole,index)=>{
   const input=d.inputs.find(s=>s.register===+index),output=d.attributes.find(s=>s.semantic===input?.semantic);return output?'captureV'+output.register:whole;
  });
  fs=fs.replace(/layout\(location = ([12])\) out highp vec4 (o\d+);/g,'highp vec4 $2;');
  const shadowSamplers=[...fs.matchAll(/uniform highp sampler2DShadow (\w+);/g)].map(m=>m[1]);
  if(shadowSamplers.length){
   for(const name of shadowSamplers)fs=fs.replaceAll(`textureLod(${name},`,`captureShadow(${name},`);
   fs=fs.replace('void main()',`float captureShadow(highp sampler2DShadow s,vec3 uv,float level){return textureLod(s,vec3(uv.xy,1.-uv.z),level);}\nvoid main()`);
  }
  for(const match of fs.matchAll(/uniform highp sampler\w+ (SPIRV_Cross_Combinedt(\d+)s(\d+));/g))uniforms[match[1]]={value:await texture(d.textures[match[2]],d.samplers[match[3]])};
  const inputs=declarations.map(({reg,type})=>{
   const semantic=d.vertexInputs.find(s=>s.register===reg)?.semantic;
   let expression;
   if(semantic==='POSITION')expression=type==='vec3'?'unityPosition':'vec4(unityPosition,1.)';
   else if(semantic==='NORMAL')expression='unityNormal';
   else if(semantic==='TANGENT')expression='vec4(unityTangent,sourceTangentW)';
   else if(semantic==='COLOR')expression='gf2Color';
   else if(semantic==='TEXCOORD'||semantic==='TEXCOORD0')expression='sourceUv.xy';
   else if(semantic==='TEXCOORD1')expression=type==='float'?'sourceUv.z':'sourceUv.zw';
   else if(semantic==='TEXCOORD4')expression='unityPosition';
   else expression=type+'(0.)';
   return `sourceInput${reg}=${expression};`;
  }).join('\n');
  vs=`#define USE_TANGENT\nattribute vec4 tangent;attribute vec2 gf2Uv;attribute vec4 gf2Color;\nuniform bool gf2ReferencePose;attribute vec3 gf2ReferencePosition;attribute vec3 gf2ReferenceNormal;attribute vec4 gf2ReferenceTangent;attribute vec4 gf2ReferenceUv;attribute float gf2ReferenceValid;\n#include <common>\n#include <morphtarget_pars_vertex>\n#include <skinning_pars_vertex>\n${vs}\nvoid main(){
  #include <morphinstance_vertex>
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  vec3 unityPosition=(modelMatrix*vec4(transformed,1.)).xyz*vec3(1.,1.,-1.);
  vec3 unityNormal=normalize(mat3(modelMatrix)*objectNormal)*vec3(1.,1.,-1.);
  vec3 unityTangent=normalize(mat3(modelMatrix)*objectTangent)*vec3(1.,1.,-1.);
  float sourceTangentW=tangent.w;
  vec4 sourceUv=gf2ReferenceValid>.5?gf2ReferenceUv:vec4(uv.x,1.-uv.y,gf2Uv.x,1.-gf2Uv.y);
  if(gf2ReferencePose&&gf2ReferenceValid>.5){unityPosition=gf2ReferencePosition;unityNormal=gf2ReferenceNormal;unityTangent=gf2ReferenceTangent.xyz;sourceTangentW=gf2ReferenceTangent.w;}
  ${inputs}
  sourceVertex();gl_Position.y=-gl_Position.y;gl_Position.z=gl_Position.w-2.*gl_Position.z;
 }`;
  const m=new THREE.ShaderMaterial({name:original.name,uniforms,vertexShader:vs,fragmentShader:fs,glslVersion:THREE.GLSL3,side:original.side,transparent:original.transparent,depthWrite:original.depthWrite,visible:original.visible,toneMapped:false});
  const suffix=value=>value.split('.').at(-1),depth=d.state.depthStencil,blend=d.state.blend[0];
  m.side={Back:THREE.FrontSide,Front:THREE.BackSide,NoCull:THREE.DoubleSide}[suffix(d.state.rasterizer.cullMode)];
  m.depthTest=depth.depthEnable;m.depthWrite=depth.depthWrites;
  m.depthFunc={Never:THREE.NeverDepth,AlwaysTrue:THREE.AlwaysDepth,Greater:THREE.LessDepth,GreaterEqual:THREE.LessEqualDepth,Less:THREE.GreaterDepth,LessEqual:THREE.GreaterEqualDepth,Equal:THREE.EqualDepth,NotEqual:THREE.NotEqualDepth}[suffix(depth.depthFunction)];
  // 所有原程序放在同一个排序队列；透明混合仍使用原系数，顺序由捕获事件决定。
  m.transparent=false;m.forceSinglePass=true;m.colorWrite=blend.writeMask!==0;m.blending=THREE.NoBlending;
  if(blend.enabled||blend.writeMask===7){
   const factors={Zero:THREE.ZeroFactor,One:THREE.OneFactor,SrcAlpha:THREE.SrcAlphaFactor,InvSrcAlpha:THREE.OneMinusSrcAlphaFactor,DstAlpha:THREE.DstAlphaFactor,InvDstAlpha:THREE.OneMinusDstAlphaFactor,DstCol:THREE.DstColorFactor,SrcCol:THREE.SrcColorFactor};
   m.blending=THREE.CustomBlending;
   m.blendSrc=factors[blend.colorBlend.source.split('.').at(-1)];m.blendDst=factors[blend.colorBlend.destination.split('.').at(-1)];
   m.blendSrcAlpha=factors[blend.alphaBlend.source.split('.').at(-1)];m.blendDstAlpha=factors[blend.alphaBlend.destination.split('.').at(-1)];
   if(blend.writeMask===7){m.blendSrcAlpha=THREE.ZeroFactor;m.blendDstAlpha=THREE.OneFactor;}
  }
  if(depth.stencilEnable&&!shadow){
   const stencil=m.side===THREE.BackSide?depth.backFace:depth.frontFace;
   const ops={Keep:THREE.KeepStencilOp,Zero:THREE.ZeroStencilOp,Replace:THREE.ReplaceStencilOp,IncSat:THREE.IncrementStencilOp,DecSat:THREE.DecrementStencilOp,Invert:THREE.InvertStencilOp,IncWrap:THREE.IncrementWrapStencilOp,DecWrap:THREE.DecrementWrapStencilOp};
   const compare={Never:THREE.NeverStencilFunc,AlwaysTrue:THREE.AlwaysStencilFunc,Equal:THREE.EqualStencilFunc,NotEqual:THREE.NotEqualStencilFunc,Less:THREE.LessStencilFunc,LessEqual:THREE.LessEqualStencilFunc,Greater:THREE.GreaterStencilFunc,GreaterEqual:THREE.GreaterEqualStencilFunc};
   m.stencilWrite=true;m.stencilRef=stencil.reference;m.stencilWriteMask=stencil.writeMask;m.stencilFuncMask=stencil.compareMask;m.stencilFunc=compare[suffix(stencil.function)];
   m.stencilFail=ops[suffix(stencil.failOperation)];m.stencilZFail=ops[suffix(stencil.depthFailOperation)];m.stencilZPass=ops[suffix(stencil.passOperation)];
  }
  if(transparentOutput&&!shadow&&blend.writeMask===15){
   if(!blend.enabled){
    // 原颜色目标的Alpha含辅助数据，透明网页另以实体覆盖率输出。
    const output=/layout\(location = 0\) out highp vec4 (\w+);/.exec(m.fragmentShader)?.[1];
    if(output)m.fragmentShader=m.fragmentShader.replace('void main()','void gf2Fragment()')+`\nvoid main(){gf2Fragment();${output}.a=1.;}`;
   }else if(suffix(blend.colorBlend.source)==='SrcAlpha'&&suffix(blend.colorBlend.destination)==='InvSrcAlpha'){
    m.blendSrcAlpha=THREE.OneFactor;m.blendDstAlpha=THREE.OneMinusSrcAlphaFactor;
   }
  }
  if(shadow){m.transparent=false;m.depthWrite=true;m.colorWrite=false;m.side=d.state.rasterizer.cullMode.endsWith('.NoCull')?THREE.DoubleSide:THREE.FrontSide;m.polygonOffset=true;m.polygonOffsetFactor=-d.state.rasterizer.slopeScaledDepthBias;m.polygonOffsetUnits=-d.state.rasterizer.depthBias;}
  if(outline){m.side=THREE.BackSide;m.transparent=false;m.depthWrite=d.state.depthStencil.depthWrites;}
  m.userData.gf2CaptureEvent=eid;m.onBeforeCompile=()=>stats.shaderCompiles++;if(!shadow&&!outline&&overrideId===undefined)stats.bound.push({pmx:original.name,eventId:eid});return m;
 }
 const materials=[];for(const original of originals)materials.push(await materialFor(original));
 const outlineMaterials=[];for(const original of originals){const eid=OUTLINE_BY_DRAW[DRAW_BY_MATERIAL[original.name]];outlineMaterials.push(eid?await materialFor(original,eid,false,true):new THREE.MeshBasicMaterial({visible:false}));}
 const hidden=new THREE.MeshBasicMaterial({visible:false}),passMeshes=[],extraMaterials=[];mesh.material=hidden;
 // 多遍共用一个几何身份，避免 Three 为每一遍重复上传整套90个形态纹理层。
 const renderGeometry=new THREE.BufferGeometry(),renderParts=[],renderIndices=[];
 renderGeometry.attributes=mesh.geometry.attributes;renderGeometry.morphAttributes=mesh.geometry.morphAttributes;renderGeometry.morphTargetsRelative=mesh.geometry.morphTargetsRelative;
 for(const part of referenceParts){const index=renderParts.length,materialIndex=originals.findIndex(m=>m.name===part.material);renderGeometry.addGroup(renderIndices.length,part.indices.length,index);renderParts.push({...part,index,materialIndex});renderIndices.push(...part.indices);}
 renderGeometry.setIndex(new THREE.Uint32BufferAttribute(renderIndices,1));
 const addPass=(part,material,kind)=>{
  if(!material.visible)return;
  const list=renderParts.map(()=>hidden);list[part.index]=material;
  const object=new THREE.SkinnedMesh(renderGeometry,list);object.bind(mesh.skeleton,mesh.bindMatrix);object.morphTargetInfluences=activeMorphs;object.frustumCulled=false;object.renderOrder=material.userData.gf2CaptureEvent||2419;
  object.userData.gf2PassKind=kind;object.userData.gf2Material=material;mesh.add(object);passMeshes.push(object);
 };
 for(const part of renderParts){
  const original=originals[part.materialIndex];
  if(original.name.startsWith('Cth1-Cape')){
   const events=part.eventId===2469?[2469,2815]:[3356,3368];
   for(const eid of events){const material=await materialFor(original,eid,false,eid===2815);extraMaterials.push(material);addPass(part,material,eid===2815?'outline':'base');}
   continue;
  }
  addPass(part,materials[part.materialIndex],'base');addPass(part,outlineMaterials[part.materialIndex],'outline');
  const extras=original.name==='HairB'?[2600,2710]:DRAW_BY_MATERIAL[original.name]===2500?[2685]:[];
  for(const eid of extras){const material=await materialFor(original,eid);extraMaterials.push(material);addPass(part,material,'face');}
 }
 stats.passes=passMeshes.map(p=>({material:p.userData.gf2Material.name,eventId:p.renderOrder,kind:p.userData.gf2PassKind})).sort((a,b)=>a.eventId-b.eventId);
 const shadowScenes=[],shadowMeshes=[],shadowMaterials=[];
 for(let light=0;light<2;light++){
  const scene=new THREE.Scene(),list=[];
  for(const part of renderParts){
   const eid=SHADOW_BY_DRAW[part.eventId],original=originals[part.materialIndex],material=eid?await materialFor(original,eid+light*120,true):hidden;
   if(material!==hidden)shadowMaterials.push(material);list.push(material);
  }
  const caster=new THREE.SkinnedMesh(renderGeometry,list);caster.bind(mesh.skeleton,mesh.bindMatrix);caster.morphTargetInfluences=activeMorphs;caster.matrixAutoUpdate=false;caster.frustumCulled=false;scene.add(caster);
  shadowMeshes.push([caster]);shadowScenes.push(scene);
 }
 // 原兵营中会投到角色上的三份场景几何，按捕获的光源裁剪坐标保留。
 for(const eid of[1283,1288,1293]){
  const d=draws.get(eid),raw=new Float32Array(await get(d.vertexFile)),positions=new Float32Array(raw.length/d.stride*16);
  for(let i=0;i<positions.length/4;i++)positions.set(raw.subarray(i*d.stride/4,i*d.stride/4+4),i*4);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('capturePosition',new THREE.BufferAttribute(positions,4));
  geometry.setIndex(new THREE.BufferAttribute(d.indexStride===2?new Uint16Array(await get(d.indexFile)):new Uint32Array(await get(d.indexFile)),1));geometry.setDrawRange(0,d.count);
  const material=new THREE.ShaderMaterial({vertexShader:'attribute vec4 capturePosition;void main(){gl_Position=vec4(capturePosition.x,-capturePosition.y,capturePosition.w-2.*capturePosition.z,capturePosition.w);}',fragmentShader:'void main(){gl_FragColor=vec4(0.);}',side:THREE.BackSide,colorWrite:false,depthWrite:true});
  const object=new THREE.Mesh(geometry,material);object.frustumCulled=false;shadowScenes[1].add(object);
  owned.push(geometry,material);
 }
 const lutData=await get('post-t4.bin'),lut=new THREE.DataTexture(new Uint16Array(lutData),1024,32,THREE.RGBAFormat,THREE.HalfFloatType);lut.minFilter=lut.magFilter=THREE.LinearFilter;lut.needsUpdate=true;owned.push(lut);
 const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,format:THREE.RGBAFormat,depthBuffer:true,stencilBuffer:true,samples:2});
 const postMaterial=new THREE.ShaderMaterial({vertexShader:POST_VERTEX,fragmentShader:POST_FRAGMENT,uniforms:{sceneColor:{value:target.texture},colorLut:{value:lut},exposure:{value:1},transparentOutput:{value:transparentOutput}},depthTest:false,depthWrite:false,toneMapped:false});
 const postScene=new THREE.Scene(),quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),postMaterial);postScene.add(quad);const postCamera=new THREE.Camera();
 const size=new THREE.Vector2(),view=new THREE.Matrix4(),projection=new THREE.Matrix4(),vp=new THREE.Matrix4(),inverseView=new THREE.Matrix4(),cam=new THREE.Vector3();
 const headRotation=new THREE.Quaternion(),headObject=new THREE.Matrix4(),headInverse=new THREE.Matrix4();
 timings.constructMs=performance.now()-constructionStarted;timings.adapterReadyMs=performance.now()-started;
 return {stats,materials,originals,passMeshes,controls:{normal:{value:1},ramp:{value:1},specular:{value:1}},
  get shadowMaps(){return shadowTargets.map(t=>t.depthTexture);},
  update(camera){
   for(let i=0;i<activeMorphs.length;i++)activeMorphs[i]=mesh.morphTargetInfluences[i];
   camera.updateMatrixWorld();view.copy(camera.matrixWorldInverse).multiply(C);inverseView.copy(view).invert();projection.copy(camera.projectionMatrix);
   const p=projection.elements;for(let col=0;col<4;col++){p[col*4+1]*=-1;p[col*4+2]=.5*p[col*4+3]-.5*p[col*4+2];}
   vp.multiplyMatrices(projection,view);camera.getWorldPosition(cam);cam.z*=-1;
   head.getWorldQuaternion(headRotation);headRotation.multiply(headBindQuaternion);
   headObject.makeRotationFromQuaternion(headRotation).premultiply(C).multiply(C).multiply(headBasis);headInverse.copy(headObject).invert();
   for(const b of headBlocks){b.data.set(referencePose.value?b.captured.subarray(16,32):headInverse.elements,16);b.texture.needsUpdate=true;}
   for(const b of globals){
    if(b.data.length>1295*4+3)b.data.set([cam.x,cam.y,cam.z,0],1295*4);
    for(const [index,m]of[[1333,projection],[1337,view],[1341,inverseView],[1345,vp],[1352,vp]])if(b.data.length>=(index+4)*4)b.data.set(m.elements,index*4);
    b.texture.needsUpdate=true;
   }
  },
  render(renderer,scene,camera){
   const firstFrameStart=timings.firstRenderMs===undefined?performance.now():null;
   if(stats.mode!=='game'){renderer.render(scene,camera);return;}
   renderer.getDrawingBufferSize(size);if(target.width!==size.x||target.height!==size.y)target.setSize(size.x,size.y);
   const previous=renderer.getRenderTarget();mesh.updateMatrixWorld(true);
   for(let i=0;i<2;i++){for(const caster of shadowMeshes[i])caster.matrix.copy(mesh.matrixWorld);renderer.setRenderTarget(shadowTargets[i]);renderer.render(shadowScenes[i],camera);}
   renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.setRenderTarget(previous);postMaterial.uniforms.exposure.value=renderer.toneMappingExposure;renderer.render(postScene,postCamera);
   if(firstFrameStart!==null){timings.firstRenderMs=performance.now()-firstFrameStart;timings.firstRenderAtMs=performance.now()-started;}
  },
  setMode(mode){stats.mode=mode;mesh.material=mode==='game'?hidden:originals;for(const p of passMeshes)p.visible=mode==='game';},
  setReferencePose(value){referencePose.value=!!value;stats.referencePose=!!value;},
  setLightAzimuth(degrees){const angle=degrees*Math.PI/180,y=.3746063709,h=Math.sqrt(1-y*y);for(const b of globals){if(b.data.length>32){b.data.set([Math.sin(angle)*h,y,-Math.cos(angle)*h,0],28);b.texture.needsUpdate=true;}}},
  dispose(){mesh.material=originals;for(const p of passMeshes)mesh.remove(p);renderGeometry.dispose();hidden.dispose();for(const m of[...materials,...shadowMaterials,...outlineMaterials,...extraMaterials])if(!originals.includes(m))m.dispose();for(const t of owned)t.dispose();for(const t of shadowTargets)t.dispose();target.dispose();postMaterial.dispose();quad.geometry.dispose();}
 };
}
