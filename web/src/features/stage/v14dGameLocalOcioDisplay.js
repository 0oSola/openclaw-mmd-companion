import * as THREE from "three";
import { prepareStagePrograms, prepareStageTextures } from "./stageProgramPreparation.js";

const FULLSCREEN_VERTEX_SHADER = [
  "precision highp float;",
  "in vec3 position; in vec2 uv; out vec2 vUv;",
  "void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}",
].join("\n");

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("本机 OCIO 哈希校验器不可用。");
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function readChecked(fetchImpl, url, expectedSha256) {
  const response = await fetchImpl(url, { cache: "default" });
  if (!response?.ok) throw new Error("本机 OCIO 资源读取失败：" + url);
  const bytes = await response.arrayBuffer();
  if (expectedSha256 && (await sha256(bytes)) !== expectedSha256) {
    throw new Error("本机 OCIO 资源哈希不符：" + url);
  }
  return bytes;
}

function validateIdentity(identity) {
  if (!identity || identity.ocio !== "2.5.0" || identity.look !== "AgX - Medium High Contrast") {
    throw new Error("本机 OCIO 处理器身份不匹配。");
  }
  if (identity.exposureAppliedByProcessor !== false || identity.outputEncoded !== true) {
    throw new Error("本机 OCIO 处理器曝光/输出契约不匹配。");
  }
  if (!Array.isArray(identity.textures) || identity.textures.length !== 2) {
    throw new Error("本机 OCIO 查找表数量不匹配。");
  }
}

function readManifestEntry(manifest, key) {
  const entry = manifest?.ocio?.[key];
  if (!entry?.url) throw new Error("本机 OCIO 清单缺少 " + key + "。");
  return entry;
}

