import * as THREE from "three";
import {
  EffectComposer,
  MMDAnimationHelper,
  MMDLoader,
  OrbitControls,
  RectAreaLightUniformsLib,
  RenderPass,
  ShaderPass,
  UnrealBloomPass,
} from "three-stdlib";
import {
  isKoledaMaskMaterialName,
  isKoledaModelIdentifier,
  selectKoledaClosedEyeMorphNames,
  selectKoledaEyeMorphNames,
} from "./koledaDefaultAppearance.js";
import { createV14dGameAppearanceAdapter } from "./v14dGameAppearanceAdapter.js";
import {
  V14D_GAME_DEFAULT_SETTINGS,
  V14D_GAME_MANIFEST_URL,
  validateV14dGameManifest,
} from "./v14dGameAppearanceAssets.js";
import { createV14dGameLocalOcioDisplay } from "./v14dGameLocalOcioDisplay.js";
import { inspectVmdStructure } from "./vmdStructureGuard.js";
import { enableVmdSubframeCurves, readVmdBodyInterpolation } from "./vmdSubframeCurves.js";
import { prepareBakedGarmentMorphs } from "./bakedGarmentMorphs.js";
import { createGf2CapturedMaterials } from "./gf2CapturedMaterials.js";
import { attachGf2SecondaryUv } from "./gf2CharacterMaterials.js";
import { GF2_MODEL_SHA256, GF2_FRAME_ROOT } from "./gf2StageAssets.js";
import { StageWeaponAttachment } from "./stageWeaponAttachment.js";
import { identifyStageWeaponPair } from "./stageWeaponPair.js";
import { StageRenderQuality } from "./stageRenderQuality.js";
import { VmdClipCache } from "./vmdClipCache.js";
import { withVmdBindingRelease } from "./vmdActionRelease.js";
import { MmdPreparation } from "./mmdPreparation.js";
import { restorePreparedGeometry, restorePreparedClip } from "./mmdPreparationData.js";
import { loadSession } from "@/lib/session";

const FIXED_EMOTION_MORPH_HINTS = {
  happy: ["smile", "happy", "\u7b11", "\u5fae\u7b11", "\u7b11\u3044"],
  sad: ["sad", "sorrow", "\u60b2", "\u96be\u8fc7", "\u60b2\u3057\u3044"],
  caring: ["soft", "gentle", "smile", "\u6e29\u67d4", "\u5173\u5fc3"],
  neutral: [],
  thinking: [],
  excited: ["smile", "happy", "excited", "\u5f00\u5fc3", "\u9ad8\u5174"],
};

function isRezeEditorPipeline(pipeline) {
  return pipeline === "reze-design" || pipeline === "reze-npr";
}

function disposeUnattachedMmdObject(root) {
  root?.traverse?.((child) => {
    if (!child?.isMesh) return;
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material?.dispose?.());
    else child.material?.dispose?.();
  });
}

function getRezeSceneDebugDefaults(pipeline) {
  if (pipeline === "reze-npr") {
    return {
      sunAzimuth: 0,
      sunElevation: 28,
      keyIntensity: 1.86,
      ambientIntensity: 0.82,
      bloomThreshold: 0.5,
      bloomKnee: 0.5,
      bloomRadius: 4.0,
      bloomStrength: 0.06,
      cameraDistance: 31.5,
      cameraTargetX: -1.2,
      cameraTargetY: 1.05,
      cameraTargetZ: 0.45,
      sunColor: "#fff7f0",
      worldColor: "#8ea6c9",
      bloomColor: "#ff9bce",
      backgroundColor: "#0f172b",
      groundColor: "#0f172b",
      groundSize: 44,
      groundOpacity: 0.16,
      groundShadow: true,
      groundGridColor: "#fafaf9",
      groundGridEnabled: false,
    };
  }
  return {
    sunAzimuth: 205,
    sunElevation: 21,
    keyIntensity: 2.0,
    ambientIntensity: 0.66,
    bloomThreshold: 0.5,
    bloomKnee: 0.5,
    bloomRadius: 4.0,
    bloomStrength: 0.05,
    cameraDistance: 26.2,
    cameraTargetX: 0,
    cameraTargetY: 11.4,
    cameraTargetZ: 0,
    sunColor: "#ffffff",
    worldColor: "#ed6aff",
    bloomColor: "#ffc9c9",
    backgroundColor: "#4b004f",
    groundColor: "#c800de",
    groundSize: 160,
    groundOpacity: 0.42,
    groundShadow: true,
    groundGridColor: "#fafaf9",
    groundGridEnabled: true,
  };
}

const FIXED_FACE_MATERIAL_HINTS = [
  "face",
  "eye",
  "brow",
  "eyelash",
  "mouth",
  "lip",
  "cheek",
  "\u8138",
  "\u9762",
  "\u76ee",
  "\u773c",
  "\u7709",
  "\u776b\u6bdb",
  "\u53e3",
  "\u5634",
  "\u9854",
];

const FIXED_SKIN_MATERIAL_HINTS = [
  "skin",
  "body",
  "neck",
  "hand",
  "arm",
  "leg",
  "\u808c",
  "\u4f53",
  "\u8eab\u4f53",
  "\u9888",
  "\u8116",
  "\u624b",
  "\u8155",
  "\u817f",
];

const FIXED_HAIR_MATERIAL_HINTS = [
  "hair",
  "bang",
  "strand",
  "fringe",
  "ponytail",
  "tail",
  "\u9aea",
  "\u524d\u9aea",
  "\u6a2a\u9aea",
  "\u5f8c\u9aea",
  "\u5934\u53d1",
  "\u5218\u6d77",
];

const FIXED_CLOTH_MATERIAL_HINTS = [
  "skirt",
  "dress",
  "cloth",
  "cape",
  "cloak",
  "ribbon",
  "frill",
  "sleeve",
  "scarf",
  "veil",
  "\u670d",
  "\u88d9",
  "\u5e26",
  "\u8896",
  "\u62ab\u98ce",
  "\u56f4\u5dfe",
];

const REZE_EYE_MATERIAL_HINTS = ["eye", "pupil", "iris", "eyeball", "hitomi", "\u76ee", "\u773c", "\u77b3"];
const REZE_STOCKING_MATERIAL_HINTS = [
  "stocking",
  "stockings",
  "tights",
  "sock",
  "socks",
  "pantyhose",
  "\u889c",
  "\u4e1d\u889c",
  "\u9774\u4e0b",
];
const REZE_ROUGH_CLOTH_HINTS = ["rough", "jacket", "coat", "pants", "denim", "leather", "\u5916\u5957", "\u5927\u8863", "\u88e4"];
const REZE_SMOOTH_CLOTH_HINTS = [
  "shirt",
  "shorts",
  "dress",
  "skirt",
  "cloth",
  "sleeve",
  "ribbon",
  "shoe",
  "shoes",
  "\u670d",
  "\u88d9",
  "\u8896",
  "\u978b",
];

const FIXED_MORPH_HINTS = {
  smile: ["smile", "happy", "\u7b11", "\u5fae\u7b11"],
  sad: ["sad", "\u60b2", "\u60b2\u4f24"],
  blink: ["blink", "\u307e\u3070\u305f\u304d", "\u77ac\u304d", "\u7728\u773c"],
  mouthA: ["a", "mouth_a", "\u3042"],
  mouthI: ["i", "mouth_i", "\u3044"],
  mouthU: ["u", "mouth_u", "\u3046"],
  mouthE: ["e", "mouth_e", "\u3048"],
  mouthO: ["o", "mouth_o", "\u304a"],
};

const FIXED_EXPRESSION_MORPH_NAMES = {
  smirk: ["\u306b\u3084\u308a"],
  mouthSmile: ["\u53e3\u89d2\u4e0a\u3052"],
  mouthFrown: ["\u53e3\u89d2\u4e0b\u3052"],
  mouthWide: ["\u30ef"],
  joy: ["\u559c\u3073"],
  softSmile: ["\u306b\u3053\u308a"],
  troubled: ["\u56f0\u308b"],
  serious: ["\u771f\u9762\u76ee"],
  glare: ["\u3058\u3068\u76ee", "\u30b8\u30c8\u76ee"],
  surprised: ["\u3073\u3063\u304f\u308a"],
  angry: ["\u6012\u308a"],
};

const FIXED_VMD_ANCHOR_BONE_HINTS = [
  ["allparent", "\u5168\u3066\u306e\u89aa"],
  ["center", "\u30bb\u30f3\u30bf\u30fc"],
  ["groove", "\u30b0\u30eb\u30fc\u30d6"],
];

const LOWER_BODY_BONE_HINTS = [
  "center",
  "groove",
  "waist",
  "hip",
  "pelvis",
  "lowerbody",
  "leg",
  "knee",
  "ankle",
  "toe",
  "foot",
  "ik",
  "ikparent",
  "ik parent",
  "\u30bb\u30f3\u30bf\u30fc",
  "\u30b0\u30eb\u30fc\u30d6",
  "\u8170",
  "\u4e0b\u534a\u8eab",
  "\u5de6\u8db3",
  "\u53f3\u8db3",
  "\u5de6\u3072\u3056",
  "\u53f3\u3072\u3056",
  "\u5de6\u8db3\u9996",
  "\u53f3\u8db3\u9996",
  "\u5de6\u3064\u307e\u5148",
  "\u53f3\u3064\u307e\u5148",
  "\uff29\uff2b\u89aa",
  "\u3064\u307e\u5148\uff29\uff2b",
];

// Legacy mojibake hint tables were replaced with ASCII-safe Unicode escapes above.

const ACTION_DURATION = {
  idle: 0,
  nod: 1200,
  wave: 1800,
  think: 1800,
  cheer: 1600,
  comfort: 1400,
  lean_in: 1600,
  look_away: 1500,
  headshake: 1300,
};

const VMD_TRANSITION_FADE_SECONDS = 0.5;
const STAGE_CANVAS_ASPECT_RATIO = 3 / 4;
const BREATHING_CYCLE_SECONDS = 4.2;
const SPEAKING_LIP_CYCLE_MS = 520;
const SPEAKING_LIP_MIN_OPEN = 0.18;
const SPEAKING_LIP_OPEN_RANGE = 0.42;
const SPEECH_LEVEL_SILENCE_THRESHOLD = 0.04;
const SPEECH_LEVEL_MIN_OPEN = 0.12;
const SPEECH_LEVEL_OPEN_RANGE = 0.58;
const CLOSED_SPEECH_VISEMES = new Set(["M", "B", "P", "SIL", "SILENCE", ""]);
const SPEECH_VISEME_MOUTH_SHAPES = {
  A: { mouthA: 1, mouthI: 0.05, mouthU: 0, mouthE: 0.15, mouthO: 0.08 },
  I: { mouthA: 0.05, mouthI: 1, mouthU: 0.08, mouthE: 0.18, mouthO: 0 },
  U: { mouthA: 0.06, mouthI: 0, mouthU: 1, mouthE: 0, mouthO: 0.2 },
  E: { mouthA: 0.18, mouthI: 0.35, mouthU: 0, mouthE: 1, mouthO: 0 },
  O: { mouthA: 0.16, mouthI: 0, mouthU: 0.35, mouthE: 0, mouthO: 1 },
};

const smooth = (current, target, lambda, dt) => THREE.MathUtils.damp(current, target, lambda, dt);

function clampUnit(value, fallback = 0) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(1, Math.max(0, next));
}

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function getSpeakingLipBase(elapsedMs) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const phase = (elapsed / SPEAKING_LIP_CYCLE_MS) * Math.PI * 2 - Math.PI / 2;
  const wave = (Math.sin(phase) + 1) * 0.5;
  return SPEAKING_LIP_MIN_OPEN + wave * SPEAKING_LIP_OPEN_RANGE;
}

function getSpeechLevelLipBase(level) {
  const normalized = clampUnit(level, 0);
  if (normalized <= SPEECH_LEVEL_SILENCE_THRESHOLD) return 0;
  return SPEECH_LEVEL_MIN_OPEN + Math.pow(normalized, 0.72) * SPEECH_LEVEL_OPEN_RANGE;
}

function normalizeSpeechVisemeName(value) {
  const next = String(value || "").trim();
  if (!next) return "";
  return next.toLowerCase() === "sil" ? "SIL" : next.toUpperCase();
}

function getSpeechVisemeMouthTargets(frame, { speechLevel = 0, speechLevelActive = false } = {}) {
  const viseme = normalizeSpeechVisemeName(frame?.viseme);
  if (CLOSED_SPEECH_VISEMES.has(viseme)) {
    return { mouthA: 0, mouthI: 0, mouthU: 0, mouthE: 0, mouthO: 0 };
  }
  const shape = SPEECH_VISEME_MOUTH_SHAPES[viseme];
  if (!shape) return null;
  const frameWeight = clampUnit(frame?.weight, 0.75);
  const levelOpen = speechLevelActive ? getSpeechLevelLipBase(speechLevel) : 0.72;
  const amount = Math.min(1, Math.max(0.1, levelOpen) * (0.45 + frameWeight * 0.75));
  return Object.fromEntries(Object.entries(shape).map(([slot, value]) => [slot, value * amount]));
}

function isKnownMmdParserConsoleError(args) {
  const text = args
    .map((value) => {
      if (typeof value === "string") return value;
      if (value instanceof Error) return `${value.message}\n${value.stack || ""}`;
      return "";
    })
    .join("\n");
  return /three-stdlib[\\/].*mmdparser|CharsetEncoder\.s2u|DataViewEx\.getSjisStringsAsUnicode|parseMorph|parseVmd/i.test(text);
}

async function fetchVmdBuffer(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`VMD request failed: ${response.status}`);
  return response.arrayBuffer();
}

function loadAnimationSilently(loader, url, target, clipCache, preparation) {
  return new Promise((resolve, reject) => {
    const originalConsoleError = console.error;
    console.error = (...args) => {
      if (isKnownMmdParserConsoleError(args)) return;
      originalConsoleError(...args);
    };

    const restore = () => {
      console.error = originalConsoleError;
    };

    const start = async () => {
      let structureError = null;
      let bodyInterpolation = null;
      let buffer;
      let cacheKey;
      try {
        buffer = await fetchVmdBuffer(url);
        cacheKey = await clipCache.keyFor(buffer);
        const cached = clipCache.get(cacheKey);
        if (cached) {
          restore();
          resolve(cached);
          return;
        }
        structureError = inspectVmdStructure(buffer);
        bodyInterpolation = readVmdBodyInterpolation(buffer);
      } catch (error) {
        restore();
        reject(error);
        return;
      }
      if (structureError && !structureError.ok) {
        restore();
        reject(new Error(`Invalid VMD: ${structureError.reason}`));
        return;
      }

      try {
        // 校验、身份判定和动画构建消费同一份字节，避免二次请求返回另一份动作。
        const weaponPair = await identifyStageWeaponPair(buffer);
        let clip;
        if (preparation?.available && buffer.byteLength >= 4 * 1024 * 1024) {
          const prepared = await preparation.run('vmd', { buffer, target: {
            isCamera: Boolean(target.isCamera),
            bones: (target.skeleton?.bones || []).map(bone => ({ name: bone.name, position: bone.position.toArray() })),
            morphTargetDictionary: target.morphTargetDictionary || {},
          } });
          clip = restorePreparedClip(prepared.clip);
        } else {
          const vmd = loader._getParser().parseVmd(buffer, true);
          clip = target.isCamera ? loader.animationBuilder.buildCameraAnimation(vmd) : loader.animationBuilder.build(vmd, target);
        }
        clip.userData = { ...clip.userData, stageWeaponPair: weaponPair };
        if (bodyInterpolation) clip.userData.vmdBodyInterpolation = bodyInterpolation;
        clipCache.put(cacheKey, clip);
        restore();
        resolve(clip);
      } catch (error) {
        restore();
        reject(error);
      }
    };

    void start();
  });
}

function cloneCameraSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    ...snapshot,
    position: Array.isArray(snapshot.position) ? [...snapshot.position] : [0, 0, 0],
    target: Array.isArray(snapshot.target) ? [...snapshot.target] : [0, 0, 0],
  };
}

