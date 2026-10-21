import * as THREE from 'three';

// PMX分区对应本机原游戏对象。身体使用角色实际引用的lod_body_skinuber。
export const GF2_PMX_MATERIALS = Object.freeze({
  Face:'c_Koleda_slg_faceuber', UpperTeeth:'c_Koleda_slg_faceuber', LowerTeeth:'c_Koleda_slg_faceuber',
  Tongue:'c_Koleda_slg_faceuber', EyeWhite:'c_Koleda_slg_faceuber', Brows:'c_Koleda_slg_eyelashuber', Lashes:'c_Koleda_slg_eyelashuber',
  Eyes:'c_Koleda_slg_eyenew', 'Eyes+':'c_Koleda_slg_eyenewadd', EyeShadow:'c_Koleda_slg_eyenewmul',
  BodySkin:'lod_body_skinuber', FingerNails:'body_zhijia01_uber',
  'Cth1-Top':'c_KoledaSSR01_slg_cloth1_uber', 'Cth1-Glove':'c_KoledaSSR01_slg_cloth1_uber',
  'Cth1-Cape':'c_KoledaSSR01_slg_cloth1_ubertrans', 'Cth1-Cape2':'c_KoledaSSR01_slg_cloth1_ubertrans',
  'Cth2-Shoes':'c_KoledaSSR01_slg_cloth2_uber', 'Cth2-Pants':'c_KoledaSSR01_slg_cloth2_uber', 'Cth2-Pouch':'c_KoledaSSR01_slg_cloth2_uber',
  'Cth3-Mask':'c_KoledaSSR01_slg_cloth3_uber', 'Cth4-Glove':'c_KoledaSSR01_slg_cloth4_uber', 'Cth5-ShoesZip':'c_KoledaSSR01_slg_cloth5_uber',
  Glock:'c_KoledaSSR01_slg_glock1_uber', HairA:'c_KoledaSSR01_slg_hairuber', HairB:'c_KoledaSSR01_slg_fringeuber',
});

// 保留PMX附加UV。three-stdlib的默认MeshBuilder只创建主UV属性。
export function attachGf2SecondaryUv(mesh, pmxData) {
  const data = new Float32Array(pmxData.vertices.length * 2);
  for (let i=0;i<pmxData.vertices.length;i++) {
    const uv=pmxData.vertices[i].auvs?.[0];
    if (!uv) throw new Error('模型缺少原材质所需的附加纹理坐标');
    data[i*2]=uv[0]; data[i*2+1]=uv[1];
  }
  mesh.geometry.setAttribute('gf2Uv',new THREE.BufferAttribute(data,2));
}

const DECLARATIONS = `
varying vec2 vGf2Uv;
uniform sampler2D gf2Ramp;
uniform sampler2D gf2Surface;
uniform sampler2D gf2Blend;
uniform mat3 gf2ViewToHead;
uniform mat3 gf2ViewToWorld;
uniform float gf2Anisotropy;
uniform float gf2Shift;
uniform float gf2BlendSmoothness;
uniform float gf2ShadowIntensity;
uniform float gf2NormalEnabled;
uniform float gf2RampEnabled;
uniform float gf2SpecularEnabled;
vec3 gf2RampAt(float x,float row) {return texture2D(gf2Ramp,vec2(clamp(x,0.0,1.0),row)).rgb;}
float gf2Visibility(float nl,float nv,float alpha) {
  return min(0.5/max(nl*(nv*(1.0-alpha)+alpha)+nv*(nl*(1.0-alpha)+alpha),0.0001),1.0);
}
// uber-2820：脸部BlendTex的左右阈值、周期角度及平滑区间。
float gf2FaceMask(vec3 light) {
  vec3 l=normalize(gf2ViewToHead*light);
  vec2 horizontal=normalize(l.xz+vec2(0.000001));
  vec4 tex=texture2D(gf2Blend,vGf2Uv);
  float mirrored=texture2D(gf2Blend,vec2(1.0-vGf2Uv.x,vGf2Uv.y)).r;
  bool region=tex.a<0.5;
  float angle=horizontal.y*0.5+(region?0.5:1.5);
  vec2 thresholds=region?vec2(tex.r,mirrored):vec2(mirrored,tex.r);
  if(horizontal.x<0.0)angle=2.0-angle;
  float smoothness=max(gf2BlendSmoothness,0.0001);
  float lower=mod(angle-0.5*smoothness+4.0,2.0);
  float upper=mod(angle+0.5*smoothness+4.0,2.0);
  float rising=clamp((thresholds.y-lower)/smoothness,0.0,1.0);
  float falling=1.0-clamp((2.0-lower-thresholds.x)/smoothness,0.0,1.0);
  float first=lower<1.0?rising:falling;
  float value=upper<1.0?min(1.0-clamp((upper-thresholds.y)/smoothness,0.0,1.0),first):max(falling,first);
  return value*(1.0-abs(l.z)*0.5);
}
`;