export async function createV14dGameLocalOcioDisplay({
  renderer,
  manifest,
  fetchImpl = globalThis.fetch?.bind(globalThis),
} = {}) {
  if (!renderer) throw new Error("本机 OCIO 渲染器缺失。");
  if (typeof fetchImpl !== "function") throw new Error("本机 OCIO 资源请求器不可用。");

  const processorEntry = readManifestEntry(manifest, "processor");
  const processorBytes = await readChecked(fetchImpl, processorEntry.url, processorEntry.sha256);
  let identity;
  try {
    identity = JSON.parse(new TextDecoder().decode(processorBytes));
  } catch (error) {
    throw new Error("本机 OCIO 处理器 JSON 无法解析：" + (error instanceof Error ? error.message : String(error)));
  }
  validateIdentity(identity);

  const shaderEntry = readManifestEntry(manifest, "shader");
  const shader = new TextDecoder().decode(await readChecked(fetchImpl, shaderEntry.url, shaderEntry.sha256 || identity.shaderSha256));
  const textures = [];
  const uniforms = {
    hdrTexture: { value: null },
    exposureFactor: { value: 2 ** Number(identity.exposure || 0) },
    toneMappingExposure: { value: 2 ** Number(identity.exposure || 0) },
    displayMode: { value: 1 },
  };

  for (const textureInfo of identity.textures) {
    const key = textureInfo.sampler === "v14d_lut3d_0Sampler" ? "lut0" : "lut1";
    const entry = readManifestEntry(manifest, key);
    const bytes = await readChecked(fetchImpl, entry.url, entry.sha256 || textureInfo.sha256);
    const expectedLength = Number(textureInfo.size) ** 3 * 4 * 4;
    if (bytes.byteLength !== expectedLength || textureInfo.channels !== 4 || textureInfo.filter !== "nearest") {
      throw new Error("本机 OCIO 查找表布局不符：" + key + "。");
    }
    const texture = new THREE.Data3DTexture(
      new Float32Array(bytes),
      textureInfo.size,
      textureInfo.size,
      textureInfo.size,
    );
    texture.type = THREE.FloatType;
    texture.format = THREE.RGBAFormat;
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    textures.push(texture);
    uniforms[textureInfo.sampler] = { value: texture };
  }

  const fragmentShader = [
    "precision highp float; precision highp sampler2D; precision highp sampler3D;",
    "uniform sampler2D hdrTexture; uniform float exposureFactor; uniform int displayMode; in vec2 vUv; out vec4 displayColor;",
    "float max3(vec3 v){return max(max(v.x,v.y),v.z);}",
    THREE.ShaderChunk.tonemapping_pars_fragment,
    THREE.ShaderChunk.colorspace_pars_fragment,
    shader,
    "void main(){",
    "vec4 hdr=texture(hdrTexture,vUv);",
    "vec3 straight=hdr.a>0.000001?hdr.rgb/hdr.a:vec3(0.0);",
    "vec3 shown=displayMode==1 ? ocio_display(vec4(straight*exposureFactor,1.0)).rgb : sRGBTransferOETF(vec4(AgXToneMapping(straight),1.0)).rgb;",
    "displayColor=vec4(clamp(shown,0.0,1.0)*hdr.a,hdr.a);",
    "}",
  ].join("\n");

  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FULLSCREEN_VERTEX_SHADER,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
    transparent: true,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const displayScene = new THREE.Scene();
  const displayCamera = new THREE.Camera();
  displayScene.add(quad);
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    samples: 4,
  });
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  target.texture.generateMipmaps = false;
  let disposed = false;

  function render(source, sourceCamera, width, height, exposure = -0.4, mode = "game/ocio") {
    if (disposed) throw new Error("本机 OCIO 显示器已释放。");
    if (!Number.isFinite(exposure) || !Number.isFinite(2 ** exposure)) throw new Error("显示曝光非法。");
    if (target.width !== width || target.height !== height) target.setSize(width, height);
    const previousTarget = renderer.getRenderTarget();
    const previousToneMapping = renderer.toneMapping;
    const previousExposure = renderer.toneMappingExposure;
    const previousOutputColorSpace = renderer.outputColorSpace;
    const previousDisplayExposure = uniforms.exposureFactor.value;
    const previousBuiltinExposure = uniforms.toneMappingExposure.value;
    const previousMode = uniforms.displayMode.value;
    try {
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.toneMappingExposure = 1;
      // 场景先写入线性 HDR，再由本机 OCIO shader 完成曝光、显示变换与输出编码。
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(source, sourceCamera);
      uniforms.hdrTexture.value = target.texture;
      uniforms.exposureFactor.value = 2 ** exposure;
      uniforms.toneMappingExposure.value = 2 ** exposure;
      uniforms.displayMode.value = mode === "game/ocio" ? 1 : 0;
      renderer.setRenderTarget(previousTarget);
      renderer.render(displayScene, displayCamera);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.toneMapping = previousToneMapping;
      renderer.toneMappingExposure = previousExposure;
      renderer.outputColorSpace = previousOutputColorSpace;
      uniforms.exposureFactor.value = previousDisplayExposure;
      uniforms.toneMappingExposure.value = previousBuiltinExposure;
      uniforms.displayMode.value = previousMode;
    }
  }

  return {
    identity,
    render,
    async prepare(source, sourceCamera, signal) {
      if (disposed) throw new Error("本机 OCIO 显示器已释放。");
      await prepareStagePrograms(renderer, () => {
        const previousTarget = renderer.getRenderTarget();
        const previousToneMapping = renderer.toneMapping;
        try {
          // 必须与render的HDR目标和显示目标一致，避免预热另一种输出编码的程序。
          renderer.toneMapping = THREE.NoToneMapping;
          renderer.setRenderTarget(target);
          renderer.compile(source, sourceCamera);
          renderer.setRenderTarget(previousTarget);
          renderer.compile(displayScene, displayCamera);
        } finally {
          renderer.setRenderTarget(previousTarget);
          renderer.toneMapping = previousToneMapping;
        }
      }, signal);
      await prepareStageTextures(renderer, source, textures, signal);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      target.dispose();
      for (const texture of textures) texture.dispose();
      material.dispose();
      quad.geometry.dispose();
    },
  };
}