const STAGE_PRESENTATION_PRESETS = {
  gf2: {
    background: null, fog: null,
    camera: {
      fov: 40, near: 0.01, far: 100,
      position: [-0.013, 0.763999879, 2.562000275],
      target: [-0.0000030211408, 0.8176990731136, 0.0005958326522],
      minDistance: 0.3, maxDistance: 7, maxPolarAngle: Math.PI, locked: false,
    },
    character: { scale: 0.08 },
    renderer: { exposure: 1, pixelRatioCap: 2 },
    floor: { enabled: false, y: 0 },
    outline: { enabled: false }, backdrop: { enabled: false }, postfx: { enabled: false },
  },
  classic: {
    background: null,
    fog: null,
    camera: {
      fov: 33,
      position: [-2.075385, 0.017334, 46.985286],
      target: [-2.075385, -2.771828, 0.642287],
      minDistance: 6,
      maxDistance: 60,
      maxPolarAngle: Math.PI * 0.46,
    },
    character: {
      targetHeight: 19.5,
    },
    lights: {
      ambient: { color: 0xffffff, intensity: 0.78 },
      hemisphere: { sky: "#f4f8ff", ground: "#5a6270", intensity: 0.6 },
      key: { color: 0xffffff, intensity: 1.42, position: [-14, 20, 28] },
      fill: { color: 0xffffff, intensity: 0.5, position: [16, 10, 18] },
      rim: { color: 0xffffff, intensity: 0.36, position: [-10, 14, -18] },
    },
    shadowMapType: THREE.PCFShadowMap,
    floor: {
      kind: "shadowCatcher",
      size: 44,
      y: -9.75,
      opacity: 0.2,
    },
    outline: { enabled: false, color: "#1b2130", opacity: 0.88, scale: 1.025 },
    backdrop: { enabled: false },
    postfx: { enabled: false },
  },
  "v14d-game": {
    background: null,
    fog: null,
    camera: {
      fov: 33,
      position: [-2.075385, 0.017334, 46.985286],
      target: [-2.075385, -2.771828, 0.642287],
      minDistance: 6,
      maxDistance: 60,
      maxPolarAngle: Math.PI * 0.46,
      locked: false,
    },
    character: {
      targetHeight: 19.5,
    },
    lights: {
      ambient: { color: 0xffffff, intensity: 0.78 },
      hemisphere: { sky: "#f4f8ff", ground: "#5a6270", intensity: 0.6 },
      key: { color: 0xffffff, intensity: 1.42, position: [-14, 20, 28] },
      fill: { color: 0xffffff, intensity: 0.5, position: [16, 10, 18] },
      rim: { color: 0xffffff, intensity: 0.36, position: [-10, 14, -18] },
    },
    shadowMapType: THREE.PCFShadowMap,
    floor: {
      kind: "shadowCatcher",
      size: 44,
      y: -9.75,
      opacity: 0.2,
    },
    outline: { enabled: false, color: "#1b2130", opacity: 0.88, scale: 1.025 },
    backdrop: { enabled: false },
    postfx: { enabled: false },
    appearance: {
      phase: "idle",
      realAppearanceAvailable: false,
      label: "V14D 游戏外观未安装",
    },
  },
  "hero-shot": {
    background: "#061630",
    fog: null,
    camera: {
      fov: 33,
      position: [-2.075385, 0.017334, 46.985286],
      target: [-2.075385, -2.771828, 0.642287],
      minDistance: 6,
      maxDistance: 60,
      maxPolarAngle: Math.PI * 0.41,
    },
    character: {
      targetHeight: 19.5,
    },
    lights: {
      ambient: { color: 0xffffff, intensity: 0.66 },
      hemisphere: { sky: "#d8e8ff", ground: "#26364d", intensity: 0.54 },
      key: { color: "#fff1dc", intensity: 1.42, position: [-11, 18, 21] },
      fill: { color: "#c3dcff", intensity: 0.42, position: [13, 9, 17] },
      rim: { color: "#d6f3ff", intensity: 0.54, position: [-8, 13, -16] },
    },
    shadowMapType: THREE.PCFShadowMap,
    floor: {
      kind: "shadowCatcher",
      size: 36,
      y: -12,
      opacity: 0.02,
      glow: {
        enabled: true,
        size: [24, 24],
        color: "#63c8ff",
        opacity: 0.14,
        position: [0, -11.96, -1.1],
      },
      rings: {
        enabled: true,
        size: [27, 27],
        color: "#d7f2ff",
        opacity: 0.32,
        position: [0, -11.94, -1],
      },
      contactShadow: {
        enabled: true,
        size: [11.2, 7.1],
        opacity: 0.16,
        position: [0, -11.98, 0.2],
      },
    },
    outline: { enabled: true, color: "#20304a", opacity: 0.94, scale: 1.04 },
    backdrop: {
      enabled: true,
      panelSize: [48, 44],
      panelColorTop: "#2c7ca8",
      panelColorBottom: "#123a62",
      panelOpacity: 0.68,
      panelPosition: [0, 6.8, -20],
      haloSize: [18, 18],
      haloColor: "#8ff0ff",
      haloOpacity: 0.36,
      haloPosition: [0, 8.6, -18.3],
      ringSize: [23, 23],
      ringColor: "#e2fbff",
      ringOpacity: 0.58,
      ringPosition: [0, 7.3, -19],
    },
    postfx: {
      enabled: true,
      bloomStrength: 0.12,
      bloomRadius: 0.2,
      bloomThreshold: 0.66,
      grade: {
        exposure: 1,
        contrast: 1.1,
        saturation: 1.12,
        warmth: 0.03,
        shadowLift: 0.01,
      },
    },
  },
  genshin: {
    background: null,
    fog: null,
    camera: {
      fov: 33,
      position: [-2.075385, 0.017334, 46.985286],
      target: [-2.075385, -2.771828, 0.642287],
      minDistance: 6,
      maxDistance: 60,
      maxPolarAngle: Math.PI * 0.5,
      locked: false,
    },
    character: {
      targetHeight: 19.5,
    },
    lights: {
      ambient: { color: 0xffffff, intensity: 0.8 },
      hemisphere: { sky: "#ffffff", ground: "#333333", intensity: 0.6 },
      key: { color: "#ffffff", intensity: 1.2, position: [-15, 20, 30] },
      fill: { color: "#ffffff", intensity: 0.5, position: [15, 10, -20] },
      rim: { color: "#ffffff", intensity: 0, position: [0, 0, 0] },
    },
    shadowMapType: THREE.PCFSoftShadowMap,
    floor: {
      kind: "shadowCatcher",
      size: 44,
      y: -9.75,
      opacity: 0.2,
    },
    outline: { enabled: false, color: "#2a3142", opacity: 0.92, scale: 1.03 },
    backdrop: { enabled: false },
    postfx: { enabled: false },
  },
  "mio-reference": {
    background: null,
    fog: null,
    renderer: { toneMapping: "none", exposure: 1.57 },
    camera: {
      fov: 32,
      position: [-9.39, 12.522935, 43.63],
      target: [-1.861732, -2.847643, 1.048369],
      minDistance: 21,
      maxDistance: 72,
      maxPolarAngle: 1.5079644737231006,
      locked: false,
    },
    character: {
      targetHeight: 19.5,
    },
    lights: {
      ambient: { color: "#ffffff", intensity: 0.2 },
      hemisphere: { sky: "#ff6929", ground: "#333333", intensity: 0.48 },
      key: { color: "#ffffff", intensity: 1.43, position: [-18.5, -25.6, 64.3] },
      fill: { color: "#ffffff", intensity: 0.61, position: [15, 10, -20] },
      rim: { color: "#e12d2d", intensity: 0, position: [0, 16.2, 3.5] },
    },
    shadowMapType: THREE.PCFSoftShadowMap,
    floor: {
      kind: "shadowCatcher",
      size: 44,
      y: -9.75,
      opacity: 0.22,
      contactShadow: {
        enabled: true,
        size: [10.4, 6.8],
        opacity: 0.12,
        position: [0, -9.73, 0.2],
      },
    },
    outline: { enabled: false, color: "#27496d", opacity: 0.9, scale: 1.03 },
    faceDetails: {
      chinLine: {
        enabled: false,
        anchor: "head",
        color: "#2f2632",
        opacity: 0.38,
        radius: 0.012,
        tubularSegments: 18,
        radialSegments: 5,
        points: [
          [-0.34, -0.34, 0.56],
          [-0.18, -0.43, 0.62],
          [0, -0.46, 0.64],
          [0.18, -0.43, 0.62],
          [0.34, -0.34, 0.56],
        ],
      },
    },
    backdrop: { enabled: false },
    postfx: {
      enabled: false,
      bloomStrength: 0.88,
      bloomRadius: 0.2,
      bloomThreshold: 0.66,
      grade: {
        exposure: 1,
        contrast: 1,
        saturation: 1,
        warmth: 0,
        shadowLift: 0,
      },
    },
    materialAdjustments: {
      opacityMultiplier: 1,
      alphaTest: 0,
      shininessMultiplier: 1,
      specularMultiplier: 1,
      emissiveIntensityMultiplier: 1,
      envMapIntensityMultiplier: 1,
      face: { tintColor: "#f71d1d", tintStrength: 0.13 },
      skin: { tintColor: "#ffffff", tintStrength: 0.28 },
      hair: { tintColor: "#02c2f2", tintStrength: 0.61 },
      eye: { tintColor: "#ffffff", tintStrength: 0.04 },
      cloth: { tintColor: "#ffffff", tintStrength: 0.25 },
    },
  },
  "reze-npr": {
    background: null,
    fog: null,
    renderer: { toneMapping: "aces", exposure: 1.08 },
    camera: {
      fov: 32,
      position: [-1.2, 2.8, 31.5],
      target: [-1.2, 1.05, 0.45],
      minDistance: 8,
      maxDistance: 42,
      maxPolarAngle: Math.PI * 0.49,
      locked: false,
    },
    character: {
      targetHeight: 19.5,
    },
    lights: {
      ambient: { color: "#667d9f", intensity: 0.82 },
      hemisphere: { sky: "#8ea6c9", ground: "#242833", intensity: 0.72 },
      key: { color: "#fff7f0", intensity: 1.86, position: [0, 16, -30] },
      fill: { color: "#9fc1ff", intensity: 0.34, position: [18, 8, 14] },
      rim: { color: "#ff9bce", intensity: 0.2, position: [-12, 10, -18] },
    },
    shadowMapType: THREE.PCFSoftShadowMap,
    floor: {
      kind: "shadowCatcher",
      size: 52,
      y: -9.75,
      opacity: 0.16,
      contactShadow: {
        enabled: true,
        size: [10.8, 7],
        opacity: 0.1,
        position: [0, -9.73, 0.2],
      },
    },
    outline: { enabled: true, color: "#15131d", opacity: 0.84, scale: 1.022 },
    backdrop: { enabled: false },
    postfx: {
      enabled: true,
      bloomStrength: 0.06,
      bloomRadius: 0.24,
      bloomThreshold: 0.5,
      grade: {
        exposure: 1.06,
        contrast: 1.08,
        saturation: 1.08,
        warmth: 0.02,
        shadowLift: 0.005,
      },
    },
  },
  "reze-design": {
    // 灯光、泛光和构图遵循用户提供的 Reze Design 参数；背景与接地保持透明，
    // 由页面的 MIO 星海背景与 MIO 阴影接地层统一提供。
    background: null,
    fog: null,
    renderer: { toneMapping: "aces", exposure: 1 },
    camera: {
      fov: 32,
      position: [0, 11.4, 26.2],
      target: [0, 11.4, 0],
      minDistance: 21,
      maxDistance: 72,
      maxPolarAngle: 1.5079644737231006,
      locked: false,
    },
    character: {
      targetHeight: 19.5,
    },
    lights: {
      ambient: { color: "#fef2f2", intensity: 0.4 },
      hemisphere: { sky: "#fef2f2", ground: "#0f172b", intensity: 0.4 },
      // 截图参数：方位角 55°、仰角 28°；反向位置表示光线由该方向射向角色。
      key: { color: "#ffffff", intensity: 1.35, position: [-20.45, 14.08, -14.32] },
      fill: { color: "#fef2f2", intensity: 0.14, position: [15, 10, -20] },
      rim: { color: "#fef2e2", intensity: 0.09, position: [-10, 14, -18] },
    },
    shadowMapType: THREE.PCFSoftShadowMap,
    floor: {
      // 与 MIO Reference 一致：只保留阴影捕捉和接触阴影，底图及海面由 CSS
      // MIO 舞台背景提供，不在 WebGL 中叠加一块独立颜色/网格平面。
      kind: "shadowCatcher",
      size: 44,
      y: -9.75,
      opacity: 0.22,
      contactShadow: {
        enabled: true,
        size: [10.4, 6.8],
        opacity: 0.12,
        position: [0, -9.73, 0.2],
      },
    },
    outline: { enabled: true, color: "#2a152d", opacity: 0.72, scale: 1.02 },
    backdrop: { enabled: false },
    postfx: {
      enabled: true,
      bloomStrength: 0.09,
      bloomRadius: 0.24,
      bloomThreshold: 0.81,
      grade: {
        exposure: 1,
        contrast: 1,
        saturation: 1,
        warmth: 0,
        shadowLift: 0,
      },
    },
  },
  k3: {
    background: null,
    fog: null,
    renderer: { toneMapping: "none", exposure: 1.22, pixelRatioCap: 3 },
    camera: {
      fov: 33,
      position: [-2.075385, 0.017334, 46.985286],
      target: [-2.075385, -2.771828, 0.642287],
      minDistance: 6,
      maxDistance: 60,
      maxPolarAngle: Math.PI * 0.5,
      locked: false,
    },
    character: {
      targetHeight: 19.5,
    },
    lights: {
      ambient: { color: 0xffffff, intensity: 0.7 },
      hemisphere: { sky: "#f4f7fa", ground: "#3a4046", intensity: 0.65 },
      key: { color: "#f7f4ef", intensity: 1.15, position: [-14, 20, 28], shadowMapSize: 4096 },
      fill: { color: "#dbe8ff", intensity: 0.5, position: [16, 10, 18] },
      rim: { color: "#e8f4ff", intensity: 0.65, position: [-10, 14, -18] },
    },
    shadowMapType: THREE.PCFSoftShadowMap,
    floor: {
      kind: "shadowCatcher",
      size: 44,
      y: -9.75,
      opacity: 0.2,
      contactShadow: {
        enabled: true,
        size: [10.8, 7],
        opacity: 0.12,
        position: [0, -9.73, 0.2],
      },
    },
    outline: { enabled: true, color: "#16121c", opacity: 0.78, scale: 1.014 },
    backdrop: { enabled: false },
    postfx: {
      enabled: true,
      // bloom 淇濇寔 0锛歵hree-stdlib UnrealBloomPass 鍦ㄩ€忔槑鐢诲竷涓婁細鎶?background:null 鐨勮垶鍙版秱榛?      // 锛坮eze-npr 鍚屾牱鍙楀奖鍝嶏級锛孠3 鐢ㄨ壊褰╁垎绾ф浛浠ｆ硾鍏夋潵缁存寔閫氶€忔劅銆?      bloomStrength: 0,
      bloomRadius: 0.22,
      bloomThreshold: 0.72,
      grade: {
        exposure: 1.0,
        contrast: 1.05,
        saturation: 1.05,
        warmth: 0.004,
        shadowLift: 0.002,
        linearToSRGB: true,
      },
    },
  },
};

function cloneStagePresentationConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

function readFiniteNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function readVectorTuple(value, fallback) {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback];
  const next = value.map((item) => Number(item));
  if (next.some((item) => !Number.isFinite(item))) return [...fallback];
  return next;
}

function roundCameraNumber(value) {
  return Number(Number(value).toFixed(6));
}

export function normalizeMmdCameraSnapshot(snapshot, fallbackCamera = STAGE_PRESENTATION_PRESETS.genshin.camera) {
  return {
    fov: readFiniteNumber(snapshot?.fov, fallbackCamera.fov),
    position: readVectorTuple(snapshot?.position, fallbackCamera.position),
    target: readVectorTuple(snapshot?.target, fallbackCamera.target),
    locked: typeof snapshot?.locked === "boolean" ? snapshot.locked : Boolean(fallbackCamera.locked),
  };
}

function applyCameraSnapshotToPresentation(presentation, snapshot) {
  if (!snapshot) return presentation;
  const camera = normalizeMmdCameraSnapshot(snapshot, presentation.camera);
  presentation.camera = {
    ...presentation.camera,
    ...camera,
  };
  return presentation;
}

export function getStagePresentationConfig(pipeline = "classic") {
  return cloneStagePresentationConfig(STAGE_PRESENTATION_PRESETS[pipeline] || STAGE_PRESENTATION_PRESETS.classic);
}

export function fitModelToPresentation(mesh, presentation = getStagePresentationConfig("classic")) {
  if (!(mesh instanceof THREE.Object3D)) return null;

  if (presentation?.character?.scale) {
    mesh.scale.setScalar(presentation.character.scale);
    mesh.updateMatrixWorld(true);
    return { scale: presentation.character.scale, floorY: 0 };
  }

  mesh.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(mesh);
  if (bounds.isEmpty()) return null;

  const size = bounds.getSize(new THREE.Vector3());
  const targetHeight = Math.max(0.001, Number(presentation?.character?.targetHeight) || size.y || 1);
  const height = Math.max(0.001, size.y || 1);
  const scale = targetHeight / height;

  mesh.scale.multiplyScalar(scale);
  mesh.updateMatrixWorld(true);

  const scaledBounds = new THREE.Box3().setFromObject(mesh);
  const center = scaledBounds.getCenter(new THREE.Vector3());
  const floorY = Number(presentation?.floor?.y);
  const targetFloorY = Number.isFinite(floorY) ? floorY : 0;

  mesh.position.x -= center.x;
  mesh.position.z -= center.z;
  mesh.position.y += targetFloorY - scaledBounds.min.y;
  mesh.updateMatrixWorld(true);

  return {
    scale,
    floorY: targetFloorY,
  };
}

export function pickNextLoopMotionUrl(urls, currentUrl, randomValue = Math.random()) {
  const uniqueUrls = Array.from(new Set((Array.isArray(urls) ? urls : []).filter(Boolean)));
  if (!uniqueUrls.length) return "";
  if (uniqueUrls.length === 1) return uniqueUrls[0];

  const candidates = currentUrl ? uniqueUrls.filter((url) => url !== currentUrl) : uniqueUrls;
  const pool = candidates.length ? candidates : uniqueUrls;
  const clamped = Math.min(0.999999, Math.max(0, Number(randomValue) || 0));
  const index = Math.floor(clamped * pool.length);
  return pool[index] || pool[0] || "";
}

export function pickSequentialLoopMotionUrl(urls, currentUrl) {
  const uniqueUrls = Array.from(new Set((Array.isArray(urls) ? urls : []).filter(Boolean)));
  if (!uniqueUrls.length) return "";
  if (!currentUrl) return uniqueUrls[0];
  const currentIndex = uniqueUrls.indexOf(currentUrl);
  if (currentIndex === -1) return uniqueUrls[0];
  return uniqueUrls[(currentIndex + 1) % uniqueUrls.length] || uniqueUrls[0] || "";
}

function resolveVmdLoopPhase({ url, loopUrls, standbyUrl, resumePhase }) {
  if (resumePhase === "standby" || resumePhase === "standby-only" || resumePhase === "loop") {
    return resumePhase;
  }
  if (standbyUrl && url === standbyUrl) {
    return loopUrls.length ? "standby" : "standby-only";
  }
  return "loop";
}

function pickLoopMotionUrl(urls, currentUrl, loopMode) {
  if (loopMode === "sequential") return pickSequentialLoopMotionUrl(urls, currentUrl);
  return pickNextLoopMotionUrl(urls, currentUrl);
}

/**
 * @param {any} runtime
 * @param {{
 *   speaking?: boolean,
 *   interaction?: {
 *     mode?: string,
 *     vmdUrl?: string,
 *     vmdLoopUrls?: string[],
 *     standbyVmdUrl?: string,
 *     loopGapMs?: number,
 *     loopMode?: string,
 *     vmdLoopEmotionByUrl?: Record<string, string>,
 *     lockLowerBody?: boolean,
 *     lockRootPosition?: boolean,
 *     bakedBoneAnimation?: boolean,
 *     playerVmdMode?: string,
 *     vmdBakedBoneAnimationByUrl?: Record<string, boolean>,
 *     disableCrossfade?: boolean,
 *     playbackRate?: number
 *   },
 *   resolveUrl?: (url: string) => string
 * }} [options]
 */
export function applyStageRuntimeState(runtime, { speaking = false, interaction, resolveUrl = (url) => url } = {}) {
  if (!runtime) return;
  runtime.setSpeaking?.(speaking);
  if (!interaction) return;
  if (interaction.mode === "vmd" && interaction.vmdUrl) {
    const loopUrls = Array.isArray(interaction.vmdLoopUrls)
      ? interaction.vmdLoopUrls.map((url) => resolveUrl(url))
      : undefined;
    const standbyUrl = interaction.standbyVmdUrl ? resolveUrl(interaction.standbyVmdUrl) : "";
    const loopOptions = {
      standbyUrl,
      loopGapMs: interaction.loopGapMs,
      loopMode: interaction.loopMode,
    };
    if (typeof interaction.lockLowerBody === "boolean") loopOptions.lockLowerBody = interaction.lockLowerBody;
    if (typeof interaction.lockRootPosition === "boolean") loopOptions.lockRootPosition = interaction.lockRootPosition;
    if (interaction.bakedBoneAnimation) loopOptions.bakedBoneAnimation = true;
    if (interaction.playerVmdMode) loopOptions.playerVmdMode = interaction.playerVmdMode;
    if (interaction.vmdBakedBoneAnimationByUrl) {
      loopOptions.bakedBoneAnimationByUrl = Object.fromEntries(Object.entries(interaction.vmdBakedBoneAnimationByUrl)
        .map(([url, baked]) => [resolveUrl(url), baked]));
    }
    if (interaction.disableCrossfade) loopOptions.disableCrossfade = true;
    if (interaction.vmdLoopEmotionByUrl) {
      loopOptions.emotionByUrl = Object.fromEntries(
        Object.entries(interaction.vmdLoopEmotionByUrl).map(([url, emotion]) => [resolveUrl(url), emotion]),
      );
    }
    runtime.applyInteraction?.(interaction);
    runtime.playVmd?.(resolveUrl(interaction.vmdUrl), interaction.playbackRate, loopUrls, loopOptions);
    return;
  }
  runtime.applyInteraction?.(interaction);
}

export function clipAnimatesBone(clip, bone) {
  if (!clip?.tracks?.length || !bone?.name) return false;
  const boneName = `${bone.name}`;
  return clip.tracks.some((track) => `${track?.name || ""}`.includes(`bones[${boneName}]`));
}

function parseBoneTrackName(trackName) {
  const match = /^\.?bones\[([^\]]+)]\.(position|quaternion|scale)$/.exec(`${trackName || ""}`);
  if (!match) return null;
  return { boneName: match[1], property: match[2] };
}

function sampleTrackValue(track, seconds) {
  const times = track?.times;
  const values = track?.values;
  if (!times?.length || !values?.length) return null;
  const valueSize =
    typeof track.getValueSize === "function" ? track.getValueSize() : Math.max(1, values.length / times.length);
  const result = new Array(valueSize).fill(0);
  const epsilon = 1e-4;

  let rightIndex = 0;
  while (rightIndex < times.length && times[rightIndex] < seconds - epsilon) rightIndex += 1;

  if (rightIndex <= 0) {
    for (let offset = 0; offset < valueSize; offset += 1) result[offset] = values[offset];
    return result;
  }
  if (rightIndex >= times.length) {
    const start = (times.length - 1) * valueSize;
    for (let offset = 0; offset < valueSize; offset += 1) result[offset] = values[start + offset];
    return result;
  }

  const rightTime = times[rightIndex];
  const rightStart = rightIndex * valueSize;
  if (Math.abs(rightTime - seconds) <= epsilon) {
    for (let offset = 0; offset < valueSize; offset += 1) result[offset] = values[rightStart + offset];
    return result;
  }

  const leftIndex = rightIndex - 1;
  const leftTime = times[leftIndex];
  const leftStart = leftIndex * valueSize;
  const span = Math.max(epsilon, rightTime - leftTime);
  const alpha = THREE.MathUtils.clamp((seconds - leftTime) / span, 0, 1);

  if (valueSize === 4) {
    const left = new THREE.Quaternion(
      values[leftStart],
      values[leftStart + 1],
      values[leftStart + 2],
      values[leftStart + 3],
    );
    const right = new THREE.Quaternion(
      values[rightStart],
      values[rightStart + 1],
      values[rightStart + 2],
      values[rightStart + 3],
    );
    const sampled = new THREE.Quaternion().slerpQuaternions(left, right, alpha).normalize();
    return [sampled.x, sampled.y, sampled.z, sampled.w];
  }

  for (let offset = 0; offset < valueSize; offset += 1) {
    result[offset] = THREE.MathUtils.lerp(values[leftStart + offset], values[rightStart + offset], alpha);
  }
  return result;
}

function applyClipBoneTracksAtTime(model, clip, seconds) {
  const bones = model?.skeleton?.bones;
  if (!Array.isArray(bones) || !clip?.tracks?.length) return false;
  const boneByName = new Map(bones.map((bone) => [bone.name, bone]));
  let applied = false;

  for (const track of clip.tracks) {
    const parsed = parseBoneTrackName(track?.name);
    if (!parsed) continue;
    const bone = boneByName.get(parsed.boneName);
    if (!bone) continue;
    const value = sampleTrackValue(track, seconds);
    if (!value) continue;

    if (parsed.property === "quaternion" && value.length >= 4) {
      bone.quaternion.set(value[0], value[1], value[2], value[3]).normalize();
      applied = true;
    } else if (parsed.property === "position" && value.length >= 3) {
      bone.position.set(value[0], value[1], value[2]);
      applied = true;
    } else if (parsed.property === "scale" && value.length >= 3) {
      bone.scale.set(value[0], value[1], value[2]);
      applied = true;
    }
  }

  if (applied) {
    model.updateMatrixWorld?.(true);
    model.skeleton?.update?.();
  }
  return applied;
}