const LIGHTING = `
void RE_Direct_GF2(const in IncidentLight light,const in vec3 p,const in vec3 n,const in vec3 v,const in vec3 cc,const in PhysicalMaterial m,inout ReflectedLight result) {
  float nl=max(dot(n,light.direction),0.0),nv=clamp(dot(n,v)+0.00001,0.00001,1.0);
  #ifdef GF2_EYE
    result.directDiffuse+=light.color*m.diffuseColor*(nl*(1.0-gf2ShadowIntensity)+gf2ShadowIntensity);
  #else
    float coordinate=nl;
    #ifdef GF2_FACE
      coordinate=gf2FaceMask(light.direction);
    #endif
    vec3 ramp=mix(vec3(coordinate),gf2RampAt(coordinate,0.125),gf2RampEnabled);
    result.directDiffuse+=light.color*ramp*m.diffuseColor;
    #ifdef GF2_HAIR
      vec3 worldView=gf2ViewToWorld*v;
      vec2 specUv=vGf2Uv+vec2(0.0,worldView.y*gf2Shift);
      vec3 spec=texture2D(gf2Blend,specUv).rgb*nv*gf2Anisotropy*(nl*0.286479+0.031831);
      result.directSpecular+=light.color*spec*gf2SpecularEnabled;
    #elif !defined(GF2_FACE)
      vec3 h=normalize(light.direction+v);
      float nh=max(dot(n,h),0.0),vh=max(dot(v,h),0.0),lh=max(dot(light.direction,h),0.0);
      float alpha=m.roughness*m.roughness;
      float d=min(pow(alpha/max(pow(nh*alpha,2.0)+1.0-nh*nh,0.000001),2.0),2048.0);
      float visibility=gf2Visibility(nl,nv,alpha);
      float dMax=min(1.0/max(alpha*alpha,0.000001),2048.0),vMax=gf2Visibility(lh,vh,alpha);
      float x=clamp(d*visibility/max(dMax*vMax,0.000001),0.0,1.0);
      float fresnel=1.0+(clamp(50.0*m.specularColor.g,0.0,1.0)-1.0)*pow(max(1.0-vh,0.001),5.0);
      vec3 response=mix(vec3(d*visibility),dMax*vMax*gf2RampAt(x,0.375),gf2RampEnabled);
      result.directSpecular+=light.color*ramp*clamp(response*fresnel,vec3(0.0),vec3(10.0))*m.specularColor*gf2SpecularEnabled;
    #endif
  #endif
}
void RE_IndirectDiffuse_GF2(const in vec3 irradiance,const in vec3 p,const in vec3 n,const in vec3 v,const in vec3 cc,const in PhysicalMaterial m,inout ReflectedLight result) {
  // 预览环境来自Three；不以该环境代替游戏场景球谐数据。
  result.indirectDiffuse+=irradiance*RECIPROCAL_PI*m.diffuseColor;
}
#undef RE_Direct
#define RE_Direct RE_Direct_GF2
#undef RE_IndirectDiffuse
#define RE_IndirectDiffuse RE_IndirectDiffuse_GF2
`;

const color = value=>new THREE.Color().setRGB(value?.r??1,value?.g??1,value?.b??1);

