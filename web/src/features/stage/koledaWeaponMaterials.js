const GAME_DISPLAY = `// 仅武器使用固定显示变换，不改变人物/舞台曝光；不是游戏色彩分级的复刻。
// 系数沿用项目安装的 Three ACESFilmicToneMapping。
vec3 weaponDisplay(vec3 color) {
  const mat3 inputMat=mat3(vec3(0.59719,0.07600,0.02840),vec3(0.35458,0.90834,0.13383),vec3(0.04823,0.01566,0.83777));
  const mat3 outputMat=mat3(vec3(1.60475,-0.10208,-0.00327),vec3(-0.53108,1.10813,-0.07276),vec3(-0.07367,-0.00605,1.07602));
  color=inputMat*(color/0.6);
  vec3 a=color*(color+0.0245786)-0.000090537;
  vec3 b=color*(0.983729*color+0.4329510)+0.238081;
  return clamp(outputMat*(a/b),0.0,1.0);
}
`;
const GAME_LIGHTING = `
// 对照原游戏 GFCharForward 无附加效果变体的直接光 BRDF。
// 灯光、反射环境和阴影仍来自 Three；不是完整 Unity 渲染管线。
uniform sampler2D weaponRamp;
uniform float weaponDirectScale;
uniform float weaponEnvironmentRamp;
vec3 weaponSampleRamp(float x, float row) {
  return texture2D(weaponRamp, vec2(clamp(x,0.0,1.0),row)).rgb;
}
float weaponVisibility(float nl,float nv,float alpha) {
  return min(0.5/max(nl*(nv*(1.0-alpha)+alpha)+nv*(nl*(1.0-alpha)+alpha),0.0001),1.0);
}
void RE_Direct_Weapon(const in IncidentLight light,const in vec3 position,const in vec3 n,const in vec3 v,const in vec3 cc,const in PhysicalMaterial m,inout ReflectedLight result) {
  float nl=max(dot(n,light.direction),0.0);
  float nv=clamp(dot(n,v)+0.00001,0.00001,1.0);
  vec3 h=normalize(light.direction+v);
  float nh=max(dot(n,h),0.0),vh=max(dot(v,h),0.0),lh=max(dot(light.direction,h),0.0);
  float alpha=m.roughness*m.roughness;
  float d=min(pow(alpha/max(pow(nh*alpha,2.0)+1.0-nh*nh,0.000001),2.0),2048.0);
  float visibility=weaponVisibility(nl,nv,alpha);
  float dMax=min(1.0/max(alpha*alpha,0.000001),2048.0);
  float vMax=weaponVisibility(lh,vh,alpha);
  float coordinate=clamp(d*visibility/max(dMax*vMax,0.000001),0.0,1.0);
  float fresnel=1.0+(clamp(50.0*m.specularColor.g,0.0,1.0)-1.0)*pow(max(1.0-vh,0.001),5.0);
  vec3 specular=clamp(dMax*vMax*fresnel*weaponSampleRamp(coordinate,0.375),vec3(0.0),vec3(10.0))*m.specularColor;
  vec3 diffuseRamp=weaponSampleRamp(nl,0.125);
  result.directDiffuse+=light.color*weaponDirectScale*diffuseRamp*m.diffuseColor;
  result.directSpecular+=light.color*weaponDirectScale*diffuseRamp*specular;
}
void RE_IndirectSpecular_Weapon(const in vec3 radiance,const in vec3 irradiance,const in vec3 clearcoatRadiance,const in vec3 p,const in vec3 n,const in vec3 v,const in vec3 cc,const in PhysicalMaterial m,inout ReflectedLight result) {
  float nv=max(dot(n,v),0.0);
  vec4 c=m.roughness*vec4(-1.0,-0.0275,-0.572,0.022)+vec4(1.0,0.0425,1.04,-0.04);
  float a=min(c.x*c.x,exp2(-9.28*nv))*c.x+c.y;
  vec2 ab=vec2(1.04,-1.04)*a+c.wz;
  // 原指令按主光在观察空间的横向符号选择相机横轴；区域灯用首灯中心方向适配。
  float lightSide=1.0;
  #if NUM_DIR_LIGHTS > 0
  lightSide=sign(directionalLights[0].direction.x);
  #elif NUM_RECT_AREA_LIGHTS > 0
  lightSide=sign(rectAreaLights[0].position.x-p.x);
  #endif
  float nl=max(n.x*lightSide,0.0);
  ab.x=mix(ab.x,weaponSampleRamp(ab.x*nl,0.625).r,weaponEnvironmentRamp);
  result.indirectSpecular+=radiance*(m.specularColor*ab.y+ab.x);
}
#undef RE_Direct
#define RE_Direct RE_Direct_Weapon
#undef RE_IndirectSpecular
#define RE_IndirectSpecular RE_IndirectSpecular_Weapon
`;
import * as THREE from "three";