export function resetBonesNotAnimatedByClip(baseBoneTransforms = [], clip) {
  // 每帧只扫描一次轨道；逐骨扫描全部轨道会让密集辅助骨动作退化为平方复杂度。
  const animatedNames = new Set();
  for (const track of clip?.tracks || []) {
    for (const match of `${track?.name || ""}`.matchAll(/bones\[([^\]]+)\]/g)) {
      animatedNames.add(match[1]);
    }
  }
  for (const entry of baseBoneTransforms || []) {
    const bone = entry?.bone;
    if (!bone || animatedNames.has(bone.name)) continue;
    if (entry.position) bone.position?.copy?.(entry.position);
    if (entry.quaternion) bone.quaternion?.copy?.(entry.quaternion);
    if (entry.scale) bone.scale?.copy?.(entry.scale);
  }
}

export function isLowerBodyBoneName(name) {
  const lowerName = `${name || ""}`.toLowerCase();
  return LOWER_BODY_BONE_HINTS.some((hint) => lowerName.includes(hint.toLowerCase()));
}

export function resetLowerBodyBonesToBase(baseBoneTransforms = []) {
  for (const entry of baseBoneTransforms || []) {
    const bone = entry?.bone;
    if (!bone || !isLowerBodyBoneName(bone.name)) continue;
    if (entry.position) bone.position?.copy?.(entry.position);
    if (entry.quaternion) bone.quaternion?.copy?.(entry.quaternion);
    if (entry.scale) bone.scale?.copy?.(entry.scale);
  }
}