export async function createGf2CharacterMaterials(mesh, assetRoot) {
  const base=new URL(assetRoot,location.href),response=await fetch(new URL('manifest.json',base));
  if(!response.ok)throw new Error('原游戏材质清单读取失败');
  const manifest=await response.json(),originals=mesh.material,cache=new Map(),owned=[];
  const controls={normal:{value:1},ramp:{value:1},specular:{value:1}};
  const headFromView={value:new THREE.Matrix3()},viewToWorld={value:new THREE.Matrix3()},keyDirection={value:new THREE.Vector3(0,0,1)};
  const stats={bound:[],retained:[],textureCount:0,shaderCompiles:0,mode:'game'};
  const loader=new THREE.TextureLoader();
  async function texture(ref) {
    if(!ref)return null;
    if(!cache.has(ref.url))cache.set(ref.url,(async()=>{
      let result;
      if(ref.rawUrl){
        const r=await fetch(new URL(ref.rawUrl,base));if(!r.ok)throw new Error('渐变贴图读取失败：'+ref.name);
        const data=await r.arrayBuffer();if(data.byteLength!==ref.width*ref.height*8)throw new Error('渐变贴图长度不符：'+ref.name);
        result=new THREE.DataTexture(new Uint16Array(data),ref.width,ref.height,THREE.RGBAFormat,THREE.HalfFloatType);
        result.generateMipmaps=false;
      }else result=await loader.loadAsync(new URL(ref.url,base).href);
      owned.push(result);stats.textureCount++;
      result.flipY=false;result.colorSpace=ref.colorSpace===1?THREE.SRGBColorSpace:THREE.NoColorSpace;
      result.wrapS=ref.settings.m_WrapU===0?THREE.RepeatWrapping:THREE.ClampToEdgeWrapping;
      result.wrapT=ref.settings.m_WrapV===0?THREE.RepeatWrapping:THREE.ClampToEdgeWrapping;
      result.magFilter=THREE.LinearFilter;result.minFilter=ref.rawUrl?THREE.LinearFilter:THREE.LinearMipmapLinearFilter;
      result.repeat.set(ref.scale.x,ref.scale.y);result.offset.set(ref.offset.x,1-ref.scale.y-ref.offset.y);result.needsUpdate=true;
      return result;
    })());
    return cache.get(ref.url);
  }
  const created=[];
  try {
    // 顺序加载避免多张大图同时解码挤占预览内存。
    for(const original of originals){
      const name=GF2_PMX_MATERIALS[original.name];
      if(!name){created.push(original);stats.retained.push(original.name);continue;}
      const source=manifest.materials[name];if(!source)throw new Error('缺少原游戏材质：'+name);
      const maps={};for(const [slot,ref]of Object.entries(source.textures))maps[slot]=await texture(ref);
      const overlay=source.shader.endsWith('eyeblend_add')?'add':source.shader.endsWith('eyeblend_multiply')?'multiply':null;
      const material=overlay?new THREE.MeshBasicMaterial():new THREE.MeshStandardMaterial();
      material.name=original.name;material.visible=original.visible;material.map=maps._BaseMap||maps._MainTex;
      material.color.copy(color(source.colors._BaseColor||source.colors._MainColor));
      material.side=original.side;material.opacity=original.opacity;material.transparent=original.transparent;
      material.alphaTest=original.alphaTest;material.depthWrite=original.depthWrite;
      material.userData.gf2Source=name;
      if(overlay){
        material.transparent=true;material.depthWrite=false;material.alphaTest=0;material.polygonOffset=true;material.polygonOffsetFactor=-1;
        material.blending=THREE.CustomBlending;material.blendEquation=THREE.AddEquation;
        material.blendSrc=overlay==='add'?THREE.SrcAlphaFactor:THREE.ZeroFactor;
        material.blendDst=overlay==='add'?THREE.OneFactor:THREE.SrcColorFactor;
        material.onBeforeCompile=shader=>{
          stats.shaderCompiles++;
          shader.uniforms.gf2KeyDirection=keyDirection;shader.uniforms.gf2EyeIntensity={value:source.floats._SpecularIntensity};
          shader.vertexShader='varying vec3 vGf2Normal;\n'+shader.vertexShader.replace('#include <defaultnormal_vertex>','#include <defaultnormal_vertex>\nvGf2Normal=normalize(transformedNormal);');
          shader.fragmentShader='varying vec3 vGf2Normal;\nuniform vec3 gf2KeyDirection;\nuniform float gf2EyeIntensity;\n'+shader.fragmentShader;
          shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',(overlay==='add'?'outgoingLight*=gf2EyeIntensity*(clamp(dot(normalize(vGf2Normal),gf2KeyDirection),0.0,1.0)*0.8+0.2);':'outgoingLight=mix(vec3(1.0),outgoingLight,gf2EyeIntensity);')+'\n#include <opaque_fragment>');
        };
      } else {
        const face=source.keywords.includes('_USE_BLEND_TEX'),hair=source.keywords.includes('_ANISOTROPIC_SPECULAR')&&!face,eye=source.shader.endsWith('/eye');
        material.roughness=hair||face?1:0.8;material.metalness=0;
        material.normalMap=maps._BumpMap||null;
        material.onBeforeCompile=shader=>{
          stats.shaderCompiles++;
          Object.assign(shader.uniforms,{gf2Ramp:{value:maps._RampMap},gf2Surface:{value:maps._RMOTex},gf2Blend:{value:maps._BlendTex},
            gf2ViewToHead:headFromView,gf2ViewToWorld:viewToWorld,gf2Anisotropy:{value:source.floats._Anisotropy||0},gf2Shift:{value:source.floats._AnisotropyShift||0},
            gf2BlendSmoothness:{value:source.floats._BlendSmoothness||0.1},gf2ShadowIntensity:{value:source.floats._ShadowIntensity??0.25},
            gf2NormalEnabled:controls.normal,gf2RampEnabled:controls.ramp,gf2SpecularEnabled:controls.specular});
          shader.vertexShader='attribute vec2 gf2Uv;\nvarying vec2 vGf2Uv;\n'+shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvGf2Uv=gf2Uv;');
          const define=face?'#define GF2_FACE\n':hair?'#define GF2_HAIR\n':eye?'#define GF2_EYE\n':'';
          shader.fragmentShader=define+DECLARATIONS+shader.fragmentShader;
          shader.fragmentShader=shader.fragmentShader.replace('#include <lights_physical_pars_fragment>','#include <lights_physical_pars_fragment>\n'+LIGHTING);
          if(maps._RMOTex&&!hair&&!face&&!eye){
            shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','vec3 gf2Rmo=texture2D(gf2Surface,vMapUv).rgb;float roughnessFactor=max(gf2Rmo.r,0.045);');
            shader.fragmentShader=shader.fragmentShader.replace('#include <metalnessmap_fragment>','float metalnessFactor=gf2Rmo.g;');
            shader.fragmentShader=shader.fragmentShader.replace('#include <aomap_fragment>','reflectedLight.indirectDiffuse*=gf2Rmo.b;');
          }
          if(maps._BumpMap){
            shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#ifdef USE_NORMALMAP_TANGENTSPACE
              vec4 packed=texture2D(normalMap,vNormalMapUv);
              vec2 xy=(vec2(packed.x*packed.w,packed.y)*2.0-1.0)*gf2NormalEnabled;
              vec3 mapN=vec3(xy,sqrt(max(0.0,1.0-dot(xy,xy))));
              normal=normalize(tbn*mapN);
              #endif`);
          }
        };
      }
      material.customProgramCacheKey=()=> 'gf2-original-preview:'+name;
      created.push(material);stats.bound.push({pmx:original.name,source:name,shader:source.shader,secondaryUv:source.floats._UseSpecularUV2===1});
    }
  }catch(error){
    for(const m of created)if(!originals.includes(m))m.dispose();for(const t of owned)t.dispose();throw error;
  }
  mesh.material=created;
  const viewport={value:new THREE.Vector2(1,1)};
  const outlines=originals.map((original,i)=>{
    const source=manifest.materials[GF2_PMX_MATERIALS[original.name]];
    const material=new THREE.MeshBasicMaterial({color:color(source?.colors._OutlineColor),side:THREE.BackSide,depthWrite:false});
    material.visible=Boolean(source?.floats._OutlineWidth)&&original.visible;
    material.map=created[i].map;material.alphaTest=0.5;
    const width={value:(source?.floats._OutlineWidth||0)*0.25};
    material.onBeforeCompile=shader=>{
      shader.uniforms.gf2OutlineViewport=viewport;shader.uniforms.gf2OutlineWidth=width;
      shader.vertexShader='uniform vec2 gf2OutlineViewport;uniform float gf2OutlineWidth;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
        vec2 direction=(projectionMatrix*vec4(normalMatrix*objectNormal,0.0)).xy;
        direction/=max(length(direction),0.0001);
        gl_Position.xy+=direction*2.0*gf2OutlineWidth/gf2OutlineViewport*gl_Position.w;
        gl_Position.z+=0.000005*gl_Position.w;`);
    };
    material.customProgramCacheKey=()=> 'gf2-preview-outline';
    return material;
  });
  const outline=new THREE.SkinnedMesh(mesh.geometry,outlines);outline.name='原材质描边预览';outline.bind(mesh.skeleton,mesh.bindMatrix);
  outline.morphTargetInfluences=mesh.morphTargetInfluences;outline.frustumCulled=false;outline.renderOrder=-1;mesh.add(outline);
  outline.onBeforeRender=renderer=>{renderer.getSize(viewport.value);};
  const head=mesh.skeleton.bones.find(b=>b.name==='頭'),rotation=new THREE.Quaternion(),cameraRotation=new THREE.Quaternion();
  return {
    stats,controls,materials:created,originals,
    update(camera,key){
      camera.updateMatrixWorld();camera.getWorldQuaternion(cameraRotation);
      viewToWorld.value.setFromMatrix4(camera.matrixWorld);
      if(head)head.getWorldQuaternion(rotation);else mesh.getWorldQuaternion(rotation);
      rotation.invert().multiply(cameraRotation);
      headFromView.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(rotation));
      keyDirection.value.copy(key.position).sub(key.target.position).normalize().transformDirection(camera.matrixWorldInverse);
    },
    setMode(mode){stats.mode=mode;mesh.material=mode==='game'?created:originals;outline.visible=mode==='game';},
    dispose(){mesh.material=originals;mesh.remove(outline);for(const m of outlines)m.dispose();for(const m of created)if(!originals.includes(m))m.dispose();for(const t of owned)t.dispose();},
  };
}