/** 独立武器材质：指定皮肤使用原始渐变响应，旧资源保留原着色路径。 */
export async function applyKoledaWeaponMaterials(mesh, assetRoot, { partSpecific = false, renderer = null } = {}) {
  const base = new URL(assetRoot, globalThis.location.href);
  const loader = new THREE.TextureLoader();
  const partNames = ["body", "muzzle", "scope", "grip", "light"];
  if (partSpecific && (mesh.material.length !== partNames.length || mesh.material.some((m, i) => m.name !== partNames[i]))) {
    throw new Error("武器皮肤材质分区不符");
  }
  const paths = partSpecific ? partNames.flatMap(name => [`textures/${name}-normal.png`, `textures/${name}-orm.png`]) : ["normal.png", "orm.png"];
  const pending = paths.map(name => loader.loadAsync(new URL(name, base).href));
  if (partSpecific) pending.push(fetch(new URL("textures/game-ramp.rgba16f",base)).then(async response=>{
    if(!response.ok) throw new Error("武器明暗渐变贴图读取失败");
    const data=await response.arrayBuffer();if(data.byteLength!==32768)throw new Error("武器明暗渐变贴图尺寸不符");
    const texture=new THREE.DataTexture(new Uint16Array(data),256,16,THREE.RGBAFormat,THREE.HalfFloatType);
    texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.needsUpdate=true;return texture;
  }));
  const results = await Promise.allSettled(pending);
  if (results.some(result => result.status === "rejected")) {
    for (const result of results) if (result.status === "fulfilled") result.value.dispose();
    throw new Error("武器细节贴图读取失败");
  }
  const maps = results.map(result => result.value);
  for (const texture of maps) {
    texture.flipY = false; // 与 MMDLoader 的 PMX UV 一致。
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
  }
  let environment = null;
  if (partSpecific && renderer) {
    // 金属需要可反射的环境。只给武器一份中性棚景，不改人物或舞台环境。
    const studio = new THREE.Scene();
    studio.background = new THREE.Color().setRGB(0.22, 0.22, 0.22);
    const panels = [];
    for (const [position, size, intensity] of [
      [[0, 4, 0], [6, 0.1, 4], 1.5],
      [[0, 2, -4], [8, 0.8, 0.1], 2.5],
      [[-4, 0, 1], [0.1, 4, 3], 0.8],
      [[4, 1, -2], [0.1, 3, 4], 0.6],
    ]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(intensity, intensity, intensity) }));
      panel.position.set(...position);studio.add(panel);panels.push(panel);
    }
    const generator = new THREE.PMREMGenerator(renderer);
    try { mesh.__weaponEnvironmentTarget = generator.fromScene(studio, 0.04); environment = mesh.__weaponEnvironmentTarget.texture; }
    finally { generator.dispose();for(const p of panels){p.geometry.dispose();p.material.dispose();} }
  }
  const originals = mesh.material;
  const retained = new Set(originals.map(material => material.map).filter(Boolean));
  const unused = new Set();
  mesh.material = originals.map((original, index) => {
    const normal = maps[partSpecific ? index * 2 : 0];
    const orm = maps[partSpecific ? index * 2 + 1 : 1];
    if (original.map) { original.map.colorSpace = THREE.SRGBColorSpace; original.map.needsUpdate = true; }
    const material = new THREE.MeshStandardMaterial({
      name: original.name, map: original.map, color: original.color,
      normalMap: normal, normalScale: new THREE.Vector2(1, partSpecific ? 1 : -1),
      roughnessMap: orm, roughness: 1, metalnessMap: orm, metalness: partSpecific ? 1 : 0.8,
      envMapIntensity: partSpecific ? 2.5 : 1,
      envMap: environment,
      aoMap: orm, aoMapIntensity: partSpecific ? 1 : 0.6,
      side: original.side, transparent: original.transparent, opacity: original.opacity,
      alphaTest: original.alphaTest, depthWrite: original.depthWrite,
    });
    material.visible = original.visible;
    material.userData.weaponNeutralAreaLight = { value: 1 };
    material.userData.weaponReflectionIntensity = { value: 1 };
    // 舞台以直射灯为主；让凹槽遮蔽也调制底色，沿用角色衣料的做法。
    if (!partSpecific) material.onBeforeCompile = shader => {
      // V14D 的暖色背景区域灯会把独立金属武器染成橙色。
      // 武器保留灯的亮度、方向和法线响应，区域灯用中性色；不改变场景或人物灯光。
      shader.uniforms.weaponNeutralAreaLight = material.userData.weaponNeutralAreaLight;
      shader.uniforms.weaponReflectionIntensity = material.userData.weaponReflectionIntensity;
      shader.uniforms.weaponBakedColorMix = { value: 0 };
      shader.fragmentShader = "uniform float weaponBakedColorMix;\nuniform float weaponReflectionIntensity;\nuniform float weaponNeutralAreaLight;\n" + shader.fragmentShader;
      const lightChunk = THREE.ShaderChunk.lights_fragment_begin.replace(
        "rectAreaLight = rectAreaLights[ i ];",
        "rectAreaLight = rectAreaLights[ i ];\nrectAreaLight.color = mix(rectAreaLight.color, vec3(dot(rectAreaLight.color, vec3(0.2126,0.7152,0.0722))), weaponNeutralAreaLight);");
      shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_begin>", lightChunk);
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>",
        "#include <map_fragment>\n#ifdef USE_AOMAP\ndiffuseColor.rgb *= mix(1.0, texture2D(aoMap, vAoMapUv).r, aoMapIntensity);\n#endif");
      // 原始金属度留在RMO贴图；只收敛独立武器的镜面亮度，不改舞台灯光。
      // 这是Three管线对照适配，不能视作Unity原着色器逐指令复刻。
      shader.fragmentShader = shader.fragmentShader.replace("#include <lights_fragment_end>",
        "#include <lights_fragment_end>\nreflectedLight.directSpecular *= weaponReflectionIntensity;");
      // 游戏底色已带有明显的边缘和明暗信息，保留其主导颜色，叠加实时材质响应。
      shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>",
        "outgoingLight = mix(outgoingLight, diffuseColor.rgb, weaponBakedColorMix);\n#include <opaque_fragment>");
    };
    if(partSpecific) {
      material.toneMapped=false;
      material.weaponRampMap=maps[maps.length-1];
      material.userData.weaponLighting={directScale:{value:1},environmentRamp:{value:1}};
      material.onBeforeCompile=shader=>{
        shader.fragmentShader=GAME_DISPLAY+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace("#include <tonemapping_fragment>","gl_FragColor.rgb=weaponDisplay(gl_FragColor.rgb);");
        shader.uniforms.weaponRamp={value:material.weaponRampMap};
        shader.uniforms.weaponDirectScale=material.userData.weaponLighting.directScale;
        shader.uniforms.weaponEnvironmentRamp=material.userData.weaponLighting.environmentRamp;
        shader.fragmentShader=shader.fragmentShader.replace("#include <lights_physical_pars_fragment>","#include <lights_physical_pars_fragment>\n"+GAME_LIGHTING);
        shader.fragmentShader=shader.fragmentShader.replace("#include <aomap_fragment>","#ifdef USE_AOMAP\nreflectedLight.indirectDiffuse *= texture2D(aoMap,vAoMapUv).r;\n#endif");
        const lights=THREE.ShaderChunk.lights_fragment_begin.replace("rectAreaLight = rectAreaLights[ i ];","rectAreaLight = rectAreaLights[ i ];\nrectAreaLight.color = vec3(dot(rectAreaLight.color,vec3(0.2126,0.7152,0.0722)));");
        shader.fragmentShader=shader.fragmentShader.replace("#include <lights_fragment_begin>",lights);
      };
    }
    material.customProgramCacheKey = () => partSpecific ? "koleda-game-ramp-v2" : "koleda-weapon-orm-v4";
    material.userData.weaponSurface = partSpecific ? "辉翎花火原贴图与渐变响应 / 网页光照及显示适配" : "SSR01 原贴图 / Three 标准材质";
    for (const value of Object.values(original)) if (value?.isTexture && !retained.has(value)) unused.add(value);
    original.dispose();
    return material;
  });
  for (const texture of unused) texture.dispose();
  if(partSpecific) addWeaponOutline(mesh, THREE);
}