function describeMaterial(material) {
  return [
    material?.name,
    material?.map?.name,
    material?.alphaMap?.name,
    material?.userData?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function inferMaterialProfile(material) {
  const text = describeMaterial(material);
  const metalHints = ["metal", "armor", "steel", "blade", "weapon", "gun", "mecha", "buckle"];

  if (metalHints.some((hint) => text.includes(hint))) return "metal";
  if (FIXED_FACE_MATERIAL_HINTS.some((hint) => text.includes(hint))) return "face";
  if (FIXED_SKIN_MATERIAL_HINTS.some((hint) => text.includes(hint))) return "skin";
  if (FIXED_HAIR_MATERIAL_HINTS.some((hint) => text.includes(hint))) return "hair";
  if (FIXED_CLOTH_MATERIAL_HINTS.some((hint) => text.includes(hint))) return "cloth";
  return "default";
}

function hasMaterialHint(text, hints) {
  return hints.some((hint) => text.includes(hint));
}

export function inferRezeMaterialPreset(material) {
  const text = describeMaterial(material);
  const metalHints = ["metal", "armor", "steel", "blade", "weapon", "gun", "mecha", "buckle", "silver", "gold"];

  if (hasMaterialHint(text, REZE_EYE_MATERIAL_HINTS)) return "eye";
  if (hasMaterialHint(text, REZE_STOCKING_MATERIAL_HINTS)) return "stockings";
  if (hasMaterialHint(text, metalHints)) return "metal";
  if (hasMaterialHint(text, FIXED_FACE_MATERIAL_HINTS)) return "face";
  if (hasMaterialHint(text, FIXED_HAIR_MATERIAL_HINTS)) return "hair";
  if (hasMaterialHint(text, FIXED_SKIN_MATERIAL_HINTS)) return "body";
  if (hasMaterialHint(text, REZE_ROUGH_CLOTH_HINTS)) return "cloth_rough";
  if (hasMaterialHint(text, REZE_SMOOTH_CLOTH_HINTS) || hasMaterialHint(text, FIXED_CLOTH_MATERIAL_HINTS)) return "cloth_smooth";
  return "default";
}

function createToonRampTexture(pipeline = "classic", variant = "default") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 1;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const gradient = ctx.createLinearGradient(0, 0, 256, 0);
  if (pipeline === "hero-shot") {
    gradient.addColorStop(0, "#4d5365");
    gradient.addColorStop(0.45, "#4d5365");
    gradient.addColorStop(0.46, "#92a0b8");
    gradient.addColorStop(0.76, "#92a0b8");
    gradient.addColorStop(0.77, "#eef7ff");
  } else if (pipeline === "reze-npr" || pipeline === "reze-design") {
    gradient.addColorStop(0, "#3d3745");
    gradient.addColorStop(0.296, "#3d3745");
    gradient.addColorStop(0.302, "#c98d83");
    gradient.addColorStop(0.54, "#f2b8a6");
    gradient.addColorStop(0.545, "#fff1de");
  } else if (pipeline === "k3" && variant === "skin") {
    // 皮肤专用暖色渐变：全局 K3 渐变的暗部是冷蓝灰，乘在暖色皮肤贴图上会
    // 变成灰暗色（不像人类皮肤），这里暗部改用暖棕粉阶。
    gradient.addColorStop(0, "#a97a6c");
    gradient.addColorStop(0.249, "#a97a6c");
    gradient.addColorStop(0.25, "#e0ab97");
    gradient.addColorStop(0.449, "#e0ab97");
    gradient.addColorStop(0.45, "#ffe9dc");
    gradient.addColorStop(0.749, "#ffe9dc");
    gradient.addColorStop(0.75, "#ffffff");
  } else if (pipeline === "k3") {
    gradient.addColorStop(0, "#7d8492");
    gradient.addColorStop(0.249, "#7d8492");
    gradient.addColorStop(0.25, "#b9c0cb");
    gradient.addColorStop(0.449, "#b9c0cb");
    gradient.addColorStop(0.45, "#f2f4f8");
    gradient.addColorStop(0.749, "#f2f4f8");
    gradient.addColorStop(0.75, "#ffffff");
  } else if (pipeline === "genshin" || pipeline === "mio-reference") {
    gradient.addColorStop(0, "#505050");
    gradient.addColorStop(0.3, "#b4b4b4");
    gradient.addColorStop(0.7, "#ffffff");
  } else {
    gradient.addColorStop(0, "#505050");
    gradient.addColorStop(0.3, "#b4b4b4");
    gradient.addColorStop(0.7, "#ffffff");
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function primeMMDMaterial(material) {
  if (!material) return;
  const profile = inferMaterialProfile(material);

  if ("fog" in material) material.fog = false;
  if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
  if (material.emissiveMap) material.emissiveMap.colorSpace = THREE.SRGBColorSpace;

  const needsCutout =
    Boolean(material.transparent) ||
    (typeof material.opacity === "number" && material.opacity < 1) ||
    Boolean(material.alphaMap);

  return { needsCutout, profile };
}

function cleanLegacyMMDMaterialFlags(material) {
  if (!material) return;
  if ("skinning" in material) delete material.skinning;
  if ("morphTargets" in material) delete material.morphTargets;
}

function finalizeMMDMaterial(material, rampTexture) {
  if ("gradientMap" in material && rampTexture && !material.gradientMap) {
    material.gradientMap = rampTexture;
  }

  material.needsUpdate = true;
}

const GENSHIN_GLOW_HINTS = ["glow", "emissive", "purple", "fx"];
const GENSHIN_MASK_HINTS = ["mask", "face mask", "mouth mask"];

function normalizeGenshinMaterialName(materialName = "") {
  return `${materialName}`.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function isGenshinGlowMaterial(materialName = "") {
  const name = normalizeGenshinMaterialName(materialName);
  const tokens = name.split(" ").filter(Boolean);
  const hasExplicitGlow = GENSHIN_GLOW_HINTS.slice(0, 2).some((hint) => tokens.includes(hint));
  const hasPurpleFx = tokens.includes("purple") && tokens.includes("fx");
  return hasExplicitGlow || hasPurpleFx;
}

export function isGenshinSuppressedMaskMaterial(materialName = "") {
  const name = normalizeGenshinMaterialName(materialName);
  return GENSHIN_MASK_HINTS.some((hint) => name.includes(hint));
}

function getMaterialArray(material) {
  return (Array.isArray(material) ? material : [material]).filter(Boolean);
}

function pickOutlineProfile(materials) {
  const profiles = materials.map((material) => inferMaterialProfile(material));
  if (profiles.includes("face")) return "face";
  if (profiles.includes("skin")) return "skin";
  if (profiles.includes("hair")) return "hair";
  if (profiles.includes("cloth")) return "cloth";
  if (profiles.includes("metal")) return "metal";
  return "default";
}

function needsOutlineCutout(materials) {
  return materials.some((material) => {
    return (
      Boolean(material?.transparent) ||
      Boolean(material?.alphaMap) ||
      Boolean(material?.map) ||
      (typeof material?.opacity === "number" && material.opacity < 1)
    );
  });
}

function buildOutlineStyle(materials, presentation) {
  const profile = pickOutlineProfile(materials);
  const usesCutout = needsOutlineCutout(materials);
  const sourceMaterial = materials.find((material) => material?.map || material?.alphaMap || material?.alphaTest) || materials[0];
  const baseScale = presentation?.outline?.scale ?? 1.03;
  const baseOpacity = presentation?.outline?.opacity ?? 0.92;

  const profileStyle = {
    face: { scale: baseScale - 0.017, opacity: baseOpacity * 0.42 },
    skin: { scale: baseScale - 0.015, opacity: baseOpacity * 0.48 },
    hair: { scale: baseScale - 0.004, opacity: baseOpacity * 0.92 },
    cloth: { scale: baseScale - 0.008, opacity: baseOpacity * 0.82 },
    metal: { scale: baseScale - 0.01, opacity: baseOpacity * 0.76 },
    default: { scale: baseScale - 0.01, opacity: baseOpacity * 0.78 },
  }[profile];

  return {
    profile,
    usesCutout,
    sourceMaterial,
    scale: Math.max(1.004, profileStyle.scale),
    opacity: Math.min(1, Math.max(0.12, profileStyle.opacity)),
  };
}

function createVerticalGradientTexture(topColor, bottomColor) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, topColor);
  gradient.addColorStop(1, bottomColor);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createHaloTexture(color) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(256, 256, 20, 256, 256, 220);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.45, `${color}66`);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createConcentricRingTexture(color) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 28;
  ctx.globalAlpha = 0.88;

  const rings = [
    { radius: 405, width: 6 },
    { radius: 310, width: 3.5 },
    { radius: 220, width: 2.5 },
  ];

  for (const ring of rings) {
    ctx.beginPath();
    ctx.lineWidth = ring.width;
    ctx.arc(512, 512, ring.radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  return texture;
}

function createContactShadowTexture() {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const gradient = ctx.createRadialGradient(256, 256, 36, 256, 256, 236);
  gradient.addColorStop(0, "rgba(8, 15, 32, 0.78)");
  gradient.addColorStop(0.4, "rgba(8, 15, 32, 0.42)");
  gradient.addColorStop(1, "rgba(8, 15, 32, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  return texture;
}

function createStarfieldTexture(color = "#d8f5ff") {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < 140; index += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height * 0.92;
    const size = 1 + Math.random() * 2.4;
    const alpha = 0.25 + Math.random() * 0.7;
    ctx.beginPath();
    ctx.fillStyle = `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  return texture;
}

function createWaterlineTexture(topColor, bottomColor) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, topColor);
  gradient.addColorStop(0.55, topColor);
  gradient.addColorStop(1, bottomColor);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(222, 247, 255, 0.26)";
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.72;
  for (let row = 0; row < 9; row += 1) {
    const y = 48 + row * 42;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y + ((row % 2) ? 6 : -6));
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  return texture;
}

function createColorGradeShader(grade = {}) {
  return {
    uniforms: {
      tDiffuse: { value: null },
      exposure: { value: grade.exposure ?? 1 },
      contrast: { value: grade.contrast ?? 1 },
      saturation: { value: grade.saturation ?? 1 },
      warmth: { value: grade.warmth ?? 0 },
      shadowLift: { value: grade.shadowLift ?? 0 },
      linearToSRGB: { value: grade.linearToSRGB ? 1 : 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float exposure;
      uniform float contrast;
      uniform float saturation;
      uniform float warmth;
      uniform float shadowLift;
      uniform float linearToSRGB;
      varying vec2 vUv;

      void main() {
        vec4 texel = texture2D(tDiffuse, vUv);
        vec3 color = texel.rgb * exposure;
        color = (color - 0.5) * contrast + 0.5;
        float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(vec3(luminance), color, saturation);
        color.r += warmth;
        color.b -= warmth * 0.7;
        color = max(color, vec3(shadowLift));
        // postfx 链在渲染目标里是线性空间，而 ShaderPass 不带色彩空间转换。
        // 只有最后一步才允许做 linear→sRGB，否则整条链会以线性值直接上屏（画面发暗）。
        if (linearToSRGB > 0.5) {
          vec3 clamped = clamp(color, 0.0, 1.0);
          color = mix(clamped * 12.92, 1.055 * pow(clamped, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, clamped));
        }
        // 保留输入纹理 alpha。这样 Reze 的调色后处理不会把透明舞台填成黑底，
        // 页面底下的 MIO 星海背景可以继续透过最终 canvas 显示。
        gl_FragColor = vec4(color, texel.a);
      }
    `,
  };
}

export function tuneClassicMMDMaterial(material, rampTexture) {
  if (!material) return;
  const { needsCutout, profile } = primeMMDMaterial(material);

  if (needsCutout) material.alphaTest = Math.max(material.alphaTest || 0, 0.5);
  if (needsCutout || profile === "hair" || profile === "cloth") material.side = THREE.DoubleSide;

  if (profile === "face" || profile === "skin") {
    if ("shininess" in material && typeof material.shininess === "number") {
      material.shininess = Math.min(material.shininess, 18);
    }
    if ("specular" in material && material.specular?.isColor) {
      material.specular.multiplyScalar(0.45);
    }
    if ("emissiveIntensity" in material) material.emissiveIntensity = 0.16;
  } else if (profile !== "metal") {
    if ("shininess" in material && typeof material.shininess === "number") {
      material.shininess = Math.min(material.shininess, 26);
    }
    if ("specular" in material && material.specular?.isColor) {
      material.specular.multiplyScalar(0.72);
    }
  }

  finalizeMMDMaterial(material, rampTexture);
}

export function tuneHeroShotMMDMaterial(material, rampTexture) {
  if (!material) return;
  const { needsCutout, profile } = primeMMDMaterial(material);

  if (needsCutout) material.alphaTest = Math.max(material.alphaTest || 0, 0.52);
  if (needsCutout || profile === "hair" || profile === "cloth") material.side = THREE.DoubleSide;

  const profileTuning = {
    face: { shininess: 8, specular: 0.14, emissiveIntensity: 0.26, envMapIntensity: 0.14 },
    skin: { shininess: 10, specular: 0.18, emissiveIntensity: 0.22, envMapIntensity: 0.16 },
    hair: { shininess: 16, specular: 0.46, emissiveIntensity: 0.14, envMapIntensity: 0.28 },
    cloth: { shininess: 13, specular: 0.28, emissiveIntensity: 0.06, envMapIntensity: 0.2 },
    metal: { shininess: 34, specular: 0.72, emissiveIntensity: 0.06, envMapIntensity: 0.44 },
    default: { shininess: 18, specular: 0.42, emissiveIntensity: 0.1, envMapIntensity: 0.22 },
  };
  const tuning = profileTuning[profile] || profileTuning.default;

  if ("shininess" in material && typeof material.shininess === "number") {
    material.shininess = Math.min(material.shininess, tuning.shininess);
  }
  if ("specular" in material && material.specular?.isColor) {
    material.specular.multiplyScalar(tuning.specular);
  }
  if ("emissiveIntensity" in material) material.emissiveIntensity = tuning.emissiveIntensity;
  if ("envMapIntensity" in material) material.envMapIntensity = tuning.envMapIntensity;

  finalizeMMDMaterial(material, rampTexture);
}

export function tuneGenshinMMDMaterial(material, rampTexture, presentation = null) {
  if (!material) return;
  const { profile } = primeMMDMaterial(material);
  const materialName = `${material.name || ""}`;
  const normalizedName = normalizeGenshinMaterialName(materialName);
  const isGlowMaterial = isGenshinGlowMaterial(materialName);
  const isHeadFxMaterial = isGlowMaterial && normalizedName.includes("head");

  cleanLegacyMMDMaterialFlags(material);

  material.alphaTest = Math.max(material.alphaTest || 0, 0.5);
  material.side = THREE.DoubleSide;

  if ("shininess" in material && typeof material.shininess === "number" && profile !== "metal") {
    material.shininess = Math.min(material.shininess, profile === "face" || profile === "skin" ? 18 : 26);
  }
  if ("specular" in material && material.specular?.isColor && profile !== "metal") {
    material.specular.multiplyScalar(profile === "face" || profile === "skin" ? 0.45 : 0.72);
  }
  if ("envMapIntensity" in material) material.envMapIntensity = 0;

  if (isGlowMaterial) {
    material.emissive?.setHex?.(0x9d00ff);
    if ("emissiveIntensity" in material) material.emissiveIntensity = 1;
  } else {
    material.emissive?.setHex?.(0x000000);
    if ("emissiveIntensity" in material) material.emissiveIntensity = 0;
  }

  if (isGenshinSuppressedMaskMaterial(materialName) || isHeadFxMaterial) {
    material.visible = false;
    material.transparent = true;
    material.opacity = 0;
  }

  applyPresentationMaterialAdjustments(material, profile, presentation);
  finalizeMMDMaterial(material, rampTexture);
}

function clamp01(value, fallback = 0) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(1, Math.max(0, next));
}

function inferMaterialAdjustmentSlot(material, profile) {
  const text = describeMaterial(material);
  if (hasMaterialHint(text, REZE_EYE_MATERIAL_HINTS)) return "eye";
  if (profile === "face") return "face";
  if (profile === "skin") return "skin";
  if (profile === "hair") return "hair";
  if (profile === "cloth") return "cloth";
  return "default";
}

function multiplyNumberProperty(target, property, multiplier) {
  const nextMultiplier = Number(multiplier);
  if (!Number.isFinite(nextMultiplier) || !(property in target) || typeof target[property] !== "number") return;
  target[property] *= nextMultiplier;
}

function applyPresentationMaterialAdjustments(material, profile, presentation) {
  const adjustments = presentation?.materialAdjustments;
  if (!material || !adjustments) return;
  const slot = inferMaterialAdjustmentSlot(material, profile);
  const slotAdjustments = adjustments[slot] || adjustments.default || {};
  material.userData = {
    ...(material.userData || {}),
    mioMaterialAdjustmentSlot: slot,
  };

  multiplyNumberProperty(material, "opacity", adjustments.opacityMultiplier);
  multiplyNumberProperty(material, "shininess", adjustments.shininessMultiplier);
  multiplyNumberProperty(material, "emissiveIntensity", adjustments.emissiveIntensityMultiplier);
  multiplyNumberProperty(material, "envMapIntensity", adjustments.envMapIntensityMultiplier);
  if ("specular" in material && material.specular?.isColor && Number.isFinite(Number(adjustments.specularMultiplier))) {
    material.specular.multiplyScalar(Number(adjustments.specularMultiplier));
  }
  const alphaTest = Number(adjustments.alphaTest);
  if (Number.isFinite(alphaTest) && alphaTest > 0) {
    material.alphaTest = Math.max(material.alphaTest || 0, alphaTest);
  }
  const tintStrength = clamp01(slotAdjustments.tintStrength, 0);
  if (tintStrength > 0 && material.color?.isColor && slotAdjustments.tintColor) {
    material.color.lerp(new THREE.Color(slotAdjustments.tintColor), tintStrength);
  }
  material.needsUpdate = true;
}

export function tuneK3MMDMaterial(material, rampTexture, skinRampTexture = null) {
  if (!material) return;
  const { profile } = primeMMDMaterial(material);
  const materialName = `${material.name || ""}`;
  const normalizedName = normalizeGenshinMaterialName(materialName);
  const isGlowMaterial = isGenshinGlowMaterial(materialName);
  const isHeadFxMaterial = isGlowMaterial && normalizedName.includes("head");
  const isEyeMaterial = hasMaterialHint(describeMaterial(material), REZE_EYE_MATERIAL_HINTS);

  cleanLegacyMMDMaterialFlags(material);

  // 眼部高光/阴影叠加层（如克莱妲的 Eyes+ / EyeShadow，贴图 eyeblend 的 alpha
  // 大部分低于 0.5）：统一 alphaTest=0.5 会把高光弧和眼窝阴影整层裁掉，眼睛显得
  // 发闷无光。叠加层保留完整 alpha 渐变并按透明层渲染。
  const isEyeOverlayMaterial =
    isEyeMaterial && /(\+|plus|blend|shadow|hl|highlight)/i.test(materialName);

  if (isEyeOverlayMaterial) {
    material.alphaTest = 0;
    material.transparent = true;
    material.depthWrite = false;
    // 叠加层网格贴在眼球曲面内侧，正常深度测试会被眼球表面挡掉（高光弧不可见），
    // 用 polygonOffset 把它拉向镜头。
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;
  } else {
    material.alphaTest = Math.max(material.alphaTest || 0, 0.5);
  }
  material.side = THREE.DoubleSide;

  const profileTuning = {
    face: { shininessCap: 12, specular: 0.42, envMapIntensity: 0.08 },
    skin: { shininessCap: 14, specular: 0.5, envMapIntensity: 0.1 },
    hair: { shininessCap: 32, specular: 0.85, envMapIntensity: 0.18 },
    cloth: { shininessCap: 22, specular: 0.6, envMapIntensity: 0.12 },
    metal: { shininessCap: 96, specular: 1, envMapIntensity: 0.5 },
    default: { shininessCap: 24, specular: 0.7, envMapIntensity: 0.12 },
  };
  const tuning = isEyeMaterial
    ? { shininessFloor: 40, shininessCap: 72, specular: 1.15, envMapIntensity: 0.3 }
    : profileTuning[profile] || profileTuning.default;

  if ("shininess" in material && typeof material.shininess === "number") {
    if (Number.isFinite(tuning.shininessFloor)) {
      material.shininess = Math.max(material.shininess, tuning.shininessFloor);
    }
    if (Number.isFinite(tuning.shininessCap)) {
      material.shininess = Math.min(material.shininess, tuning.shininessCap);
    }
  }
  if ("specular" in material && material.specular?.isColor) {
    material.specular.multiplyScalar(tuning.specular);
  }
  if ("envMapIntensity" in material) material.envMapIntensity = tuning.envMapIntensity;

  if (isGlowMaterial) {
    material.emissive?.setHex?.(0x9d00ff);
    if ("emissiveIntensity" in material) material.emissiveIntensity = 1;
  } else if (isEyeMaterial) {
    // loader 按 PMX ambient 写入的灰色 emissive 取中档：既能抬起虹膜的蓝紫色
    // （克莱妲虹膜贴图本身是深海军蓝），又不至于像满档那样把色彩洗灰。
    if ("emissiveIntensity" in material) {
      material.emissiveIntensity = 0.55;
    }
    // 高光叠加层用加法混合，让白色高光弧真正亮起来
    if (isEyeOverlayMaterial && /(\+|plus|hl|highlight)/i.test(materialName)) {
      material.blending = THREE.AdditiveBlending;
    }
  } else if (profile === "face" || profile === "skin") {
    material.emissive?.setHex?.(0x1a110d);
    if ("emissiveIntensity" in material) material.emissiveIntensity = 0.14;
  } else {
    // 保留 MMDLoader 从 PMX ambient 写入的自发光（ambient×0.2，线性空间），只按
    // 材质类型打折。克莱妲等深色系模型的 albedo 极低，清零 emissive 会把暗部压成
    // 死黑；classic 管线正是靠保留这层自发光才有可读的灰蓝外套。头发全保留会发灰，
    // 金属少保留，布料/默认保留约一半，对齐 GFL2 实机的柔亮观感。
    const emissiveIntensity = { cloth: 0.65, metal: 0.3, hair: 0.05, default: 0.45 };
    if ("emissiveIntensity" in material) {
      material.emissiveIntensity = emissiveIntensity[profile] ?? emissiveIntensity.default;
    }
  }

  if (isGenshinSuppressedMaskMaterial(materialName) || isHeadFxMaterial) {
    material.visible = false;
    material.transparent = true;
    material.opacity = 0;
  }

  const isSkinMaterial = !isGlowMaterial && !isEyeMaterial && (profile === "face" || profile === "skin");
  const effectiveRamp = isSkinMaterial && skinRampTexture ? skinRampTexture : rampTexture;
  finalizeMMDMaterial(material, effectiveRamp);
}

export function tuneRezeNprMMDMaterial(material, rampTexture) {
  if (!material) return;
  const { needsCutout } = primeMMDMaterial(material);
  const preset = inferRezeMaterialPreset(material);

  cleanLegacyMMDMaterialFlags(material);

  material.userData = { ...(material.userData || {}), rezePreset: preset };
  if ("toneMapped" in material) material.toneMapped = true;
  if ("depthWrite" in material) material.depthWrite = true;

  if (needsCutout || preset === "stockings") {
    material.alphaHash = true;
    material.alphaToCoverage = true;
    material.alphaTest = Math.max(material.alphaTest || 0, preset === "stockings" ? 0.02 : 0.35);
    material.transparent = false;
    material.depthWrite = true;
  }

  if (needsCutout || preset === "hair" || preset === "stockings" || preset.startsWith("cloth")) {
    material.side = THREE.DoubleSide;
  }

  const setEmissive = (hex, intensity) => {
    material.emissive?.setHex?.(hex);
    if ("emissiveIntensity" in material) material.emissiveIntensity = intensity;
  };
  const multiplySpecular = (scalar) => {
    if ("specular" in material && material.specular?.isColor) {
      material.specular.multiplyScalar(scalar);
    }
  };
  const capShininess = (value) => {
    if ("shininess" in material && typeof material.shininess === "number") {
      material.shininess = Math.min(material.shininess, value);
    }
  };
  const floorShininess = (value) => {
    if ("shininess" in material && typeof material.shininess === "number") {
      material.shininess = Math.max(material.shininess, value);
    }
  };

  if (preset === "face" || preset === "body") {
    capShininess(preset === "face" ? 10 : 12);
    multiplySpecular(0.32);
    setEmissive(preset === "face" ? 0x2a100d : 0x24100d, preset === "face" ? 0.12 : 0.1);
    if ("envMapIntensity" in material) material.envMapIntensity = 0.08;
  } else if (preset === "hair") {
    floorShininess(34);
    multiplySpecular(1.12);
    setEmissive(0x08070d, 0.08);
    if ("envMapIntensity" in material) material.envMapIntensity = 0.18;
  } else if (preset === "eye") {
    floorShininess(48);
    multiplySpecular(1.45);
    setEmissive(0x1f2740, 0.42);
    if ("envMapIntensity" in material) material.envMapIntensity = 0.32;
  } else if (preset === "stockings") {
    capShininess(24);
    multiplySpecular(0.75);
    setEmissive(0x111018, 0.12);
    if ("envMapIntensity" in material) material.envMapIntensity = 0.16;
  } else if (preset === "metal") {
    floorShininess(60);
    multiplySpecular(1.18);
    setEmissive(0x0c0b10, 0.05);
    if ("envMapIntensity" in material) material.envMapIntensity = 0.48;
  } else if (preset === "cloth_rough") {
    capShininess(12);
    multiplySpecular(0.38);
    setEmissive(0x0f0d12, 0.06);
    if ("envMapIntensity" in material) material.envMapIntensity = 0.08;
  } else if (preset === "cloth_smooth") {
    capShininess(22);
    multiplySpecular(0.58);
    setEmissive(0x151018, 0.09);
    if ("envMapIntensity" in material) material.envMapIntensity = 0.14;
  } else {
    capShininess(26);
    multiplySpecular(0.7);
    if ("envMapIntensity" in material) material.envMapIntensity = 0.1;
  }

  finalizeMMDMaterial(material, rampTexture);
}

function tuneV14dGamePreparationMaterial(material, rampTexture) {
  if (!material) return;
  const { needsCutout } = primeMMDMaterial(material);
  if (needsCutout) material.side = THREE.DoubleSide;
  material.userData = { ...(material.userData || {}), v14dGamePreparation: true };
  finalizeMMDMaterial(material, rampTexture);
}

function tuneMaterialByPipeline(material, toonRampTexture, pipeline, presentation = null, skinRampTexture = null) {
  if (pipeline === "reze-npr" || pipeline === "reze-design") return tuneRezeNprMMDMaterial(material, toonRampTexture);
  if (pipeline === "hero-shot") return tuneHeroShotMMDMaterial(material, toonRampTexture);
  if (pipeline === "k3") return tuneK3MMDMaterial(material, toonRampTexture, skinRampTexture);
  if (pipeline === "genshin" || pipeline === "mio-reference") return tuneGenshinMMDMaterial(material, toonRampTexture, presentation);
  if (pipeline === "v14d-game") return tuneV14dGamePreparationMaterial(material, toonRampTexture);
  return tuneClassicMMDMaterial(material, toonRampTexture);
}

function createOutlineMaterial(materials, presentation) {
  const outlineStyle = buildOutlineStyle(materials, presentation);
  const sourceMaterial = outlineStyle.sourceMaterial;
  const outlineMaterial = new THREE.MeshBasicMaterial({
    color: presentation.outline.color,
    side: THREE.BackSide,
    transparent: true,
    opacity: outlineStyle.opacity,
    depthWrite: false,
    toneMapped: false,
  });

  if (outlineStyle.usesCutout) {
    if (sourceMaterial?.map) outlineMaterial.map = sourceMaterial.map;
    if (sourceMaterial?.alphaMap) outlineMaterial.alphaMap = sourceMaterial.alphaMap;
    outlineMaterial.alphaTest = Math.max(sourceMaterial?.alphaTest || 0, 0.48);
  }

  return { outlineMaterial, outlineStyle };
}

function createInvisibleOutlineMaterial(presentation) {
  const outlineMaterial = new THREE.MeshBasicMaterial({
    color: presentation?.outline?.color ?? 0x000000,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  });
  outlineMaterial.visible = false;
  return outlineMaterial;
}

function createSlotPreservingOutlineMaterials(sourceMaterials, presentation) {
  const visibleMaterials = sourceMaterials.filter((material) => material && material.visible !== false);
  const outlineStyle = buildOutlineStyle(visibleMaterials, presentation);
  const outlineMaterials = sourceMaterials.map((material) => {
    if (!material || material.visible === false) return createInvisibleOutlineMaterial(presentation);
    return createOutlineMaterial([material], presentation).outlineMaterial;
  });

  return { outlineMaterial: outlineMaterials, outlineStyle, outlineMaterials };
}

function readFaceDetailPoints(points) {
  if (!Array.isArray(points) || points.length < 2) return [];
  return points
    .map((point) => {
      if (!Array.isArray(point) || point.length !== 3) return null;
      const vector = point.map((value) => Number(value));
      if (vector.some((value) => !Number.isFinite(value))) return null;
      return new THREE.Vector3(...vector);
    })
    .filter(Boolean);
}

export class MMDCompanionRuntime {
  constructor({ container, statusElement, renderPipeline = "classic", cameraSnapshot = null, v14dGameManifest = null, resolveUrl = (url) => url, assetRequestHeaders = {} }) {
    this.container = container;
    this.statusElement = statusElement;
    this.renderPipeline = renderPipeline;
    this.v14dGameManifest = v14dGameManifest;
    this.resolveUrl = typeof resolveUrl === "function" ? resolveUrl : (url) => url;
    this.assetRequestHeaders = assetRequestHeaders && typeof assetRequestHeaders === "object" ? assetRequestHeaders : {};
    this.v14dGameLocalOcioDisplay = null;
    this.modelDisplayReady = renderPipeline !== "v14d-game" && renderPipeline !== "gf2";
    this.gf2Adapter = null;
    this.preparationController = new AbortController();
    this.v14dGameLights = [];
    this.v14dGameLightMapping = null;
    this.appearanceAdapter = renderPipeline === "v14d-game"
      ? createV14dGameAppearanceAdapter({ manifest: v14dGameManifest })
      : null;
    this.cameraSnapshot = cameraSnapshot;
    this.clock = new THREE.Clock();
    this.weapon = new StageWeaponAttachment(this);
    this.vmdClipCache = new VmdClipCache();
    this.mmdPreparation = new MmdPreparation();
    const textureManager = new THREE.LoadingManager();
    this.modelTexturesReady = new Promise((resolve) => { textureManager.onLoad = resolve; });
    this.loader = new MMDLoader(textureManager);
    if (renderPipeline === "v14d-game" || renderPipeline === "gf2") {
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((url) => url.replaceAll(String.fromCharCode(92), "/"));
      this.v14dAssetWarnings = [];
      this.v14dTexturesReady = new Promise((resolve) => { manager.onLoad = resolve; });
      manager.onError = (url) => this.v14dAssetWarnings.push({ url, kind: "load-error" });
      this.loader = new MMDLoader(manager);
      const extractExtension = this.loader._extractExtension.bind(this.loader);
      this.loader._extractExtension = (url) => extractExtension(url.split("?")[0].split("#")[0]);
      this.loader.loadPMX = (url, onLoad, _onProgress, onError) => {
        manager.itemStart(url);
        fetch(url, { cache: "default", headers: { ...this.assetRequestHeaders }, signal: this.preparationController.signal }).then(async (response) => {
          if (!response.ok) throw new Error("PMX读取失败：" + response.status);
          const buffer = await response.arrayBuffer();
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))).map(v => v.toString(16).padStart(2, "0")).join("");
          const expectedHash = renderPipeline === "gf2" ? GF2_MODEL_SHA256 : this.v14dGameManifest.model.sha256;
          if (hash !== expectedHash) throw new Error(renderPipeline === "gf2" ? "GF2 mode 需要已适配的克莱妲原皮动作兼容模型。" : "PMX哈希与清单不符");
          this.v14dModelSha256 = hash;
          if (this.destroyed) return;
          if (this.mmdPreparation.available) {
            const prepared = await this.mmdPreparation.run('pmx', { buffer });
            if (this.destroyed) return;
            onLoad({ ...prepared.data, stagePreparedGeometry: restorePreparedGeometry(prepared.geometry) });
          } else {
            onLoad(this.loader._getParser().parsePmx(buffer, true));
          }
        }).catch(error => onError?.(error)).finally(() => manager.itemEnd(url));
      };
      const build = this.loader.meshBuilder.build.bind(this.loader.meshBuilder);
      this.loader.meshBuilder.build = (data, ...args) => {
        const normalizeTextureReference = (value) => typeof value === "string" ? value.replaceAll(String.fromCharCode(92), "/").trim() : null;
        const textureReferences = data.textures.map(normalizeTextureReference);
        // 裸路径只有被同一PMX纹理表中的子文件证明为目录时才跳过；不按spa名称或扩展名屏蔽。
        const isOptionalDirectoryOrEmpty = (value) => value !== null && (value === "" || value.endsWith("/") || textureReferences.some((path) => path?.startsWith(value + "/") && path.length > value.length + 1));
        const materials = data.materials.map((m) => {
          let result = m;
          const env = normalizeTextureReference(data.textures[m.envTextureIndex]);
          const toon = normalizeTextureReference(data.textures[m.toonIndex]);
          if ((m.envFlag === 1 || m.envFlag === 2) && isOptionalDirectoryOrEmpty(env)) {
            this.v14dAssetWarnings.push({ material: m.name, optionalEnvironmentMap: env });
            result = { ...result, envTextureIndex: -1 };
          }
          if (m.toonFlag === 0 && isOptionalDirectoryOrEmpty(toon)) {
            this.v14dAssetWarnings.push({ material: m.name, optionalToonMap: toon });
            result = { ...result, toonFlag: 1, toonIndex: -1 };
          }
          return result;
        });
        const geometryBuilder = this.loader.meshBuilder.geometryBuilder;
        const originalGeometryBuild = geometryBuilder.build;
        if (data.stagePreparedGeometry) geometryBuilder.build = () => data.stagePreparedGeometry;
        try {
          const mesh = build({ ...data, materials }, ...args);
          if (renderPipeline === "gf2") {
            if (!mesh.geometry.getAttribute("gf2Uv")) attachGf2SecondaryUv(mesh, data);
            for (const [name, targets] of Object.entries(mesh.geometry.morphAttributes)) if (!targets.length) delete mesh.geometry.morphAttributes[name];
          }
          return mesh;
        }
        finally { geometryBuilder.build = originalGeometryBuild; }
      };
    }
    this.loader.crossOrigin = "anonymous";
    this.helper = new MMDAnimationHelper({ afterglow: 1.1 });
    this.hasPhysicsSupport = typeof globalThis.Ammo !== "undefined";

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.model = null;
    this.currentClip = null;
    this.currentVmdPlaybackRate = 1;
    this.currentVmdLoopUrls = [];
    this.currentVmdStandbyUrl = "";
    this.currentVmdLoopGapMs = 0;
    this.currentVmdLoopMode = "random";
    this.currentVmdLoopPhase = "loop";
    this.currentVmdLockLowerBody = false;
    this.currentVmdLockRootPosition = true;
    this.currentVmdBakedBoneAnimation = false;
    this.playerVmdMode = "baked";
    this.currentVmdBakedBoneAnimationByUrl = {};
    this.currentVmdDisableCrossfade = false;
    this.currentVmdEmotionByUrl = {};
    this.pendingVmdLoopUrl = "";
    this.lastPlayedLoopMotionUrl = "";
    this.currentVmdUrl = "";
    this.currentVmdStartedAt = 0;
    this.currentVmdDurationMs = 0;
    this.currentVmdAction = null;
    this.pendingVmdActionCleanups = [];
    this.isLoadingVmd = false;
    this.vmdLoadToken = 0;
    this.calibrationCaptureMode = false;
    this.currentAction = null;
    this.currentSequence = null;
    this.activeEmotion = "neutral";
    this.activeAction = "idle";
    this.isSpeaking = false;
    this.speakingStartedAtMs = 0;
    this.speechLevel = 0;
    this.speechLevelActive = false;
    this.destroyed = false;
    this.presentation = null;
    this.isKoledaModel = false;

    this.bones = {};
    this.baseBoneRotation = {};
    this.baseBoneTransforms = [];
    this.baseBoneTransformMap = new Map();
    this.vmdAnchorBones = [];
    this.animationBuildTarget = null;
    this.morphSlots = {};
    this.expressionMorphSlots = {};
    this.koledaClosedEyeMorphSlots = [];
    this.koledaMotionEyeMorphSlots = new Set();
    this.eyeMorphClip = null;
    this.animatedEyeMorphSlots = new Set();

    this.toonRampTexture = null;
    this.outlineObjects = [];
    this.outlineMaterials = [];
    this.faceDetailObjects = [];
    this.faceDetailMaterials = [];
    this.backdropGroup = null;
    this.backdropTextures = [];
    this.floorGroup = null;
    this.floorTextures = [];
    this.composer = null;
    this.renderPass = null;
    this.colorGradePass = null;
    this.bloomPass = null;
    this.cameraLocked = false;
    this.resizeObserver = null;
    this.stageLights = null;
    this.materialDebugIndex = new Map();
  }

  setStatus(text) {
    if (this.statusElement) this.statusElement.textContent = text;
  }

  getAppearanceStatus() {
    return this.appearanceAdapter?.getStatus?.() || null;
  }

  syncStageCanvasBox() {
    if (!this.container) return null;
    const stageElement = this.container.parentElement;
    const stageHeight = stageElement?.clientHeight || this.container.clientHeight || 0;
    if (stageHeight <= 0) return null;

    const stageWidth = stageElement?.clientWidth || this.container.clientWidth || 0;
    if (this.renderPipeline === "v14d-game" || this.renderPipeline === "gf2") {
      const width = Math.max(1, stageWidth), height = Math.max(1, stageHeight);
      this.container.style.width = width + "px";
      this.container.style.height = height + "px";
      this.container.style.minWidth = "0";
      this.container.style.minHeight = "0";
      return { width, height };
    }
    const coverWidth = Math.max(
      stageWidth,
      stageHeight * STAGE_CANVAS_ASPECT_RATIO,
    );
    const canvasWidth = Math.max(1, Math.round(coverWidth));
    const canvasHeight = Math.max(1, Math.round(canvasWidth / STAGE_CANVAS_ASPECT_RATIO));

    this.container.style.height = `${canvasHeight}px`;
    this.container.style.minHeight = `${canvasHeight}px`;
    this.container.style.maxHeight = "none";
    this.container.style.width = `${canvasWidth}px`;
    this.container.style.minWidth = `${canvasWidth}px`;
    this.container.style.maxWidth = "none";

    return {
      width: canvasWidth,
      height: canvasHeight,
    };
  }

  async init(modelUrl) {
    if (this.renderPipeline === "gf2") this.gf2LoadStarted = performance.now();
    if (this.destroyed) return;
    if (this.renderPipeline === "gf2") {
      const response = await fetch(this.resolveUrl(V14D_GAME_MANIFEST_URL), {
        headers: this.assetRequestHeaders, signal: this.preparationController.signal,
      });
      if (!response.ok) throw new Error(`GF2 mode 武器灯光读取失败（${response.status}）。`);
      this.gf2WeaponLightSources = (await response.json()).lights;
    }
    if (this.renderPipeline === "v14d-game") {
      await this.ensureV14dGameManifest();
    }
    if (this.destroyed) return;
    this.setupScene();
    if (this.renderPipeline === "v14d-game") {
      try {
        this.setStatus("正在加载本机 OCIO 显示配置……");
        const ocioDisplay = await createV14dGameLocalOcioDisplay({
          renderer: this.renderer,
          manifest: this.v14dGameManifest,
          fetchImpl: (url, init) => {
            const token = loadSession()?.token;
            return fetch(url, {
              ...init,
              headers: {
                ...this.assetRequestHeaders,
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(init?.headers || {}),
              },
            });
          },
        });
        if (this.destroyed) {
          ocioDisplay?.dispose?.();
          return;
        }
        this.v14dGameLocalOcioDisplay = ocioDisplay;
      } catch (error) {
        if (this.destroyed) return;
        this.dispose();
        throw new Error(`V14D 本机 OCIO 不可用：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (this.destroyed) return;
    this.bindResize();
    this.startRenderLoop();
    await this.loadModel(modelUrl);
  }

  async ensureV14dGameManifest() {
    if (!this.v14dGameManifest) {
      const response = await fetch(this.resolveUrl(V14D_GAME_MANIFEST_URL), {
        cache: "no-store",
        headers: { ...this.assetRequestHeaders },
      });
      if (!response?.ok) {
        throw new Error(`V14D 游戏外观清单请求失败（${response?.status || "未知"}）。`);
      }
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(`V14D 游戏外观清单返回了非 JSON 内容（${contentType || "未知"}）。`);
      }
      this.v14dGameManifest = await response.json();
    }
    const validation = validateV14dGameManifest(this.v14dGameManifest);
    if (!validation.ok) throw new Error(validation.reason);
    return this.v14dGameManifest;
  }

  setupScene() {
    const presentation = getStagePresentationConfig(this.renderPipeline);
    applyCameraSnapshotToPresentation(presentation, this.cameraSnapshot);
    this.presentation = presentation;
    this.scene = new THREE.Scene();
    this.scene.background = presentation.background ? new THREE.Color(presentation.background) : null;
    this.scene.fog = presentation.fog;

    this.setupRenderer(presentation);
    this.setupCamera(presentation);
    this.setupLights(presentation);
    this.setupFloor(presentation);
    this.setupBackdrop(presentation);
    this.setupVisualPipeline(presentation);
    this.setupPostprocessing(presentation);
  }

  setupRenderer(presentation) {
    const size = this.syncStageCanvasBox();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    const pixelRatioCap = Math.max(1, Number(presentation.renderer?.pixelRatioCap) || 2);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
    this.renderer.setSize(size?.width || this.container.clientWidth, size?.height || this.container.clientHeight);
    this.renderQuality = this.renderPipeline === "v14d-game" ? new StageRenderQuality(this.renderer) : null;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = presentation.renderer?.toneMapping === "aces" ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = presentation.renderer?.exposure ?? 1.04;
    this.renderer.shadowMap.enabled = this.renderPipeline !== "gf2";
    this.renderer.shadowMap.type = presentation.shadowMapType;
    this.container.replaceChildren(this.renderer.domElement);

    this.toonRampTexture = createToonRampTexture(this.renderPipeline);
    this.toonSkinRampTexture = this.renderPipeline === "k3" ? createToonRampTexture("k3", "skin") : null;
  }

  setupCamera(presentation) {
    this.camera = new THREE.PerspectiveCamera(presentation.camera.fov, 1, presentation.camera.near ?? 0.1, presentation.camera.far ?? 120);
    this.camera.position.fromArray(presentation.camera.position);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.fromArray(presentation.camera.target);
    const isCameraLocked = Boolean(presentation.camera.locked);
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = presentation.camera.minDistance;
    this.controls.maxDistance = presentation.camera.maxDistance;
    this.controls.maxPolarAngle = presentation.camera.maxPolarAngle;
    this.setCameraLocked(isCameraLocked);
  }

  setCameraLocked(locked) {
    if (!this.camera || !this.controls) return null;
    this.cameraLocked = Boolean(locked);
    this.controls.enabled = !this.cameraLocked;
    this.controls.enableRotate = !this.cameraLocked;
    this.controls.enablePan = !this.cameraLocked;
    this.controls.enableZoom = !this.cameraLocked;
    this.controls.enableDamping = !this.cameraLocked;
    if (this.cameraLocked) {
      this.camera.lookAt(this.controls.target);
    } else {
      this.controls.update();
    }
    return this.getCameraSnapshot();
  }

  getCameraSnapshot() {
    if (!this.camera || !this.controls) return null;
    return {
      fov: roundCameraNumber(this.camera.fov),
      position: this.camera.position.toArray().map(roundCameraNumber),
      target: this.controls.target.toArray().map(roundCameraNumber),
      locked: Boolean(this.cameraLocked),
    };
  }

  applyCameraSnapshot(snapshot, { locked } = {}) {
    if (!this.camera || !this.controls) return null;
    const camera = normalizeMmdCameraSnapshot(snapshot, this.presentation?.camera || STAGE_PRESENTATION_PRESETS.genshin.camera);
    this.cameraSnapshot = camera;
    if (this.presentation?.camera) {
      this.presentation.camera = {
        ...this.presentation.camera,
        ...camera,
      };
    }
    this.camera.fov = camera.fov;
    this.camera.position.fromArray(camera.position);
    this.controls.target.fromArray(camera.target);
    this.camera.updateProjectionMatrix();
    return this.setCameraLocked(locked ?? camera.locked);
  }

  resetCameraToDefault() {
    const presentation = getStagePresentationConfig(this.renderPipeline);
    this.cameraSnapshot = null;
    return this.applyCameraSnapshot(presentation.camera, { locked: presentation.camera.locked });
  }

  setupLights(presentation) {
    if (this.renderPipeline === "gf2") {
      this.stageLights = {};
      return;
    }
    if (this.renderPipeline === "v14d-game") {
      this.stageLights = { v14dGame: [] };
      this.v14dGameLights = [];
      this.v14dGameLightMapping = null;
      this.camera?.layers.enable(1);
      return;
    }
    const ambient = new THREE.AmbientLight(presentation.lights.ambient.color, presentation.lights.ambient.intensity);
    const hemisphere = new THREE.HemisphereLight(
      presentation.lights.hemisphere.sky,
      presentation.lights.hemisphere.ground,
      presentation.lights.hemisphere.intensity,
    );
    this.scene.add(ambient);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight(presentation.lights.key.color, presentation.lights.key.intensity);
    key.position.fromArray(presentation.lights.key.position);
    key.castShadow = true;
    const keyShadowMapSize = Math.max(512, Number(presentation.lights?.key?.shadowMapSize) || 2048);
    key.shadow.mapSize.set(keyShadowMapSize, keyShadowMapSize);
    key.shadow.normalBias = 0.012;
    key.shadow.bias = -0.00025;
    key.shadow.camera.left = -16;
    key.shadow.camera.right = 16;
    key.shadow.camera.top = 18;
    key.shadow.camera.bottom = -14;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(presentation.lights.fill.color, presentation.lights.fill.intensity);
    fill.position.fromArray(presentation.lights.fill.position);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(presentation.lights.rim.color, presentation.lights.rim.intensity);
    rim.position.fromArray(presentation.lights.rim.position);
    this.scene.add(rim);
    this.stageLights = { ambient, hemisphere, key, fill, rim };
  }

  disposeV14dGameLights() {
    for (const light of this.v14dGameLights) {
      this.scene?.remove(light);
      light.dispose?.();
    }
    this.v14dGameLights = [];
    if (this.renderPipeline === "v14d-game" || this.renderPipeline === "gf2") {
      this.stageLights = { v14dGame: [] };
      this.v14dGameLightMapping = null;
    }
  }

  configureV14dGameLights(fitResult) {
    if (this.renderPipeline !== "v14d-game" && this.renderPipeline !== "gf2") return null;
    const sourceLights = this.renderPipeline === "gf2" ? this.gf2WeaponLightSources : this.v14dGameManifest?.lights;
    if (!Array.isArray(sourceLights)) throw new Error("武器灯光清单缺失。");
    if (sourceLights.length !== 6) throw new Error("V14D 游戏外观六灯清单不完整。");

    RectAreaLightUniformsLib.init();
    this.disposeV14dGameLights();
    const sourceModelScale = 0.08;
    const modelScale = Number(fitResult?.scale);
    if (!Number.isFinite(modelScale) || modelScale <= 0) {
      throw new Error("V14D 游戏外观模型缩放无效。");
    }
    const scaleRatio = modelScale / sourceModelScale;
    const lights = sourceLights.map((source, index) => {
      const sourceWidth = source.shape === "DISK"
        ? Number(source.size) * Math.sqrt(Math.PI) / 2
        : Number(source.size);
      const sourceHeight = source.shape === "DISK"
        ? sourceWidth
        : Number(source.sizeY);
      const width = Math.max(0.0001, sourceWidth * scaleRatio);
      const height = Math.max(0.0001, sourceHeight * scaleRatio);
      const color = Array.isArray(source.color) ? source.color : [1, 1, 1];
      const light = new THREE.RectAreaLight(new THREE.Color().setRGB(...color), 1, width, height);
      light.power = Number(source.power) * scaleRatio * scaleRatio;
      light.name = source.name;
      const matrix = source.matrix;
      const convert = ([x, y, z]) => new THREE.Vector3(x, z, -y);
      const position = convert([matrix[0][3], matrix[1][3], matrix[2][3]]);
      const xAxis = convert([matrix[0][0], matrix[1][0], matrix[2][0]]);
      const yAxis = convert([matrix[0][1], matrix[1][1], matrix[2][1]]);
      const zAxis = convert([matrix[0][2], matrix[1][2], matrix[2][2]]);
      light.position.copy(position.multiplyScalar(scaleRatio)).add(this.model.position);
      light.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
      light.layers.set(0);
      light.userData = {
        pipeline: "v14d-game",
        sourceIndex: index,
        sourceName: source.name || `source-light-${index}`,
        sourceShape: source.shape,
        sourcePower: Number(source.power) || 0,
        sourceScale: sourceModelScale,
        scaleRatio,
        backgroundOnly: Boolean(source.backgroundOnly),
        useShadow: Boolean(source.useShadow),
      };
      this.scene.add(light);
      return light;
    });
    this.v14dGameLights = lights;
    this.stageLights = { v14dGame: lights };
    this.v14dGameLightMapping = {
      sourceModelScale,
      modelScale,
      scaleRatio,
      names: lights.map((light) => light.userData.sourceName),
    };
    return this.v14dGameLightMapping;
  }

  getMaterialDebugEntries() {
    if (!this.model) return [];
    const entries = [];
    this.materialDebugIndex = new Map();
    let meshIndex = 0;
    this.model.traverse((child) => {
      if (!child?.isMesh) return;
      const currentMeshIndex = meshIndex++;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.filter(Boolean).forEach((material, materialIndex) => {
        // PMX is reloaded into fresh Three.js objects each time, so UUIDs cannot
        // persist editor assignments. Traversal order + material slot is stable
        // for a model file and survives remounts without modifying the asset.
        const id = `mesh:${currentMeshIndex}:material:${materialIndex}`;
        this.materialDebugIndex.set(id, material);
        entries.push({
          id,
          name: material.name || child.name || `Material ${entries.length + 1}`,
          meshName: child.name || "Mesh",
          preset: material.userData?.rezePreset || inferMaterialProfile(material),
          visible: material.visible !== false,
          opacity: Number.isFinite(Number(material.opacity)) ? Number(material.opacity) : 1,
          emissiveIntensity: Number.isFinite(Number(material.emissiveIntensity)) ? Number(material.emissiveIntensity) : 0,
        });
      });
    });
    return entries;
  }

  updateMaterialDebug(id, patch = {}) {
    const material = this.materialDebugIndex.get(id);
    if (!material) return null;
    const base = material.userData?.stageDebugBase || {
      visible: material.visible !== false,
      opacity: Number.isFinite(Number(material.opacity)) ? Number(material.opacity) : 1,
      transparent: Boolean(material.transparent),
      depthWrite: material.depthWrite !== false,
      emissiveIntensity: Number.isFinite(Number(material.emissiveIntensity)) ? Number(material.emissiveIntensity) : 0,
    };
    material.userData = { ...(material.userData || {}), stageDebugBase: base };
    if (typeof patch.visible === "boolean") material.visible = patch.visible;
    if (Number.isFinite(Number(patch.opacity))) {
      const opacity = THREE.MathUtils.clamp(Number(patch.opacity), 0, 1);
      material.opacity = opacity;
      material.transparent = opacity < 0.999 || base.transparent;
      material.depthWrite = opacity >= 0.999 && base.depthWrite;
    }
    if (Number.isFinite(Number(patch.emissiveIntensity)) && "emissiveIntensity" in material) {
      material.emissiveIntensity = Math.max(0, Number(patch.emissiveIntensity));
    }
    material.needsUpdate = true;
    return {
      id,
      visible: material.visible !== false,
      opacity: Number(material.opacity ?? 1),
      emissiveIntensity: Number(material.emissiveIntensity ?? 0),
    };
  }

  resetMaterialDebug(id) {
    const material = this.materialDebugIndex.get(id);
    const base = material?.userData?.stageDebugBase;
    if (!material || !base) return null;
    material.visible = base.visible;
    material.opacity = base.opacity;
    material.transparent = base.transparent;
    material.depthWrite = base.depthWrite;
    if ("emissiveIntensity" in material) material.emissiveIntensity = base.emissiveIntensity;
    material.needsUpdate = true;
    return this.updateMaterialDebug(id, {});
  }

  setMaterialPreset(id, preset) {
    const material = this.materialDebugIndex.get(id);
    if (!material || !isRezeEditorPipeline(this.renderPipeline)) return null;
    const base = material.userData?.stagePresetBase || {
      shininess: Number(material.shininess ?? 30),
      emissiveIntensity: Number(material.emissiveIntensity ?? 0),
      opacity: Number(material.opacity ?? 1),
      transparent: Boolean(material.transparent),
      alphaTest: Number(material.alphaTest ?? 0),
    };
    material.userData = { ...(material.userData || {}), stagePresetBase: base, rezeEditorPreset: preset };
    if (preset === "默认") {
      material.shininess = base.shininess;
      material.emissiveIntensity = base.emissiveIntensity;
      material.opacity = base.opacity;
      material.transparent = base.transparent;
      material.alphaTest = base.alphaTest;
    } else if (preset === "眼睛") {
      material.emissiveIntensity = Math.max(base.emissiveIntensity, 0.45);
      material.shininess = Math.max(base.shininess, 90);
    } else if (preset === "金属") {
      material.shininess = Math.max(base.shininess, 110);
      material.emissiveIntensity = Math.min(base.emissiveIntensity, 0.05);
    } else if (preset === "半透材质") {
      material.transparent = true;
      material.opacity = Math.min(base.opacity, 0.58);
      material.alphaTest = Math.max(base.alphaTest, 0.08);
    } else if (preset === "角色皮肤" || preset === "面部") {
      material.shininess = Math.min(base.shininess, 18);
      material.emissiveIntensity = Math.max(base.emissiveIntensity, preset === "面部" ? 0.08 : 0.04);
    } else if (preset === "头发") {
      material.shininess = Math.max(base.shininess, 48);
    } else if (preset === "柔滑布料") {
      material.shininess = Math.max(base.shininess, 38);
    }
    material.needsUpdate = true;
    return { id, preset };
  }

  setSceneDebugSettings(settings = {}) {
    if (!this.presentation || !isRezeEditorPipeline(this.renderPipeline)) return null;
    const current = this.presentation.sceneDebugSettings || getRezeSceneDebugDefaults(this.renderPipeline);
    const next = { ...current, ...settings };
    this.presentation.sceneDebugSettings = next;
    const azimuth = THREE.MathUtils.degToRad(Number(next.sunAzimuth) || 0);
    const elevation = THREE.MathUtils.degToRad(Number(next.sunElevation) || 0);
    const keyRadius = 28;
    const keyPosition = [
      -keyRadius * Math.cos(elevation) * Math.sin(azimuth),
      keyRadius * Math.sin(elevation),
      -keyRadius * Math.cos(elevation) * Math.cos(azimuth),
    ];
    if (this.stageLights) {
      if (typeof next.worldColor === "string") {
        this.stageLights.ambient.color.set(next.worldColor);
        this.stageLights.hemisphere.color.set(next.worldColor);
      }
      if (typeof next.sunColor === "string") this.stageLights.key.color.set(next.sunColor);
      this.stageLights.ambient.intensity = Math.max(0, Number(next.ambientIntensity) || 0);
      this.stageLights.hemisphere.intensity = Math.max(0, Number(next.ambientIntensity) || 0);
      this.stageLights.key.intensity = Math.max(0, Number(next.keyIntensity) || 0);
      this.stageLights.key.position.fromArray(keyPosition);
    }
    if (this.bloomPass) {
      this.bloomPass.threshold = THREE.MathUtils.clamp(Number(next.bloomThreshold) || 0, 0, 1);
      this.bloomPass.strength = Math.max(0, Number(next.bloomStrength) || 0);
    }
    if (this.floorGroup) {
      this.floorGroup.traverse((child) => {
        if (!child?.material) return;
        const material = Array.isArray(child.material) ? child.material : [child.material];
        if (child.userData?.stageDebugRole === "shadow-catcher") {
          material.forEach((item) => {
            item.opacity = next.groundShadow === false ? 0 : THREE.MathUtils.clamp(Number(next.groundOpacity) || 0, 0, 1);
            item.needsUpdate = true;
          });
        }
      });
    }
    if (this.camera && this.controls) {
      const target = [Number(next.cameraTargetX) || 0, Number(next.cameraTargetY) || 0, Number(next.cameraTargetZ) || 0];
      this.controls.target.fromArray(target);
      this.camera.position.set(target[0], target[1], target[2] + Math.max(1, Number(next.cameraDistance) || 1));
      this.camera.updateProjectionMatrix();
      this.controls.update();
    }
    return { ...next };
  }

  resetSceneDebugSettings() {
    if (!isRezeEditorPipeline(this.renderPipeline)) return null;
    return this.setSceneDebugSettings(getRezeSceneDebugDefaults(this.renderPipeline));
  }

  setupFloor(presentation) {
    if (!Array.isArray(this.floorTextures)) this.floorTextures = [];
    this.disposeFloor();
    if (presentation.floor.enabled === false) return;

    const floorGroup = new THREE.Group();
    floorGroup.name = `${this.renderPipeline}-stage-floor`;

    const shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(presentation.floor.size, presentation.floor.size),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: presentation.floor.opacity }),
    );
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.y = presentation.floor.y;
    shadowCatcher.userData.stageDebugRole = "shadow-catcher";
    shadowCatcher.receiveShadow = true;
    floorGroup.add(shadowCatcher);

    if (presentation.floor.kind === "rezeDesignGround") {
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(presentation.floor.size, presentation.floor.size),
        new THREE.MeshBasicMaterial({
          color: presentation.floor.color || "#c800de",
          transparent: true,
          opacity: presentation.floor.opacity,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = presentation.floor.y - 0.002;
      floorGroup.add(ground);

      if (presentation.floor.grid?.enabled) {
        const grid = new THREE.GridHelper(
          presentation.floor.size,
          presentation.floor.grid.divisions || 32,
          presentation.floor.grid.color || "#fafaf9",
          presentation.floor.grid.color || "#fafaf9",
        );
        grid.position.y = presentation.floor.y + 0.003;
        const materials = Array.isArray(grid.material) ? grid.material : [grid.material];
        materials.forEach((material) => {
          material.transparent = true;
          material.opacity = presentation.floor.grid.opacity ?? 0.4;
          material.depthWrite = false;
          material.toneMapped = false;
        });
        floorGroup.add(grid);
      }
    }

    if (presentation.floor.glow?.enabled) {
      const glowTexture = createHaloTexture(presentation.floor.glow.color);
      if (glowTexture) this.floorTextures.push(glowTexture);
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.floor.glow.size),
        new THREE.MeshBasicMaterial({
          map: glowTexture,
          transparent: true,
          opacity: presentation.floor.glow.opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.fromArray(presentation.floor.glow.position);
      floorGroup.add(glow);
    }

    if (presentation.floor.rings?.enabled) {
      const ringTexture = createConcentricRingTexture(presentation.floor.rings.color);
      if (ringTexture) this.floorTextures.push(ringTexture);
      const rings = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.floor.rings.size),
        new THREE.MeshBasicMaterial({
          map: ringTexture,
          transparent: true,
          opacity: presentation.floor.rings.opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      rings.rotation.x = -Math.PI / 2;
      rings.position.fromArray(presentation.floor.rings.position);
      floorGroup.add(rings);
    }

    if (presentation.floor.contactShadow?.enabled) {
      const contactShadowTexture = createContactShadowTexture();
      if (contactShadowTexture) this.floorTextures.push(contactShadowTexture);
      const contactShadow = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.floor.contactShadow.size),
        new THREE.MeshBasicMaterial({
          map: contactShadowTexture,
          transparent: true,
          opacity: presentation.floor.contactShadow.opacity,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      contactShadow.rotation.x = -Math.PI / 2;
      contactShadow.position.fromArray(presentation.floor.contactShadow.position);
      floorGroup.add(contactShadow);
    }

    if (presentation.floor.water?.enabled) {
      const waterTexture = createWaterlineTexture(
        presentation.floor.water.topColor,
        presentation.floor.water.bottomColor,
      );
      if (waterTexture) this.floorTextures.push(waterTexture);
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.floor.water.size),
        new THREE.MeshBasicMaterial({
          map: waterTexture,
          transparent: true,
          opacity: presentation.floor.water.opacity,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.fromArray(presentation.floor.water.position);
      floorGroup.add(water);
    }

    if (presentation.floor.horizonGlow?.enabled) {
      const horizonGlowTexture = createHaloTexture(presentation.floor.horizonGlow.color);
      if (horizonGlowTexture) this.floorTextures.push(horizonGlowTexture);
      const horizonGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.floor.horizonGlow.size),
        new THREE.MeshBasicMaterial({
          map: horizonGlowTexture,
          transparent: true,
          opacity: presentation.floor.horizonGlow.opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      horizonGlow.rotation.x = -Math.PI / 2;
      horizonGlow.position.fromArray(presentation.floor.horizonGlow.position);
      floorGroup.add(horizonGlow);
    }

    this.floorGroup = floorGroup;
    this.scene.add(floorGroup);
  }

  setupBackdrop(presentation) {
    if (!Array.isArray(this.backdropTextures)) this.backdropTextures = [];
    this.disposeBackdrop();
    if (!presentation.backdrop?.enabled) return;

    const backdrop = new THREE.Group();
    backdrop.name = `${this.renderPipeline}-backdrop`;

    if (presentation.backdrop.panelSize) {
      const panelTexture = createVerticalGradientTexture(
        presentation.backdrop.panelColorTop,
        presentation.backdrop.panelColorBottom,
      );
      if (panelTexture) this.backdropTextures.push(panelTexture);
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.backdrop.panelSize),
        new THREE.MeshBasicMaterial({
          map: panelTexture,
          transparent: true,
          opacity: presentation.backdrop.panelOpacity,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      panel.position.fromArray(presentation.backdrop.panelPosition);
      panel.renderOrder = -8;
      backdrop.add(panel);
    }

    if (presentation.backdrop.haloSize) {
      const haloTexture = createHaloTexture(presentation.backdrop.haloColor);
      if (haloTexture) this.backdropTextures.push(haloTexture);
      const halo = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.backdrop.haloSize),
        new THREE.MeshBasicMaterial({
          map: haloTexture,
          transparent: true,
          opacity: presentation.backdrop.haloOpacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      halo.position.fromArray(presentation.backdrop.haloPosition);
      halo.renderOrder = -4;
      backdrop.add(halo);
    }

    if (presentation.backdrop.ringSize) {
      const ringTexture = createConcentricRingTexture(presentation.backdrop.ringColor);
      if (ringTexture) this.backdropTextures.push(ringTexture);
      const ring = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.backdrop.ringSize),
        new THREE.MeshBasicMaterial({
          map: ringTexture,
          transparent: true,
          opacity: presentation.backdrop.ringOpacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      ring.position.fromArray(presentation.backdrop.ringPosition);
      ring.renderOrder = -3;
      backdrop.add(ring);
    }

    if (presentation.backdrop.skySize) {
      const skyTexture = createVerticalGradientTexture(
        presentation.backdrop.skyColorTop,
        presentation.backdrop.skyColorBottom,
      );
      if (skyTexture) this.backdropTextures.push(skyTexture);
      const sky = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.backdrop.skySize),
        new THREE.MeshBasicMaterial({
          map: skyTexture,
          transparent: true,
          opacity: presentation.backdrop.skyOpacity ?? 1,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      sky.position.fromArray(presentation.backdrop.skyPosition);
      sky.renderOrder = -30;
      backdrop.add(sky);
    }

    if (presentation.backdrop.starfieldSize) {
      const starfieldTexture = createStarfieldTexture(presentation.backdrop.starfieldColor);
      if (starfieldTexture) this.backdropTextures.push(starfieldTexture);
      const starfield = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.backdrop.starfieldSize),
        new THREE.MeshBasicMaterial({
          map: starfieldTexture,
          transparent: true,
          opacity: presentation.backdrop.starfieldOpacity ?? 0.7,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      starfield.position.fromArray(presentation.backdrop.starfieldPosition);
      starfield.renderOrder = -24;
      backdrop.add(starfield);
    }

    if (presentation.backdrop.nebulaSize) {
      const nebulaTexture = createHaloTexture(presentation.backdrop.nebulaColor);
      if (nebulaTexture) this.backdropTextures.push(nebulaTexture);
      const nebula = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.backdrop.nebulaSize),
        new THREE.MeshBasicMaterial({
          map: nebulaTexture,
          transparent: true,
          opacity: presentation.backdrop.nebulaOpacity ?? 0.2,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      nebula.position.fromArray(presentation.backdrop.nebulaPosition);
      nebula.renderOrder = -18;
      backdrop.add(nebula);
    }

    if (presentation.backdrop.horizonSize) {
      const horizonTexture = createVerticalGradientTexture(
        presentation.backdrop.horizonColorTop,
        presentation.backdrop.horizonColorBottom,
      );
      if (horizonTexture) this.backdropTextures.push(horizonTexture);
      const horizon = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.backdrop.horizonSize),
        new THREE.MeshBasicMaterial({
          map: horizonTexture,
          transparent: true,
          opacity: presentation.backdrop.horizonOpacity ?? 0.5,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      horizon.position.fromArray(presentation.backdrop.horizonPosition);
      horizon.renderOrder = -12;
      backdrop.add(horizon);
    }

    this.backdropGroup = backdrop;
    this.scene.add(backdrop);
  }

  setupVisualPipeline(presentation) {
    if (this.renderPipeline === "v14d-game") {
      this.setupV14dGamePreparationPipeline(presentation);
      return;
    }
    if (this.renderPipeline === "genshin" || this.renderPipeline === "mio-reference") {
      this.setupGenshinPipeline(presentation);
      return;
    }
    this.setupClassicPipeline(presentation);
  }

  setupClassicPipeline(_presentation) {}

  setupGenshinPipeline(_presentation) {}

  setupV14dGamePreparationPipeline(_presentation) {}

  shouldUsePostFX(presentation = this.presentation) {
    return Boolean(presentation?.postfx?.enabled);
  }

  shouldUseBloom(presentation = this.presentation) {
    if (!presentation?.postfx?.enabled) return false;
    // three-stdlib 的 UnrealBloomPass 会先以不透明的基础材质回填最终帧。
    // 对 background:null 的 Reze 舞台，这会把本应透明的区域写成黑色；
    // 因此透明舞台仅保留 alpha 安全的调色链，MIO CSS 背景继续作为背景层。
    if (presentation.background == null) return false;
    return Number(presentation.postfx.bloomStrength) > 0;
  }

  setupPostprocessing(presentation) {
    this.disposePostprocessing();
    if (!this.shouldUsePostFX(presentation)) return;
    if (!this.renderer?.getSize || !this.renderer?.getPixelRatio) return;

    this.composer = new EffectComposer(this.renderer);
    // 为透明舞台显式指定 0 alpha，而非依赖 RenderPass/renderer 的默认值。
    // 后续调色 ShaderPass 保留该 alpha；会回填不透明底色的 Bloom Pass 已在透明模式禁用。
    const clearColor = presentation.background == null ? new THREE.Color(0x000000) : undefined;
    const clearAlpha = presentation.background == null ? 0 : 1;
    this.renderPass = new RenderPass(this.scene, this.camera, undefined, clearColor, clearAlpha);
    this.composer.addPass(this.renderPass);

    this.colorGradePass = new ShaderPass(createColorGradeShader(presentation.postfx.grade));
    this.composer.addPass(this.colorGradePass);

    if (this.shouldUseBloom(presentation)) {
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(this.container.clientWidth || 1, this.container.clientHeight || 1),
        presentation.postfx.bloomStrength,
        presentation.postfx.bloomRadius,
        presentation.postfx.bloomThreshold,
      );
      this.composer.addPass(this.bloomPass);
    } else {
      this.bloomPass = null;
    }
  }

  bindResize() {
    this.handleResize = () => {
      if (!this.renderer || !this.camera || !this.container) return;
      const size = this.syncStageCanvasBox();
      const width = size?.width || this.container.clientWidth;
      const height = size?.height || this.container.clientHeight;
      if (width === 0 || height === 0) return;
      this.camera.aspect = this.renderPipeline === "v14d-game" || this.renderPipeline === "gf2" ? width / height : STAGE_CANVAS_ASPECT_RATIO;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
      this.composer?.setSize?.(width, height);
      this.bloomPass?.setSize?.(width, height);
    };
    window.addEventListener("resize", this.handleResize);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.handleResize?.();
      });
      this.resizeObserver.observe(this.container);
      this.resizeObserver.observe(this.container.parentElement || this.container);
    }
    this.handleResize();
  }

  hitTestModelAtClientPoint(clientX, clientY) {
    if (!this.model || !this.camera || !this.renderer?.domElement) return false;
    const rect = this.renderer.domElement.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return false;

    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.model.updateMatrixWorld?.(true);
    // 点击射线不一定与绘制相机同向，不能复用按相机延迟更新的包围球。
    if (this.renderPipeline === "v14d-game" || this.renderPipeline === "gf2") this.model.computeBoundingSphere?.();
    this.camera.updateMatrixWorld?.(true);

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    // GF2的多遍子网格只负责着色；点击同一人物无需重复检测每一份绘制副本。
    return raycaster.intersectObject(this.model, this.renderPipeline !== "gf2").some((hit) => hit?.object?.visible !== false);
  }

  capturePngDataUrl() {
    if (!this.renderer?.domElement || !this.scene || !this.camera) return null;
    const quality = this.renderQuality;
    const previousScale = quality?.scale ?? 1;
    try {
      quality?.applyScale(1);
      this.renderScene();
      return this.renderer.domElement.toDataURL("image/png");
    } catch {
      return null;
    } finally {
      if (quality && previousScale !== 1) {
        quality.applyScale(previousScale);
        this.renderScene();
      }
    }
  }

  setRenderQuality(mode) {
    this.renderQuality?.setMode(mode);
  }

  clearModel() {
    ++this.vmdLoadToken;
    this.mmdPreparation?.dispose();
    this.vmdClipCache.clear();
    // 已在读取的旧模型请求只能写入旧缓存，不能回填到新模型。
    this.vmdClipCache = new VmdClipCache();
    this.weapon?.clear();
    this.gf2Adapter?.dispose();
    this.gf2Adapter = null;
    this.updateBakedGarmentMorphs = null;
    this.appearanceAdapter?.release?.();
    this.disposeCharacterOutline();
    this.disposeFaceDetails();
    this.materialDebugIndex.clear();
    if (!this.model) return;
    try {
      this.helper.remove(this.model);
    } catch {
      // ignore removal errors
    }
    this.scene.remove(this.model);
    this.model.traverse((child) => {
      if (child.isMesh) {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
        else child.material?.dispose?.();
      }
    });
    this.model = null;
    this.currentClip = null;
    this.currentVmdLoopUrls = [];
    this.currentVmdStandbyUrl = "";
    this.currentVmdLoopGapMs = 0;
    this.currentVmdLoopMode = "random";
    this.currentVmdLoopPhase = "loop";
    this.currentVmdLockLowerBody = false;
    this.currentVmdLockRootPosition = true;
    this.currentVmdBakedBoneAnimation = false;
    this.currentVmdBakedBoneAnimationByUrl = {};
    this.helper?.enable?.("ik", true);
    this.helper?.enable?.("grant", true);
    this.currentVmdDisableCrossfade = false;
    this.currentVmdEmotionByUrl = {};
    this.pendingVmdLoopUrl = "";
    this.lastPlayedLoopMotionUrl = "";
    this.currentVmdUrl = "";
    this.currentVmdStartedAt = 0;
    this.currentVmdDurationMs = 0;
    this.currentVmdAction = null;
    this.pendingVmdActionCleanups = [];
    this.isLoadingVmd = false;
    this.bones = {};
    this.baseBoneRotation = {};
    this.baseBoneTransforms = [];
    this.baseBoneTransformMap = new Map();
    this.vmdAnchorBones = [];
    this.animationBuildTarget = null;
    this.morphSlots = {};
    this.koledaClosedEyeMorphSlots = [];
    this.koledaMotionEyeMorphSlots = new Set();
    this.eyeMorphClip = null;
    this.animatedEyeMorphSlots = new Set();
  }

  async loadModel(modelUrl) {
    if (this.renderPipeline === "v14d-game" || this.renderPipeline === "gf2") this.modelDisplayReady = false;
    const effectiveModelUrl = this.renderPipeline === "v14d-game"
      ? this.v14dGameManifest?.model?.url
      : modelUrl;
    if (!effectiveModelUrl) throw new Error("V14D 游戏外观模型 URL 缺失。");
    this.setStatus(this.renderPipeline === "gf2" ? "GF2 mode · 正在加载人物模型……" : this.renderPipeline === "v14d-game" ? "正在加载 Koleda 游戏模型……" : "Loading MMD model...");
    this.clearModel();
    this.isKoledaModel = isKoledaModelIdentifier(
      effectiveModelUrl,
      this.v14dGameManifest?.model?.relativePath,
    );
    const modelLoadStarted = performance.now();
    const mesh = await new Promise((resolve, reject) => {
      this.loader.load(effectiveModelUrl, resolve, undefined, reject);
    });
    await (this.renderPipeline === "v14d-game" || this.renderPipeline === "gf2" ? this.v14dTexturesReady : this.modelTexturesReady);
    if (this.destroyed) {
      disposeUnattachedMmdObject(mesh);
      return;
    }
    if (this.renderPipeline === "gf2") this.gf2ModelLoadMs = performance.now() - modelLoadStarted;
    mesh.position.set(0, 0, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (this.renderPipeline === "gf2") {
          if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
          material.emissive?.set(0); material.emissiveIntensity = 0;
          if (!material.gradientMap?.image) material.gradientMap = null;
        } else if (this.renderPipeline !== "v14d-game") tuneMaterialByPipeline(material, this.toonRampTexture, this.renderPipeline, this.presentation, this.toonSkinRampTexture);
        if (this.isKoledaModel && isKoledaMaskMaterialName(material?.name)) {
          material.visible = false;
          material.transparent = true;
          material.opacity = 0;
          material.needsUpdate = true;
        }
      }
    });
    const fitResult = fitModelToPresentation(mesh, this.presentation);
    if (!fitResult) throw new Error("MMD 模型包围盒无效，无法接入舞台。");
    this.scene.add(mesh);
    this.model = mesh;
    this.helper.add(mesh, { physics: this.hasPhysicsSupport });
    this.captureBones(mesh);
    this.updateBakedGarmentMorphs = this.hasIndependentBakedGarments ? prepareBakedGarmentMorphs(mesh) : null;
    try {
      if (this.renderPipeline === "gf2") {
        mesh.frustumCulled = false;
        // 捕获材质不读取Three灯光；六灯仅供原有独立武器材质使用。
        this.configureV14dGameLights(fitResult);
        this.setStatus("正在加载 GF2 mode 原始材质与兵营光照……");
        this.gf2Adapter = await createGf2CapturedMaterials(mesh, this.resolveUrl(GF2_FRAME_ROOT), {
          fetchImpl: (url) => fetch(url, { signal: this.preparationController.signal, headers: this.assetRequestHeaders }),
          transparentOutput: true,
          onProgress: ({loaded,total,unit}) => this.setStatus(`GF2 mode · 正在加载${unit || "材质"} ${loaded} / ${total}`),
        });
      }
      if (this.renderPipeline === "v14d-game") {
        this.configureV14dGameLights(fitResult);
      }
      const appearanceStatus = await this.appearanceAdapter?.install?.({
        runtime: this,
        model: mesh,
        modelUrl: effectiveModelUrl,
        manifest: this.v14dGameManifest,
        presentation: this.presentation,
      });
      if (this.renderPipeline === "v14d-game" && appearanceStatus?.phase !== "ready") {
        throw new Error(appearanceStatus?.reason || "V14D 游戏外观适配器未就绪。");
      }
      if (this.destroyed) {
        this.clearModel();
        this.disposeV14dGameLights();
        return;
      }
    } catch (error) {
      if (this.destroyed) {
        this.clearModel();
        this.disposeV14dGameLights();
        return;
      }
      this.clearModel();
      this.disposeV14dGameLights();
      throw error;
    }
    this.getMaterialDebugEntries();
    this.attachFaceDetails(mesh, this.presentation);
    if (this.presentation?.outline?.enabled) {
      this.attachCharacterOutline(mesh, this.presentation);
    }
    if (this.renderPipeline === "v14d-game") {
      this.setStatus("正在准备角色显示程序……");
      await this.v14dGameLocalOcioDisplay.prepare(this.scene, this.camera, this.preparationController.signal);
      if (this.destroyed) return;
      this.modelDisplayReady = true;
    }
    if (this.renderPipeline === "gf2") {
      this.modelDisplayReady = true;
      Object.assign(this.gf2Adapter.stats.timings,{modelMs:this.gf2ModelLoadMs,runtimeReadyMs:performance.now()-this.gf2LoadStarted});
    }
    const appearanceStatus = this.appearanceAdapter?.getStatus?.();
    this.setStatus(this.renderPipeline === "gf2" ? "GF2 mode · 材质已就绪，正在显示角色……" : appearanceStatus?.label || "Model ready.");
    // MMDLoader 会为 toonIndex 指向空贴图路径（如克莱妲 PMX 里的 'spa/'）的材质
    // 挂上永远加载失败的 gradientMap（image 为空），导致 MeshToonMaterial 的 direct
    // light 被 ramp 采样成 0，材质只剩环境光而发闷（眼睛的蓝色虹膜就是这样变黑的）。
    // 等正常贴图加载落定后统一把坏 gradientMap 替换成管线 ramp。
    window.setTimeout(() => this.repairBrokenGradientMaps(), 1500);
  }

  repairBrokenGradientMaps(root = this.model) {
    if (!root) return;
    root.traverse((child) => {
      if (!child.isMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        const gm = material.gradientMap;
        if (!gm) continue;
        const img = gm.image;
        if (img && Number(img.width) > 0) continue;
        const profile = inferMaterialProfile(material);
        const isEye = hasMaterialHint(describeMaterial(material), REZE_EYE_MATERIAL_HINTS);
        const useSkin =
          this.toonSkinRampTexture && !isEye && (profile === "face" || profile === "skin");
        material.gradientMap = useSkin ? this.toonSkinRampTexture : this.toonRampTexture;
        material.needsUpdate = true;
      }
    });
  }

  attachFaceDetails(_mesh, presentation = this.presentation) {
    this.disposeFaceDetails();
    const chinLine = presentation?.faceDetails?.chinLine;
    if (!chinLine?.enabled) return;

    const anchor = chinLine.anchor === "neck"
      ? this.bones?.neck || this.bones?.head
      : this.bones?.head || this.bones?.neck;
    if (!anchor?.add) return;

    const points = readFaceDetailPoints(chinLine.points);
    if (points.length < 2) return;

    const curve = new THREE.CatmullRomCurve3(points);
    const geometry = new THREE.TubeGeometry(
      curve,
      Math.max(2, Math.round(Number(chinLine.tubularSegments) || 18)),
      Math.max(0.001, Number(chinLine.radius) || 0.012),
      Math.max(3, Math.round(Number(chinLine.radialSegments) || 5)),
      false,
    );
    const material = new THREE.MeshBasicMaterial({
      color: chinLine.color || "#2f2632",
      transparent: true,
      opacity: Math.min(1, Math.max(0, Number(chinLine.opacity) || 0.38)),
      depthWrite: false,
      toneMapped: false,
    });
    const line = new THREE.Mesh(geometry, material);
    line.name = `${this.renderPipeline}__chin-line`;
    line.renderOrder = 8;
    anchor.add(line);
    this.faceDetailObjects.push(line);
    this.faceDetailMaterials.push(material);
  }

  attachCharacterOutline(mesh, presentation = this.presentation) {
    this.disposeCharacterOutline();
    if (!presentation?.outline?.enabled) return;

    mesh.traverse((child) => {
      if (!child.isMesh) return;
      const isGenshinOutline = this.renderPipeline === "genshin" || this.renderPipeline === "mio-reference";
      const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
      const materials = getMaterialArray(child.material);
      if (isGenshinOutline && materials.length && materials.every((material) => material.visible === false)) return;
      const hasHiddenMaterialSlot =
        isGenshinOutline && Array.isArray(child.material) && sourceMaterials.some((material) => material?.visible === false);
      const { outlineMaterial, outlineStyle, outlineMaterials } = hasHiddenMaterialSlot
        ? createSlotPreservingOutlineMaterials(sourceMaterials, presentation)
        : { ...createOutlineMaterial(materials, presentation), outlineMaterials: null };
      this.outlineMaterials.push(...(outlineMaterials || [outlineMaterial]));

      let outlineMesh;
      if (child.isSkinnedMesh && child.skeleton) {
        outlineMesh = new THREE.SkinnedMesh(child.geometry, outlineMaterial);
        outlineMesh.bind(child.skeleton, child.bindMatrix);
        outlineMesh.bindMode = child.bindMode;
        outlineMesh.frustumCulled = false;
      } else {
        outlineMesh = new THREE.Mesh(child.geometry, outlineMaterial);
      }

      outlineMesh.name = `${child.name || "mesh"}__outline`;
      outlineMesh.position.copy(child.position);
      outlineMesh.quaternion.copy(child.quaternion);
      outlineMesh.scale.copy(child.scale).multiplyScalar(outlineStyle.scale);
      outlineMesh.renderOrder = (child.renderOrder || 0) - 1;

      const parent = child.parent || mesh;
      parent.add(outlineMesh);
      this.outlineObjects.push(outlineMesh);
    });
  }

  disposeCharacterOutline() {
    for (const outline of this.outlineObjects) {
      outline.parent?.remove(outline);
    }
    this.outlineObjects = [];
    for (const material of this.outlineMaterials) material.dispose?.();
    this.outlineMaterials = [];
  }

  disposeFaceDetails() {
    if (!Array.isArray(this.faceDetailObjects)) this.faceDetailObjects = [];
    if (!Array.isArray(this.faceDetailMaterials)) this.faceDetailMaterials = [];
    for (const detail of this.faceDetailObjects) {
      detail.parent?.remove(detail);
      detail.geometry?.dispose?.();
    }
    this.faceDetailObjects = [];
    for (const material of this.faceDetailMaterials) material.dispose?.();
    this.faceDetailMaterials = [];
  }

  disposeBackdrop() {
    if (!Array.isArray(this.backdropTextures)) this.backdropTextures = [];
    if (this.backdropGroup) {
      this.scene?.remove?.(this.backdropGroup);
      this.backdropGroup.traverse((child) => {
        child.geometry?.dispose?.();
        child.material?.dispose?.();
      });
    }
    this.backdropGroup = null;
    for (const texture of this.backdropTextures) texture.dispose?.();
    this.backdropTextures = [];
  }

  disposeFloor() {
    if (!Array.isArray(this.floorTextures)) this.floorTextures = [];
    if (this.floorGroup) {
      this.scene?.remove?.(this.floorGroup);
      this.floorGroup.traverse((child) => {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
        else child.material?.dispose?.();
      });
    }
    this.floorGroup = null;
    for (const texture of this.floorTextures) texture.dispose?.();
    this.floorTextures = [];
  }

  disposePostprocessing() {
    this.composer?.renderTarget1?.dispose?.();
    this.composer?.renderTarget2?.dispose?.();
    this.bloomPass = null;
    this.colorGradePass = null;
    this.renderPass = null;
    this.composer = null;
  }

  captureBones(mesh) {
    const bones = [];
    mesh.traverse((child) => {
      if (child.isBone) bones.push(child);
    });
    // v1.1 衣发轨道以模型空间独立烘焙；只旋转身体会把头发、领口和袖子留在原位。
    // 同时检查四组独立根骨和补偿表情，避免按文件名误判普通 PMX。
    this.hasIndependentBakedGarments = ["SH000", "SC000", "SL000", "SR000"].every(
      (name) => bones.some((bone) => bone.name === name && (!bone.parent?.isBone || /^E\d{3}/.test(bone.parent.name))),
    ) && Object.keys(mesh.morphTargetDictionary || {}).some((name) => /^V11SC\d{3}[PN]$/.test(name));
    const normalizedBones = bones.map((bone) => ({
      bone,
      lowerName: bone.name.toLowerCase(),
    }));

    const findBone = (hints) => {
      const lowerHints = hints.map((hint) => hint.toLowerCase());
      const exactMatch = normalizedBones.find(({ lowerName }) => lowerHints.includes(lowerName));
      if (exactMatch) return exactMatch.bone;
      return normalizedBones.find(({ lowerName }) => lowerHints.some((hint) => lowerName.includes(hint)))?.bone;
    };

    this.bones = {
      upperBody: findBone(["upperbody", "spine", "chest", "\u4e0a\u534a\u8eab", "\u4e0a\u534a\u8eab2", "\u4e0a\u534a\u8eab3"]),
      neck: findBone(["neck", "\u9996"]),
      head: findBone(["head", "\u982d"]),
      leftArm: findBone(["leftarm", "arm_l", "l_shoulder", "\u5de6\u8155"]),
      rightArm: findBone(["rightarm", "arm_r", "r_shoulder", "\u53f3\u8155"]),
      leftElbow: findBone(["leftelbow", "forearm_l", "l_forearm", "\u5de6\u3072\u3058"]),
      rightElbow: findBone(["rightelbow", "forearm_r", "r_forearm", "\u53f3\u3072\u3058"]),
    };
    this.baseBoneTransforms = bones.map((bone) => ({
      bone,
      position: bone.position?.clone?.() || new THREE.Vector3(),
      quaternion: bone.quaternion?.clone?.() || new THREE.Quaternion(),
      scale: bone.scale?.clone?.() || new THREE.Vector3(1, 1, 1),
    }));
    this.baseBoneTransformMap = new Map(this.baseBoneTransforms.map((entry) => [entry.bone, entry]));
    this.vmdAnchorBones = Array.from(
      new Set(
        FIXED_VMD_ANCHOR_BONE_HINTS.map((hints) => findBone(hints)).filter(Boolean),
      ),
    );
    const animationBuildBones = this.baseBoneTransforms.map((entry) => ({
      name: entry.bone?.name || "",
      position: entry.position?.clone?.() || new THREE.Vector3(),
    }));
    const animationBuildBoneMap = new Map(animationBuildBones.map((bone) => [bone.name, bone]));
    this.animationBuildTarget = {
      skeleton: {
        bones: animationBuildBones,
        getBoneByName(name) {
          return animationBuildBoneMap.get(name) || null;
        },
      },
      morphTargetDictionary: { ...(mesh.morphTargetDictionary || {}) },
    };

    for (const [slot, bone] of Object.entries(this.bones)) {
      if (bone) this.baseBoneRotation[slot] = bone.rotation.clone();
    }

    const dict = mesh.morphTargetDictionary || {};
    this.morphSlots = {
      smile: this.findMorphIndex(dict, FIXED_MORPH_HINTS.smile),
      sad: this.findMorphIndex(dict, FIXED_MORPH_HINTS.sad),
      blink: this.findMorphIndex(dict, FIXED_MORPH_HINTS.blink),
      mouthA: this.findMorphIndex(dict, FIXED_MORPH_HINTS.mouthA),
      mouthI: this.findMorphIndex(dict, FIXED_MORPH_HINTS.mouthI),
      mouthU: this.findMorphIndex(dict, FIXED_MORPH_HINTS.mouthU),
    };
    this.koledaClosedEyeMorphSlots = this.isKoledaModel
      ? selectKoledaClosedEyeMorphNames(Object.keys(dict))
          .map((name) => dict[name])
          .filter((index) => typeof index === "number")
      : [];
    this.koledaMotionEyeMorphSlots = new Set(this.isKoledaModel
      ? selectKoledaEyeMorphNames(Object.keys(dict)).map((name) => dict[name]).filter(Number.isInteger)
      : []);
    this.expressionMorphSlots = Object.fromEntries(
      Object.entries(FIXED_EXPRESSION_MORPH_NAMES).map(([slot, names]) => [
        slot,
        names
          .map((name) => this.findMorphIndexExact(dict, name))
          .filter((index) => typeof index === "number"),
      ]),
    );
  }

  findMorphIndexExact(dictionary, hint) {
    const entry = Object.entries(dictionary).find(([name]) => name === hint);
    return entry ? entry[1] : undefined;
  }

  findMorphIndex(dictionary, hints) {
    const entries = Object.entries(dictionary);
    const lowerHints = hints.map((hint) => hint.toLowerCase());
    const exact = entries.find(([name]) => lowerHints.includes(name.toLowerCase()));
    if (exact) return exact[1];
    const found = entries.find(([name]) => lowerHints.some((hint) => name.toLowerCase().includes(hint)));
    return found ? found[1] : undefined;
  }

  resetToBasePose() {
    if (!this.model) return;
    this.model.pose?.();

    for (const entry of this.baseBoneTransforms || []) {
      if (!entry?.bone) continue;
      if (entry.position) entry.bone.position?.copy?.(entry.position);
      if (entry.quaternion) entry.bone.quaternion?.copy?.(entry.quaternion);
      if (entry.scale) entry.bone.scale?.copy?.(entry.scale);
    }

    for (const [slot, bone] of Object.entries(this.bones)) {
      if (!bone) continue;
      const base = this.baseBoneRotation[slot];
      if (!base) continue;
      bone.rotation.copy(base);
    }

    if (Array.isArray(this.model.morphTargetInfluences)) {
      for (let index = 0; index < this.model.morphTargetInfluences.length; index += 1) {
        this.model.morphTargetInfluences[index] = 0;
      }
    }
  }

  stabilizeVmdAnchorBones() {
    if (this.playerVmdMode) return;
    if (this.currentVmdLockRootPosition === false) return;
    if (!this.model || !this.vmdAnchorBones.length) return;
    for (const bone of this.vmdAnchorBones) {
      const base = this.baseBoneTransformMap.get(bone);
      if (!base) continue;
      bone.position?.copy?.(base.position);
    }
    this.model.updateMatrixWorld?.(true);
  }

  getCurrentVmdMixer() {
    if (!this.model) return null;
    return this.helper?.objects?.get?.(this.model)?.mixer || null;
  }

  getVmdAction(clip, { create = false } = {}) {
    if (!clip || !this.model) return null;
    const mixer = this.getCurrentVmdMixer();
    if (!mixer) return null;
    const existingAction = mixer.existingAction?.(clip, this.model) || null;
    if (existingAction || !create) return existingAction;
    return mixer.clipAction?.(clip, this.model) || null;
  }

  setCalibrationCaptureMode(enabled) {
    this.calibrationCaptureMode = Boolean(enabled);
    if (this.calibrationCaptureMode) {
      this.currentVmdLoopUrls = [];
      this.currentVmdStandbyUrl = "";
      this.currentVmdLoopGapMs = 0;
      this.setSpeaking(false);
    } else if (this.currentVmdAction) {
      this.currentVmdAction.paused = false;
    }
  }

  seekVmdFrame(frame, fps = 30) {
    if (!this.currentClip || !this.model) return false;
    const frameNumber = Math.max(0, Number(frame) || 0);
    const frameRate = Math.max(1, Number(fps) || 30);
    const seconds = frameNumber / frameRate;
    const action = this.currentVmdAction || this.getVmdAction(this.currentClip, { create: true });
    const mixer = this.getCurrentVmdMixer();

    if (action) {
      action.enabled = true;
      action.paused = false;
      action.time = seconds;
      action.play?.();
      this.currentVmdAction = action;
    }
    if (this.calibrationCaptureMode) {
      applyClipBoneTracksAtTime(this.model, this.currentClip, seconds);
      this.model?.skeleton?.update?.();
    } else {
      // 撤销上一轮 IK/Grant 的派生姿态；常量轨道不会主动重写这些骨骼。
      this.helper?._restoreBones?.(this.model);
      mixer?.setTime?.(seconds);
      // 定位先更新混合器，再同步 MMD 缓存，避免 helper.update(0) 恢复上一帧姿态。
      this.helper?._saveBones?.(this.model);
      this.helper?.update?.(0);
    }
    if (action && !this.calibrationCaptureMode) {
      action.time = seconds;
      action.paused = true;
    }
    if (this.currentClip) {
      this.stabilizeVmdAnchorBones();
      this.resetBonesNotAnimatedByClip(this.currentClip);
      if (this.currentVmdLockLowerBody) this.resetLowerBodyBonesToBase();
    }
    // Re-sync bone matrices to GPU after stabilize/reset calls modified matrixWorld
    if (this.calibrationCaptureMode) {
      this.model?.updateMatrixWorld?.(true);
      // Apply Grant (浠樹笌) bone transforms so deform bones follow control bones
      const grantSolver = this.helper?.objects?.get?.(this.model)?.grantSolver;
      if (grantSolver && !this.currentVmdBakedBoneAnimation) grantSolver.update?.();
      this.model?.updateMatrixWorld?.(true);
      this.model?.skeleton?.update?.();
    }
    this.renderScene?.();
    return true;
  }

  scheduleVmdActionCleanup(clip, action, nowMs = performance.now()) {
    if (!clip || !action) return;
    this.pendingVmdActionCleanups = this.pendingVmdActionCleanups
      .filter((entry) => entry?.clip !== clip && entry?.action !== action)
      .concat({
        clip,
        action,
        cleanupAt: nowMs + VMD_TRANSITION_FADE_SECONDS * 1000,
      });
  }

  flushExpiredVmdActionCleanups(nowMs = performance.now()) {
    if (!this.pendingVmdActionCleanups.length || !this.model) return;
    const mixer = this.getCurrentVmdMixer();
    if (!mixer) return;

    const pendingEntries = [];
    for (const entry of this.pendingVmdActionCleanups) {
      if (!entry || nowMs < entry.cleanupAt) {
        pendingEntries.push(entry);
        continue;
      }

      if (entry.action !== this.currentVmdAction) {
        entry.action?.stopFading?.();
        entry.action?.stopWarping?.();
        entry.action?.stop?.();
      }

      if (entry.clip && entry.clip !== this.currentClip) {
        withVmdBindingRelease(mixer, () => {
          mixer.uncacheAction?.(entry.clip, this.model);
          mixer.uncacheClip?.(entry.clip);
        });
      }
    }

    this.pendingVmdActionCleanups = pendingEntries;
  }

  resetBonesNotAnimatedByClip(clip) {
    resetBonesNotAnimatedByClip(this.baseBoneTransforms, clip);
    this.model?.updateMatrixWorld?.(true);
  }

  resetLowerBodyBonesToBase() {
    resetLowerBodyBonesToBase(this.baseBoneTransforms);
    this.model?.updateMatrixWorld?.(true);
  }

  transitionToVmdClip(previousClip, nextClip, startedAt = performance.now()) {
    if (!previousClip || !nextClip) return false;
    const previousAction = this.currentVmdAction || this.getVmdAction(previousClip);
    const nextAction = this.getVmdAction(nextClip, { create: true });
    if (!previousAction || !nextAction || typeof nextAction.crossFadeFrom !== "function") return false;

    nextAction.reset?.();
    nextAction.stopFading?.();
    nextAction.stopWarping?.();
    nextAction.setEffectiveTimeScale?.(1);
    nextAction.setEffectiveWeight?.(1);
    nextAction.play?.();

    previousAction.stopFading?.();
    previousAction.stopWarping?.();
    nextAction.crossFadeFrom(previousAction, VMD_TRANSITION_FADE_SECONDS, false);

    this.scheduleVmdActionCleanup(previousClip, previousAction, startedAt);
    this.currentClip = nextClip;
    this.currentVmdAction = nextAction;
    this.resetBonesNotAnimatedByClip(nextClip);
    if (this.currentVmdLockLowerBody) this.resetLowerBodyBonesToBase();
    return true;
  }

  shouldCrossfadeVmdTransition({ previousPhase = "loop", nextPhase = "loop", disableCrossfade = false } = {}) {
    if (disableCrossfade) return false;
    return Boolean(previousPhase && nextPhase);
  }

  async playVmd(url, playbackRate = 1, loopUrls = [], loopOptions = {}) {
    if (!this.model) return;
    const normalizedLoopUrls = Array.from(new Set((Array.isArray(loopUrls) ? loopUrls : []).filter(Boolean)));
    const standbyUrl = loopOptions?.standbyUrl || "";
    const emotionByUrl = loopOptions?.emotionByUrl || this.currentVmdEmotionByUrl || {};
    const loopGapMs = Math.max(0, Number(loopOptions?.loopGapMs) || 0);
    const loopMode = loopOptions?.loopMode === "sequential" ? "sequential" : "random";
    const hadActiveClip = Boolean(this.currentClip);
    if (loopOptions.playerVmdMode === "baked" || loopOptions.playerVmdMode === "standard") {
      this.playerVmdMode = loopOptions.playerVmdMode;
    }
    const bakedModes = loopOptions?.bakedBoneAnimationByUrl;
    const bakedBoneAnimation = this.playerVmdMode ? this.playerVmdMode === "baked"
      : bakedModes ? bakedModes[url] === true : loopOptions?.bakedBoneAnimation === true;
    const solverModeChanged = Boolean(this.currentVmdBakedBoneAnimation) !== bakedBoneAnimation;
    const previousPhase = this.currentVmdLoopPhase || "loop";
    const nextPhase = resolveVmdLoopPhase({
      url,
      loopUrls: normalizedLoopUrls,
      standbyUrl,
      resumePhase: loopOptions?.resumePhase,
    });
    const loadToken = ++this.vmdLoadToken;
    this.weapon?.clear();
    try {
      this.isLoadingVmd = true;
      this.currentAction = null;
      this.currentSequence = null;
      this.currentVmdPlaybackRate = Math.max(0.1, Number(playbackRate) || 1);
      this.currentVmdLoopUrls = normalizedLoopUrls;
      this.currentVmdStandbyUrl = standbyUrl;
      this.currentVmdLoopGapMs = loopGapMs;
      this.currentVmdLoopMode = loopMode;
      this.currentVmdLoopPhase = nextPhase;
      this.currentVmdLockLowerBody = this.playerVmdMode ? false : Boolean(loopOptions?.lockLowerBody);
      // 混合收藏池逐片选择根固定，不能沿用上一段烘焙动作的false。
      this.currentVmdLockRootPosition = this.playerVmdMode ? false
        : bakedModes ? !bakedBoneAnimation : loopOptions?.lockRootPosition !== false;
      this.currentVmdDisableCrossfade = Boolean(loopOptions?.disableCrossfade);
      this.currentVmdEmotionByUrl = emotionByUrl;
      this.currentVmdUrl = url || "";
      if (emotionByUrl[this.currentVmdUrl]) this.activeEmotion = emotionByUrl[this.currentVmdUrl];
      this.activeAction = "idle";
      if (normalizedLoopUrls.includes(this.currentVmdUrl)) {
        this.lastPlayedLoopMotionUrl = this.currentVmdUrl;
      }
      this.currentVmdStartedAt = 0;
      this.currentVmdDurationMs = 0;
      const animationBuildTarget = this.animationBuildTarget || this.model;
      const clip = await loadAnimationSilently(this.loader, url, animationBuildTarget, this.vmdClipCache, this.mmdPreparation);
      if (this.destroyed || loadToken !== this.vmdLoadToken) return false;
      enableVmdSubframeCurves(clip, {
        allBoneTracks: Boolean(clip.userData?.stageWeaponPair),
        compensationMorphIndices: bakedBoneAnimation && this.isKoledaModel
          ? Object.entries(this.model.morphTargetDictionary || {})
              .filter(([name]) => /^LSH\d{3}[PN]$/.test(name))
              .map(([, index]) => index)
          : [],
      });
      this.currentVmdBakedBoneAnimation = bakedBoneAnimation;
      this.currentVmdBakedBoneAnimationByUrl = this.playerVmdMode ? {} : bakedModes || {};
      this.helper.enable?.("ik", !bakedBoneAnimation);
      this.helper.enable?.("grant", !bakedBoneAnimation);
      const startedAt = performance.now();
      const shouldCrossfade = hadActiveClip && this.shouldCrossfadeVmdTransition({
        previousPhase,
        nextPhase,
        disableCrossfade: this.currentVmdDisableCrossfade || solverModeChanged,
      });
      if (!shouldCrossfade || !this.transitionToVmdClip(this.currentClip, clip, startedAt)) {
        this.resetToBasePose();
        try {
          this.helper.remove(this.model);
        } catch {
          // ignore stale helper state when starting the first VMD clip
        }
        this.currentClip = clip;
        this.helper.add(this.model, { animation: clip, physics: this.hasPhysicsSupport });
        this.currentVmdAction = this.getVmdAction(clip);
      }
      // 大型 VMD 建立混合器可能耗时数秒；加载/建图时间不能算作已播放时间。
      this.clock.getDelta();
      this.currentVmdStartedAt = performance.now();
      this.currentVmdDurationMs =
        Number(clip?.duration) > 0 ? (Number(clip.duration) / this.currentVmdPlaybackRate) * 1000 : 0;
      if (this.currentVmdAction) {
        this.currentVmdAction.setLoop(THREE.LoopOnce, 1);
        this.currentVmdAction.clampWhenFinished = true;
      }
      this.setStatus("Playing mapped VMD motion.");
      this.weapon?.setMotion(url, clip.userData?.stageWeaponPair);
      return true;
    } catch (error) {
      if (this.destroyed || loadToken !== this.vmdLoadToken) return false;
      if (error) {
        console.warn("[mmd-vmd] failed to parse motion", {
          url,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      this.setStatus("VMD playback failed, fallback to procedural.");
      return false;
    } finally {
      if (loadToken === this.vmdLoadToken) this.isLoadingVmd = false;
    }
  }

  setSpeaking(flag) {
    const nextSpeaking = !!flag;
    if (nextSpeaking && !this.isSpeaking) {
      this.speakingStartedAtMs = nowMs();
      if (this.speechViseme) this.speechVisemeActive = true;
    } else if (!nextSpeaking) {
      this.speakingStartedAtMs = 0;
      this.speechLevel = 0;
      this.speechLevelActive = false;
      this.speechViseme = null;
      this.speechVisemeActive = false;
    }
    this.isSpeaking = nextSpeaking;
  }

  setSpeechLevel(level) {
    const next = Number(level);
    if (!Number.isFinite(next)) {
      this.speechLevel = 0;
      this.speechLevelActive = false;
      return;
    }
    this.speechLevel = clampUnit(next, 0);
    this.speechLevelActive = this.isSpeaking;
  }

  setSpeechViseme(frame) {
    const viseme = normalizeSpeechVisemeName(frame?.viseme);
    if (!viseme) {
      this.speechViseme = null;
      this.speechVisemeActive = false;
      return;
    }
    this.speechViseme = {
      viseme,
      weight: clampUnit(frame?.weight, viseme === "SIL" ? 0 : 0.75),
    };
    this.speechVisemeActive = this.isSpeaking;
  }

  applyInteraction({ emotion = "neutral", action = "idle", sequence = [] }) {
    ++this.vmdLoadToken;
    this.weapon?.clear();
    this.activeEmotion = emotion;
    this.activeAction = action;
    if (this.currentClip && this.model) {
      this.currentClip = null;
      this.currentVmdPlaybackRate = 1;
      this.currentVmdAction = null;
      this.pendingVmdActionCleanups = [];
      this.helper.remove(this.model);
      this.helper.add(this.model, { physics: this.hasPhysicsSupport });
    }
    this.resetToBasePose();
    this.currentVmdLoopUrls = [];
    this.currentVmdStandbyUrl = "";
    this.currentVmdLoopGapMs = 0;
    this.currentVmdLoopMode = "random";
    this.currentVmdLoopPhase = "loop";
    this.currentVmdLockLowerBody = false;
    this.currentVmdLockRootPosition = true;
    this.currentVmdBakedBoneAnimation = false;
    this.currentVmdBakedBoneAnimationByUrl = {};
    this.helper?.enable?.("ik", true);
    this.helper?.enable?.("grant", true);
    this.currentVmdDisableCrossfade = false;
    this.currentVmdEmotionByUrl = {};
    this.pendingVmdLoopUrl = "";
    this.lastPlayedLoopMotionUrl = "";
    this.currentVmdUrl = "";
    this.currentVmdStartedAt = 0;
    this.currentVmdDurationMs = 0;
    this.currentVmdAction = null;
    this.pendingVmdActionCleanups = [];
    this.isLoadingVmd = false;
    if (Array.isArray(sequence) && sequence.length) {
      this.currentSequence = {
        startedAt: performance.now(),
        steps: sequence
          .filter((step) => step?.action)
          .map((step) => ({
            action: step.action,
            durationMs: Number(step.durationMs) || ACTION_DURATION[step.action] || ACTION_DURATION.idle,
            intensity: Number(step.intensity) || 0.6,
          })),
      };
      this.currentAction = null;
      return;
    }
    this.currentSequence = null;
    const duration = ACTION_DURATION[action] ?? ACTION_DURATION.idle;
    this.currentAction = duration ? { name: action, startedAt: performance.now(), duration } : null;
  }

  updateVmdLoop(nowMs) {
    if (!this.currentClip || this.isLoadingVmd) return;
    const loopUrls = Array.from(new Set((Array.isArray(this.currentVmdLoopUrls) ? this.currentVmdLoopUrls : []).filter(Boolean)));
    const standbyUrl = this.currentVmdStandbyUrl || "";
    if (!loopUrls.length && !standbyUrl) return;
    if (!this.currentVmdStartedAt) return;
    const loopGapMs = Math.max(0, Number(this.currentVmdLoopGapMs) || 0);
    const loopStateOptions = {
      standbyUrl,
      loopGapMs,
      loopMode: this.currentVmdLoopMode,
    };
    if (this.currentVmdLockLowerBody) loopStateOptions.lockLowerBody = true;
    if (this.currentVmdLockRootPosition === false) loopStateOptions.lockRootPosition = false;
    if (this.currentVmdBakedBoneAnimation) loopStateOptions.bakedBoneAnimation = true;
    if (this.currentVmdBakedBoneAnimationByUrl && Object.keys(this.currentVmdBakedBoneAnimationByUrl).length) {
      loopStateOptions.bakedBoneAnimationByUrl = this.currentVmdBakedBoneAnimationByUrl;
    }
    if (this.currentVmdDisableCrossfade) loopStateOptions.disableCrossfade = true;
    if (this.currentVmdEmotionByUrl && Object.keys(this.currentVmdEmotionByUrl).length) {
      loopStateOptions.emotionByUrl = this.currentVmdEmotionByUrl;
    }
    const elapsedMs = this.currentVmdAction
      ? this.currentVmdAction.time / this.currentVmdPlaybackRate * 1000
      : nowMs - this.currentVmdStartedAt;
    const measuredDurationMs = Math.max(0, Number(this.currentVmdDurationMs) || 0);
    if (measuredDurationMs > 0) {
      const transitionLeadMs = loopGapMs > 0 ? 0 : VMD_TRANSITION_FADE_SECONDS * 1000;
      const advanceAtMs = Math.max(0, measuredDurationMs - transitionLeadMs);
      if (elapsedMs < advanceAtMs + loopGapMs) return;
    } else {
      const canAdvanceWithoutDuration =
        loopUrls.length && (this.currentVmdLoopPhase === "loop" || this.currentVmdLoopPhase === "standby");
      if (!canAdvanceWithoutDuration || elapsedMs < loopGapMs) return;
    }

    if (standbyUrl && !loopUrls.length) {
      this.playVmd(standbyUrl, this.currentVmdPlaybackRate, [], {
        ...loopStateOptions,
        resumePhase: "standby-only",
      });
      return;
    }

    if (this.currentVmdLoopPhase === "loop" && standbyUrl) {
      this.playVmd(standbyUrl, this.currentVmdPlaybackRate, loopUrls, {
        ...loopStateOptions,
        resumePhase: "standby",
      });
      return;
    }

    const currentLoopAnchor = this.lastPlayedLoopMotionUrl || this.currentVmdUrl;
    const nextUrl = pickLoopMotionUrl(loopUrls, currentLoopAnchor, this.currentVmdLoopMode);
    if (!nextUrl) return;
    this.playVmd(nextUrl, this.currentVmdPlaybackRate, loopUrls, {
      ...loopStateOptions,
      resumePhase: "loop",
    });
  }

  getOffsetsForAction(action, t, intensity = 1) {
    switch (action) {
      case "nod":
        return { head: { x: Math.sin(t * 8.5) * 0.24 * intensity } };
      case "wave":
        return {
          rightArm: { z: -0.9 * intensity, x: -0.15 + Math.sin(t * 9) * 0.18 * intensity },
          rightElbow: { z: -0.45 + Math.sin(t * 9) * 0.16 * intensity },
        };
      case "think":
        return {
          head: { y: 0.28 * intensity, x: -0.1 * intensity },
          leftArm: { z: 0.26 * intensity },
          rightArm: { z: -0.06 * intensity },
        };
      case "cheer":
        return {
          leftArm: { x: -1.2 + Math.sin(t * 10) * 0.08 * intensity, z: 0.26 * intensity },
          rightArm: { x: -1.2 + Math.sin(t * 10) * 0.08 * intensity, z: -0.26 * intensity },
        };
      case "comfort":
        return { head: { x: 0.22 * intensity, y: -0.12 * intensity }, upperBody: { x: 0.08 * intensity } };
      case "lean_in":
        return { upperBody: { x: 0.18 * intensity }, head: { x: 0.1 * intensity } };
      case "look_away":
        return { head: { y: 0.34 * intensity }, neck: { y: 0.2 * intensity }, upperBody: { y: 0.08 * intensity } };
      case "headshake":
        return { head: { y: Math.sin(t * 9) * 0.25 * intensity } };
      default:
        return {};
    }
  }

  getActionOffsets(nowMs) {
    if (this.currentSequence?.steps?.length) {
      const elapsed = nowMs - this.currentSequence.startedAt;
      let cursor = 0;
      for (const step of this.currentSequence.steps) {
        const stepEnd = cursor + step.durationMs;
        if (elapsed <= stepEnd) {
          this.activeAction = step.action;
          return this.getOffsetsForAction(step.action, (elapsed - cursor) / 1000, step.intensity);
        }
        cursor = stepEnd;
      }
      this.currentSequence = null;
      return {};
    }

    if (!this.currentAction) return {};
    const elapsed = nowMs - this.currentAction.startedAt;
    if (elapsed > this.currentAction.duration) {
      this.currentAction = null;
      return {};
    }
    return this.getOffsetsForAction(this.currentAction.name, elapsed / 1000, 1);
  }

  getExpressionTargets() {
    const emotion = this.activeEmotion || "neutral";
    const action = this.activeAction || this.currentAction?.name || "idle";
    const targets = {
      smirk: 0,
      mouthSmile: 0,
      mouthFrown: 0,
      mouthWide: 0,
      joy: 0,
      softSmile: 0,
      troubled: 0,
      serious: 0,
      glare: 0,
      surprised: 0,
      angry: 0,
    };

    if (emotion === "happy" || action === "wave" || action === "nod") {
      Object.assign(targets, { mouthSmile: 0.46, smirk: 0.18, joy: 0.18, softSmile: 0.12 });
    } else if (emotion === "excited" || action === "cheer") {
      Object.assign(targets, { mouthSmile: 0.38, mouthWide: 0.26, joy: 0.32, surprised: 0.12 });
    } else if (emotion === "thinking" || action === "think") {
      Object.assign(targets, { serious: 0.28, glare: 0.14, mouthFrown: 0.08 });
    } else if (emotion === "caring" || action === "comfort" || action === "lean_in") {
      Object.assign(targets, { mouthSmile: 0.2, softSmile: 0.16, troubled: 0.16 });
    } else if (emotion === "sad" || action === "look_away") {
      Object.assign(targets, { troubled: 0.34, mouthFrown: 0.22 });
    } else if (action === "headshake") {
      Object.assign(targets, { serious: 0.24, mouthFrown: 0.12 });
    } else {
      Object.assign(targets, { mouthSmile: 0.08 });
    }

    return targets;
  }

  getBreathingOffsets(nowMs) {
    const phase = (nowMs / 1000) * ((Math.PI * 2) / BREATHING_CYCLE_SECONDS);
    const breathWave = Math.sin(phase);
    const breathLift = Math.max(0, breathWave);
    const speakingBoost = this.isSpeaking ? 1.3 : 1;
    const clipAttenuation = this.currentClip ? 0.92 : 1;
    const actionAttenuation = this.currentAction || this.currentSequence ? 0.72 : 1;
    const intensity = speakingBoost * clipAttenuation * actionAttenuation;
    const shoulderWave = Math.sin(phase - Math.PI * 0.18);

    return {
      upperBody: { x: (-0.08 - breathLift * 0.16) * intensity, z: breathWave * 0.022 * intensity },
      neck: { x: (-0.016 + breathLift * 0.05) * intensity, z: breathWave * 0.01 * intensity },
      head: { x: (0.008 + breathLift * 0.032) * intensity, z: breathWave * 0.014 * intensity },
      leftArm: { z: (-0.04 - shoulderWave * 0.055) * intensity, x: breathLift * 0.014 * intensity },
      rightArm: { z: (0.04 + shoulderWave * 0.055) * intensity, x: breathLift * 0.014 * intensity },
    };
  }

  updateBonePose(delta, nowMs) {
    // 配套 VMD 已包含身体及衣发运动；无 VMD 时保持基准姿态。
    // 不能在其中任一状态单独叠加身体呼吸、转头等旋转。
    if (this.hasIndependentBakedGarments) return;
    const breathingPose = this.getBreathingOffsets(nowMs);
    const actionPose = this.getActionOffsets(nowMs);
    const targets = {
      upperBody: { x: 0, y: 0, z: 0 },
      head: { x: 0, y: 0, z: 0 },
      neck: { x: 0, y: 0, z: 0 },
      leftArm: { x: 0, y: 0, z: 0 },
      rightArm: { x: 0, y: 0, z: 0 },
      leftElbow: { x: 0, y: 0, z: 0 },
      rightElbow: { x: 0, y: 0, z: 0 },
    };
    for (const [slot, values] of Object.entries(breathingPose)) {
      targets[slot] = { ...targets[slot], ...values };
    }
    for (const [slot, values] of Object.entries(actionPose)) {
      targets[slot] = { ...targets[slot], ...values };
    }
    for (const [slot, bone] of Object.entries(this.bones)) {
      if (!bone) continue;
      const target = targets[slot] || { x: 0, y: 0, z: 0 };
      if (this.currentClip) {
        if (clipAnimatesBone(this.currentClip, bone)) {
          bone.rotation.x += target.x;
          bone.rotation.y += target.y;
          bone.rotation.z += target.z;
        } else {
          const base = this.baseBoneRotation[slot] || new THREE.Euler(0, 0, 0);
          bone.rotation.x = base.x + target.x;
          bone.rotation.y = base.y + target.y;
          bone.rotation.z = base.z + target.z;
        }
        continue;
      }
      const base = this.baseBoneRotation[slot] || new THREE.Euler(0, 0, 0);
      bone.rotation.x = smooth(bone.rotation.x, base.x + target.x, 9, delta);
      bone.rotation.y = smooth(bone.rotation.y, base.y + target.y, 9, delta);
      bone.rotation.z = smooth(bone.rotation.z, base.z + target.z, 9, delta);
    }
  }

  updateMorph(delta, nowMs) {
    if (!this.model?.morphTargetInfluences) return;
    const influences = this.model.morphTargetInfluences;
    const morphSlots = this.morphSlots || {};
    const expressionMorphSlots = this.expressionMorphSlots || {};
    const eyeSlots = this.koledaMotionEyeMorphSlots || new Set();
    if (this.eyeMorphClip !== this.currentClip) {
      this.eyeMorphClip = this.currentClip;
      this.animatedEyeMorphSlots = new Set((this.currentClip?.tracks || []).flatMap((track) => {
        const match = /\.morphTargetInfluences\[(\d+)\]$/.exec(track.name || "");
        return match ? [Number(match[1])] : [];
      }));
    }
    // 动作有轨道就保留混合器结果；无轨道立即回中性，避免前一动作闭眼残留。
    for (const index of eyeSlots) {
      if (!this.animatedEyeMorphSlots?.has(index)) influences[index] = 0;
    }
    const setMorph = (index, value) => {
      if (typeof index !== "number" || index >= influences.length) return;
      if (eyeSlots.has(index)) return;
      const current = typeof influences[index] === "number" ? influences[index] : 0;
      influences[index] = smooth(current, value, 12, delta);
    };

    setMorph(morphSlots.smile, 0);
    setMorph(morphSlots.sad, 0);

    setMorph(morphSlots.blink, 0);

    const expressionTargets = this.getExpressionTargets();
    for (const [slot, target] of Object.entries(expressionTargets)) {
      for (const index of expressionMorphSlots[slot] || []) {
        setMorph(index, target);
      }
    }

    const visemeTargets =
      this.isSpeaking && this.speechVisemeActive
        ? getSpeechVisemeMouthTargets(this.speechViseme, {
            speechLevel: this.speechLevel,
            speechLevelActive: this.speechLevelActive,
          })
        : null;
    if (visemeTargets) {
      setMorph(morphSlots.mouthA, visemeTargets.mouthA);
      setMorph(morphSlots.mouthI, visemeTargets.mouthI);
      setMorph(morphSlots.mouthU, visemeTargets.mouthU);
      setMorph(morphSlots.mouthE, visemeTargets.mouthE);
      setMorph(morphSlots.mouthO, visemeTargets.mouthO);
      return;
    }

    const speakingStartedAtMs = Number.isFinite(Number(this.speakingStartedAtMs)) ? Number(this.speakingStartedAtMs) : nowMs;
    const lipBase = this.isSpeaking
      ? this.speechLevelActive
        ? getSpeechLevelLipBase(this.speechLevel)
        : getSpeakingLipBase(nowMs - speakingStartedAtMs)
      : 0;
    setMorph(morphSlots.mouthA, lipBase);
    setMorph(morphSlots.mouthI, this.isSpeaking ? lipBase * 0.5 : 0);
    setMorph(morphSlots.mouthU, this.isSpeaking ? lipBase * 0.34 : 0);
    setMorph(morphSlots.mouthE, 0);
    setMorph(morphSlots.mouthO, 0);
  }

  renderFrame() {
    if (this.destroyed) return;
    requestAnimationFrame(() => this.renderFrame());
    const delta = this.clock.getDelta();
    const nowMs = performance.now();
    this.renderQuality?.update(delta * 1000, Boolean(this.model) && !this.isLoadingVmd
      && !this.calibrationCaptureMode && document.visibilityState !== "hidden");
    if (!this.calibrationCaptureMode) {
      this.updateVmdLoop(nowMs);
    }
    if (!this.calibrationCaptureMode) {
      const helperDelta = this.currentClip ? delta * this.currentVmdPlaybackRate : delta;
      this.helper.update(helperDelta);
    }
    if (this.currentClip) {
      this.stabilizeVmdAnchorBones();
      this.resetBonesNotAnimatedByClip(this.currentClip);
      if (this.currentVmdLockLowerBody) this.resetLowerBodyBonesToBase();
    }
    if (!this.calibrationCaptureMode) {
      this.updateBonePose(delta, nowMs);
      this.updateMorph(delta, nowMs);
    }
    // Sync bone world matrices to GPU bone texture so skinning reflects manual bone changes
    if (this.calibrationCaptureMode) {
      this.model?.updateMatrixWorld?.(true);
      // Apply Grant (浠樹笌) bone transforms so deform bones follow control bones
      const grantSolver = this.helper?.objects?.get?.(this.model)?.grantSolver;
      if (grantSolver && !this.currentVmdBakedBoneAnimation) grantSolver.update?.();
      this.model?.updateMatrixWorld?.(true);
      this.model?.skeleton?.update?.();
    }
    this.flushExpiredVmdActionCleanups(nowMs);
    this.controls?.update();
    this.renderScene();
  }

  startRenderLoop() {
    this.renderFrame();
  }

  refreshSkinnedModelBounds() {
    const model = this.model;
    if (this.renderPipeline !== "v14d-game" || !model?.isSkinnedMesh || !model.frustumCulled) return;
    // 旧球与当前视图相交时不会阻止绘制；仅在它将导致剔除时按全顶点重算。
    // 不缓存动作时间，因此跳帧、切片和相机变化都会按本次真实矩阵检查。
    model.updateMatrixWorld(true);
    if (!this.camera || model.boundingSphere === null) {
      model.computeBoundingSphere();
      return;
    }
    this.camera.updateMatrixWorld();
    this.modelCullFrustum ||= new THREE.Frustum();
    this.modelCullProjection ||= new THREE.Matrix4();
    this.modelCullFrustum.setFromProjectionMatrix(
      this.modelCullProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse),
    );
    if (!this.modelCullFrustum.intersectsObject(model)) model.computeBoundingSphere();
  }


  renderScene() {
    if ((this.renderPipeline === "v14d-game" || this.renderPipeline === "gf2") && !this.modelDisplayReady) return;
    this.weapon?.sync();
    this.refreshSkinnedModelBounds();
    this.updateBakedGarmentMorphs?.();
    if (this.renderPipeline === "gf2") {
      if (!this.gf2Adapter) return;
      this.model.updateMatrixWorld(true);
      this.model.skeleton.update();
      this.gf2Adapter.update(this.camera);
      this.gf2Adapter.render(this.renderer, this.scene, this.camera);
      return;
    }
    if (this.renderPipeline === "v14d-game") {
      if (!this.v14dGameLocalOcioDisplay || !this.renderer || !this.scene || !this.camera) return;
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      const appearanceSettings = this.appearanceAdapter.getSettings();
      const draw = () => this.v14dGameLocalOcioDisplay.render(
        this.scene,
        this.camera,
        Math.max(1, Math.round(size.x)),
        Math.max(1, Math.round(size.y)),
        appearanceSettings.exposure,
        appearanceSettings.display,
      );
      this.appearanceAdapter.draw(draw, { speaking: this.isSpeaking });
      return;
    }
    if (this.shouldUsePostFX()) {
      this.composer?.render?.();
      return;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.destroyed = true;
    this.preparationController?.abort();
    if (this.handleResize) window.removeEventListener("resize", this.handleResize);
    this.resizeObserver?.disconnect?.();
    this.resizeObserver = null;
    this.clearModel();
    this.disposeV14dGameLights();
    this.v14dGameLocalOcioDisplay?.dispose?.();
    this.v14dGameLocalOcioDisplay = null;
    this.disposeFloor();
    this.disposeBackdrop();
    this.disposePostprocessing();
    this.stageLights = null;
    this.materialDebugIndex.clear();
    this.renderer?.dispose();
    this.toonRampTexture?.dispose?.();
  }
}
