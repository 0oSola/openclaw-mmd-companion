import {ShaderChunk} from 'three';

// 复用已安装Three.js的LTC查表与边积分函数；不复制或修改依赖包数据。
// 圆盘由16边形近似，修正多边形面积以保持总功率；这是待核验候选。
const n=16;
const ring=Array.from({length:n},(_,i)=>{
  const a=-2*Math.PI*i/n;
  return 'vec2('+Math.cos(a).toFixed(10)+','+Math.sin(a).toFixed(10)+')';
}).join(',');
const areaCorrection=(2*Math.PI/(n*Math.sin(2*Math.PI/n))).toFixed(10);
const code=[
  '#if NUM_RECT_AREA_LIGHTS > 0',
  'uniform int hairDiskEnabled;',
  'uniform float hairDiskFlags[6];',
  'vec3 HeadDiskLTC(vec3 N,vec3 V,vec3 P,mat3 mInv,vec3 center,vec3 u,vec3 v){',
  'if(dot(-cross(u,v),P-center)<0.0)return vec3(0.0);',
  'vec3 tangent=V-N*dot(V,N);',
  'if(dot(tangent,tangent)<1e-10)tangent=cross(abs(N.y)<0.9?vec3(0,1,0):vec3(1,0,0),N);',
  'vec3 T1=normalize(tangent);vec3 T2=-cross(N,T1);',
  'mat3 m=mInv*transpose(mat3(T1,T2,N));',
  'const vec2 ring[16]=vec2[16]('+ring+');',
  'vec3 points[16];vec3 clipped[17];int count=0;',
  'for(int j=0;j<16;j++)points[j]=m*(center+u*ring[j].x+v*ring[j].y-P);',
  // 凸多边形与一个半空间相交最多增加一个顶点；先裁切再投影到单位球。
  'for(int j=0;j<16;j++){',
  'vec3 a=points[j];vec3 b=points[(j+1)%16];bool aInside=a.z>0.0;bool bInside=b.z>0.0;',
  'if(aInside){clipped[count]=a;count++;}',
  'if(aInside!=bInside){clipped[count]=a+(b-a)*(a.z/(a.z-b.z));count++;}',
  '}',
  'if(count<3)return vec3(0.0);',
  'for(int j=0;j<17;j++){if(j>=count)break;clipped[j]=normalize(clipped[j]);}',
  'vec3 sum=vec3(0.0);',
  'for(int j=0;j<17;j++){if(j>=count)break;sum+=LTC_EdgeVectorFormFactor(clipped[j],clipped[(j+1)%count]);}',
  'return vec3(max(sum.z,0.0));',
  '}',
  'void HeadRectArea(int index,RectAreaLight a,vec3 P,vec3 N,vec3 V,vec3 clearN,PhysicalMaterial material,inout ReflectedLight reflected){',
  'if(hairDiskEnabled==0||hairDiskFlags[index]<0.5){RE_Direct_RectArea(a,P,N,V,clearN,material,reflected);return;}',
  'vec2 uv=LTC_Uv(N,V,material.roughness);vec4 t1=texture2D(ltc_1,uv);vec4 t2=texture2D(ltc_2,uv);',
  'mat3 mInv=mat3(vec3(t1.x,0,t1.y),vec3(0,1,0),vec3(t1.z,0,t1.w));',
  'vec3 fresnel=material.specularColor*t2.x+(vec3(1.0)-material.specularColor)*t2.y;',
  'vec3 u=a.halfWidth*1.1283791671;vec3 v=a.halfHeight*1.1283791671;',
  'vec3 radiance=a.color*'+areaCorrection+';',
  'reflected.directSpecular+=radiance*fresnel*HeadDiskLTC(N,V,P,mInv,a.position,u,v);',
  'reflected.directDiffuse+=radiance*material.diffuseColor*HeadDiskLTC(N,V,P,mat3(1.0),a.position,u,v);',
  '}',
  '#endif',
].join(String.fromCharCode(10));

export function installHairDiskCandidate(shader,flags,enabled){
  if(!Array.isArray(flags)||flags.length!==6||!Array.from({length:6},(_,i)=>i).every(i=>Object.hasOwn(flags,i)&&(flags[i]===0||flags[i]===1))||typeof enabled!=='boolean')throw new Error('头发圆盘候选仅覆盖已知六灯布局');
  const pars='#include <lights_physical_pars_fragment>',begin='#include <lights_fragment_begin>';
  if(shader.fragmentShader.split(pars).length!==2||shader.fragmentShader.split(begin).length!==2)throw new Error('面积光接缝不唯一');
  const call='RE_Direct_RectArea( rectAreaLight,';
  if(ShaderChunk.lights_fragment_begin.split(call).length!==2)throw new Error('面积光循环接缝不唯一');
  shader.uniforms.hairDiskEnabled={value:enabled?1:0};shader.uniforms.hairDiskFlags={value:flags.slice()};
  shader.fragmentShader=shader.fragmentShader.replace(pars,ShaderChunk.lights_physical_pars_fragment+String.fromCharCode(10)+code);
  shader.fragmentShader=shader.fragmentShader.replace(begin,ShaderChunk.lights_fragment_begin.replace(call,'HeadRectArea( UNROLLED_LOOP_INDEX, rectAreaLight,'));
}