function addWeaponOutline(mesh, THREE) {
  const viewport={value:new THREE.Vector2(1,1)},width={value:0.85};
  const material=new THREE.MeshBasicMaterial({color:0x101619,side:THREE.BackSide,depthWrite:false,toneMapped:false});
  material.onBeforeCompile=shader=>{
    shader.uniforms.weaponOutlineViewport=viewport;shader.uniforms.weaponOutlineWidth=width;
    shader.vertexShader='uniform vec2 weaponOutlineViewport;\nuniform float weaponOutlineWidth;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
      vec3 edgeNormal=normalMatrix*objectNormal;
      vec2 edgeDirection=(projectionMatrix*vec4(edgeNormal,0.0)).xy;
      edgeDirection/=max(length(edgeDirection),0.0001);
      gl_Position.xy+=edgeDirection*2.0*weaponOutlineWidth/weaponOutlineViewport*gl_Position.w;
      gl_Position.z+=0.000005*gl_Position.w;`);
  };
  material.customProgramCacheKey=()=> 'koleda-weapon-outline-v1';
  const outline=new THREE.SkinnedMesh(mesh.geometry,material);outline.name='武器细描边';outline.bind(mesh.skeleton,mesh.bindMatrix);outline.frustumCulled=false;outline.renderOrder=-1;
  outline.onBeforeRender=renderer=>{renderer.getDrawingBufferSize(viewport.value);width.value=0.85*renderer.getPixelRatio();};
  mesh.add(outline);mesh.__weaponOutline=outline;return outline;
}
