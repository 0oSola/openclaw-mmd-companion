import test from "node:test";
import assert from "node:assert/strict";

import * as THREE from "three";

import * as runtimeModule from "../src/features/stage/mmdCompanionRuntime.js";

const {
  applyStageRuntimeState,
  clipAnimatesBone,
  getStagePresentationConfig,
  inferRezeMaterialPreset,
  isLowerBodyBoneName,
  MMDCompanionRuntime,
  pickNextLoopMotionUrl,
  pickSequentialLoopMotionUrl,
  resetLowerBodyBonesToBase,
  resetBonesNotAnimatedByClip,
  tuneK3MMDMaterial,
  tuneRezeNprMMDMaterial,
} = runtimeModule;

function makeRuntime(overrides = {}) {
  return Object.assign(Object.create(MMDCompanionRuntime.prototype), {
    statusElement: null,
    hasPhysicsSupport: false,
    scene: { add() {}, remove() {} },
    helper: { add() {}, remove() {}, update() {} },
    controls: { update() {} },
    renderer: {
      render() {},
      dispose() {},
      getPixelRatio() {
        return 1;
      },
      getSize(target) {
        target?.set?.(1, 1);
        return target;
      },
      setSize() {},
    },
    camera: {},
    clock: { getDelta: () => 1 / 60 },
    bones: {},
    baseBoneRotation: {},
    baseBoneTransforms: [],
    baseBoneTransformMap: new Map(),
    vmdAnchorBones: [],
    currentClip: null,
    currentVmdPlaybackRate: 1,
    currentVmdLoopUrls: [],
    currentVmdStandbyUrl: "",
    currentVmdLoopGapMs: 0,
    currentVmdLoopMode: "random",
    currentVmdLoopPhase: "loop",
    lastPlayedLoopMotionUrl: "",
    currentVmdUrl: "",
    currentVmdStartedAt: 0,
    currentVmdDurationMs: 0,
    currentVmdAction: null,
    pendingVmdActionCleanups: [],
    isLoadingVmd: false,
    vmdLoadToken: 0,
    toonRampTexture: {},
    backdropTextures: [],
    outlineObjects: [],
    outlineMaterials: [],
    setStatus() {},
    clearModel() {},
    ...overrides,
  });
}

function makeMaterial({
  name,
  transparent = false,
  opacity = 1,
  alphaMap = null,
  shininess = 80,
  specular = 1,
  side = THREE.FrontSide,
} = {}) {
  return {
    name,
    transparent,
    opacity,
    alphaMap,
    alphaTest: 0,
    side,
    color: new THREE.Color(1, 1, 1),
    emissive: new THREE.Color(0.1, 0.1, 0.1),
    emissiveIntensity: 0,
    envMapIntensity: 0,
    specular: new THREE.Color(specular, specular, specular),
    shininess,
    map: { colorSpace: null },
    emissiveMap: { colorSpace: null },
    gradientMap: null,
    needsUpdate: false,
  };
}

function makeMesh({ materials, bones = [], morphTargetDictionary = {} }) {
  const meshNodes = materials.map((material) => ({
    isMesh: true,
    castShadow: false,
    receiveShadow: false,
    material,
  }));

  return {
    position: { set() {} },
    castShadow: false,
    receiveShadow: false,
    morphTargetDictionary,
    traverse(visitor) {
      for (const node of meshNodes) visitor(node);
      for (const bone of bones) visitor(bone);
    },
  };
}

function createProject2PoseMesh() {
  const mesh = new THREE.Group();
  const hip = new THREE.Bone();
  hip.name = "Hip";
  const chest = new THREE.Bone();
  chest.name = "Chest";
  const leftLeg = new THREE.Bone();
  leftLeg.name = "LeftLeg";
  const leftKnee = new THREE.Bone();
  leftKnee.name = "LeftKnee";
  const leftShoulder = new THREE.Bone();
  leftShoulder.name = "LeftShoulder";
  const rightShoulder = new THREE.Bone();
  rightShoulder.name = "RightShoulder";
  const leftArm = new THREE.Bone();
  leftArm.name = "LeftArm";
  const rightArm = new THREE.Bone();
  rightArm.name = "RightArm";
  const leftElbow = new THREE.Bone();
  leftElbow.name = "LeftElbow";
  const rightElbow = new THREE.Bone();
  rightElbow.name = "RightElbow";

  mesh.add(hip);
  hip.add(chest);
  hip.add(leftLeg);
  leftLeg.add(leftKnee);
  chest.add(leftShoulder);
  chest.add(rightShoulder);
  leftShoulder.add(leftArm);
  rightShoulder.add(rightArm);
  leftArm.add(leftElbow);
  rightArm.add(rightElbow);

  const bones = [hip, chest, leftLeg, leftKnee, leftShoulder, rightShoulder, leftArm, rightArm, leftElbow, rightElbow];
  mesh.skeleton = {
    bones,
    getBoneByName(name) {
      return bones.find((bone) => bone.name === name) || null;
    },
    update() {},
  };

  return {
    mesh,
    bones: {
      hip,
      chest,
      leftLeg,
      leftKnee,
      leftShoulder,
      rightShoulder,
      leftArm,
      rightArm,
      leftElbow,
      rightElbow,
    },
  };
}

function createCanvasContextStub() {
  return {
    createLinearGradient() {
      return {
        addColorStop() {},
      };
    },
    createRadialGradient() {
      return {
        addColorStop() {},
      };
    },
    beginPath() {},
    arc() {},
    stroke() {},
    fill() {},
    moveTo() {},
    lineTo() {},
    fillRect() {},
    setLineDash() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    clearRect() {},
    set fillStyle(_value) {},
    set strokeStyle(_value) {},
    set lineWidth(_value) {},
    set shadowBlur(_value) {},
    set shadowColor(_value) {},
    set globalAlpha(_value) {},
  };
}

function withStubbedDocument(run) {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement(tagName) {
      assert.equal(tagName, "canvas");
      return {
        width: 0,
        height: 0,
        getContext() {
          return createCanvasContextStub();
        },
      };
    },
  };

  try {
    return run();
  } finally {
    if (typeof originalDocument === "undefined") {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
  }
}

function createOrbitDomStub() {
  const rootNode = {
    addEventListener() {},
    removeEventListener() {},
  };
  return {
    style: {},
    addEventListener() {},
    removeEventListener() {},
    getRootNode() {
      return rootNode;
    },
  };
}

function assertVectorLikeClose(actualValues, expectedValues, epsilon = 1e-9) {
  assert.equal(actualValues.length, expectedValues.length);
  actualValues.forEach((value, index) => {
    assert.ok(Math.abs(value - expectedValues[index]) <= epsilon, `index ${index}: ${value} != ${expectedValues[index]}`);
  });
}

test("loadModel makes thin garments double-sided and preserves metal highlights", async () => {
  const skin = makeMaterial({ name: "Face Skin", shininess: 80, specular: 1 });
  const metal = makeMaterial({ name: "Armor Metal", shininess: 80, specular: 1 });
  const skirt = makeMaterial({ name: "Skirt Cloth", shininess: 40, specular: 0.7 });

  const runtime = makeRuntime();
  runtime.loader = {
    load(_url, onLoad) {
      onLoad(
        makeMesh({
          materials: [skin, metal, skirt],
          bones: [{ isBone: true, name: "head", rotation: new THREE.Euler(0, 0, 0) }],
        }),
      );
    },
  };

  await runtime.loadModel("/fake-model.pmx");

  assert.equal(skirt.side, THREE.DoubleSide);
  assert.ok(skin.shininess < 80);
  assert.equal(metal.shininess, 80);
  assert.ok(skin.specular.r < 1);
  assert.equal(metal.specular.r, 1);
});

test("captureBones also records common morph slots for face animation", () => {
  const runtime = makeRuntime();
  const mesh = makeMesh({
    materials: [],
    bones: [{ isBone: true, name: "head", rotation: new THREE.Euler(0, 0, 0) }],
    morphTargetDictionary: {
      smile: 0,
      sad: 1,
      blink: 2,
      mouth_a: 3,
      mouth_i: 4,
      mouth_u: 5,
    },
  });

  runtime.captureBones(mesh);

  assert.deepEqual(runtime.morphSlots, {
    smile: 0,
    sad: 1,
    blink: 2,
    mouthA: 3,
    mouthI: 4,
    mouthU: 5,
  });
});

test("resetToBasePose restores unmapped bones when the model root has no pose() helper", () => {
  const runtime = makeRuntime();
  const head = new THREE.Bone();
  head.name = "head";
  head.rotation.set(0.1, 0.2, 0.3);
  const leftLeg = new THREE.Bone();
  leftLeg.name = "leftLeg";
  leftLeg.rotation.set(-0.25, 0.35, 0.45);
  leftLeg.position.set(1, 2, 3);

  const mesh = {
    morphTargetDictionary: {},
    morphTargetInfluences: [0.6],
    traverse(visitor) {
      visitor(head);
      visitor(leftLeg);
    },
  };

  runtime.model = mesh;
  runtime.captureBones(mesh);

  head.rotation.set(0.9, 0.8, 0.7);
  leftLeg.rotation.set(0.6, -0.4, 0.2);
  leftLeg.position.set(8, 9, 10);

  runtime.resetToBasePose();

  assertVectorLikeClose([head.rotation.x, head.rotation.y, head.rotation.z], [0.1, 0.2, 0.3]);
  assertVectorLikeClose([leftLeg.rotation.x, leftLeg.rotation.y, leftLeg.rotation.z], [-0.25, 0.35, 0.45]);
  assertVectorLikeClose([leftLeg.position.x, leftLeg.position.y, leftLeg.position.z], [1, 2, 3]);
  assert.deepEqual(mesh.morphTargetInfluences, [0]);
});

test("renderFrame drives mouth morphs while keeping eye-related morphs neutral", () => {
  const runtime = makeRuntime({
    renderPipeline: "classic",
    model: { morphTargetInfluences: [0, 0, 0, 0, 0, 0] },
    morphSlots: { smile: 0, sad: 1, blink: 2, mouthA: 3, mouthI: 4, mouthU: 5 },
    activeEmotion: "happy",
    isSpeaking: true,
  });

  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;

  try {
    runtime.renderFrame();
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }

  assert.deepEqual(runtime.model.morphTargetInfluences.slice(0, 3), [0, 0, 0]);
  assert.ok(runtime.model.morphTargetInfluences[3] > 0);
  assert.ok(runtime.model.morphTargetInfluences[4] > 0);
  assert.ok(runtime.model.morphTargetInfluences[5] > 0);
});

test("speaking mouth morph uses a moderated cadence instead of rapid 150ms flaps", () => {
  const runtime = makeRuntime({
    model: { morphTargetInfluences: [0, 0, 0, 0, 0, 0] },
    morphSlots: { smile: 0, sad: 1, blink: 2, mouthA: 3, mouthI: 4, mouthU: 5 },
    isSpeaking: true,
    speakingStartedAtMs: 0,
  });

  runtime.updateMorph(1, 0);
  const startOpen = runtime.model.morphTargetInfluences[3];
  runtime.updateMorph(1, 75);
  const earlyOpen = runtime.model.morphTargetInfluences[3];
  runtime.updateMorph(1, 150);
  const laterOpen = runtime.model.morphTargetInfluences[3];

  assert.ok(earlyOpen - startOpen < 0.35);
  assert.ok(laterOpen >= earlyOpen);
});

test("speaking mouth morph prefers waveform speech level when available", () => {
  const runtime = makeRuntime({
    model: { morphTargetInfluences: [0, 0, 0, 0, 0, 0] },
    morphSlots: { smile: 0, sad: 1, blink: 2, mouthA: 3, mouthI: 4, mouthU: 5 },
  });

  runtime.setSpeaking(true);
  runtime.setSpeechLevel(0.8);
  runtime.updateMorph(1, 0);
  const loudOpen = runtime.model.morphTargetInfluences[3];
  runtime.setSpeechLevel(0.05);
  runtime.updateMorph(1, 120);
  const quietOpen = runtime.model.morphTargetInfluences[3];
  runtime.setSpeaking(false);

  assert.ok(loudOpen > 0.5);
  assert.ok(quietOpen < loudOpen);
  assert.equal(runtime.speechLevel, 0);
});

test("speech visemes drive exact MMD mouth shapes ahead of waveform levels", () => {
  const runtime = makeRuntime({
    model: { morphTargetInfluences: [0, 0, 0, 0, 0, 0, 0, 0] },
    morphSlots: { smile: 0, sad: 1, blink: 2, mouthA: 3, mouthI: 4, mouthU: 5, mouthE: 6, mouthO: 7 },
  });

  runtime.setSpeaking(true);
  runtime.setSpeechLevel(0.9);
  runtime.setSpeechViseme({ viseme: "O", weight: 0.72 });
  runtime.updateMorph(1, 0);

  assert.ok(runtime.model.morphTargetInfluences[7] > runtime.model.morphTargetInfluences[3]);
  assert.ok(runtime.model.morphTargetInfluences[7] > runtime.model.morphTargetInfluences[5]);

  runtime.setSpeechViseme({ viseme: "M", weight: 1 });
  runtime.updateMorph(1, 120);

  assert.ok(runtime.model.morphTargetInfluences[3] < 0.05);
  assert.ok(runtime.model.morphTargetInfluences[4] < 0.05);
  assert.ok(runtime.model.morphTargetInfluences[5] < 0.05);
  assert.ok(runtime.model.morphTargetInfluences[6] < 0.05);
  assert.ok(runtime.model.morphTargetInfluences[7] < 0.05);
});

test("renderFrame ignores missing morph slot maps", () => {
  const runtime = makeRuntime({
    renderPipeline: "genshin",
    presentation: getStagePresentationConfig("genshin"),
    model: { morphTargetInfluences: [0] },
    morphSlots: undefined,
    expressionMorphSlots: undefined,
    isSpeaking: true,
  });

  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;

  try {
    runtime.renderFrame();
    assert.equal(runtime.model.morphTargetInfluences[0], 0);

    runtime.isSpeaking = false;
    runtime.renderFrame();
    assert.equal(runtime.model.morphTargetInfluences[0], 0);
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }
});

test("expression targets vary by emotion and action without using blink morphs", () => {
  const happyRuntime = makeRuntime({ activeEmotion: "happy", activeAction: "wave" });
  const thinkingRuntime = makeRuntime({ activeEmotion: "thinking", activeAction: "think" });
  const excitedRuntime = makeRuntime({ activeEmotion: "excited", activeAction: "cheer" });

  assert.ok(happyRuntime.getExpressionTargets().mouthSmile > 0);
  assert.ok(thinkingRuntime.getExpressionTargets().serious > 0);
  assert.ok(excitedRuntime.getExpressionTargets().mouthWide > 0);
  assert.equal("blink" in happyRuntime.getExpressionTargets(), false);
});

test("renderFrame restores root transport anchors and bones outside the active VMD clip", () => {
  const allParent = new THREE.Bone();
  allParent.name = "全ての親";
  allParent.position.set(0, 0, 0);
  const leftLegIk = new THREE.Bone();
  leftLegIk.name = "左足ＩＫ";
  leftLegIk.position.set(0, 0, 0);
  const finger = new THREE.Bone();
  finger.name = "右小指１";
  finger.position.set(0, 0, 0);

  const mesh = {
    morphTargetDictionary: {},
    morphTargetInfluences: [],
    traverse(visitor) {
      visitor(allParent);
      visitor(leftLegIk);
      visitor(finger);
    },
  };

  const runtime = makeRuntime({
    model: mesh,
    currentClip: { duration: 1, tracks: [{ name: `.bones[${finger.name}].quaternion` }] },
    helper: {
      update() {
        allParent.position.set(5, 0, 0);
        leftLegIk.position.set(2, 0, 0);
        finger.position.set(1, 0, 0);
      },
    },
  });
  runtime.captureBones(mesh);

  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;

  try {
    runtime.renderFrame();
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }

  assertVectorLikeClose([allParent.position.x, allParent.position.y, allParent.position.z], [0, 0, 0]);
  assertVectorLikeClose([leftLegIk.position.x, leftLegIk.position.y, leftLegIk.position.z], [0, 0, 0]);
  assertVectorLikeClose([finger.position.x, finger.position.y, finger.position.z], [1, 0, 0]);
});

test("captureBones does not treat leg IK targets as fixed VMD anchors", () => {
  const leftLegIkParent = new THREE.Bone();
  leftLegIkParent.name = "左足IK親";
  leftLegIkParent.position.set(0, 0, 0);
  const leftLegIk = new THREE.Bone();
  leftLegIk.name = "左足ＩＫ";
  leftLegIk.position.set(0, 0, 0);

  const mesh = {
    morphTargetDictionary: {},
    morphTargetInfluences: [],
    traverse(visitor) {
      visitor(leftLegIkParent);
      visitor(leftLegIk);
    },
  };

  const runtime = makeRuntime({
    model: mesh,
  });
  runtime.captureBones(mesh);
  assert.equal(runtime.vmdAnchorBones.includes(leftLegIkParent), false);
  assert.equal(runtime.vmdAnchorBones.includes(leftLegIk), false);
});

test("playVmd builds clips against the captured base skeleton instead of the live animated mesh", async () => {
  const rightLegIk = new THREE.Bone();
  rightLegIk.name = "右足ＩＫ";
  rightLegIk.position.set(1, 2, 3);
  const mesh = {
    isSkinnedMesh: true,
    morphTargetDictionary: {},
    morphTargetInfluences: [],
    skeleton: {
      bones: [rightLegIk],
      getBoneByName(name) {
        return name === rightLegIk.name ? rightLegIk : null;
      },
    },
    traverse(visitor) {
      visitor(rightLegIk);
    },
  };

  const helperCalls = [];
  let loaderTarget = null;
  let loaderBasePosition = null;
  const runtime = makeRuntime({
    model: mesh,
    helper: {
      remove(target) {
        helperCalls.push(["remove", target]);
      },
      add(target, options) {
        helperCalls.push(["add", target, Boolean(options?.animation), Boolean(options?.physics)]);
      },
      update() {},
    },
    loader: {
      loadAnimation(_url, object, onLoad) {
        loaderTarget = object;
        loaderBasePosition = object.skeleton.getBoneByName("右足ＩＫ").position.toArray();
        onLoad({ duration: 1 });
      },
    },
    renderScene() {},
  });
  runtime.captureBones(mesh);
  rightLegIk.position.set(10, 20, 30);

  await runtime.playVmd("/motions/test.vmd", 1);

  assert.notEqual(loaderTarget, mesh);
  assert.deepEqual(loaderBasePosition, [1, 2, 3]);
  assert.deepEqual(helperCalls, [
    ["remove", mesh],
    ["add", mesh, true, false],
  ]);
});

test("stage presentation config keeps classic untouched while genshin now reuses the transparent classic framing", () => {
  const classic = getStagePresentationConfig("classic");
  const genshin = getStagePresentationConfig("genshin");
  const fallback = getStagePresentationConfig("unknown");

  assert.equal(classic.fog, null);
  assert.equal(classic.background, null);
  assert.equal(classic.camera.fov, 33);
  assert.deepEqual(classic.camera.position, [0, 9.2, 21.6]);
  assert.deepEqual(classic.camera.target, [0, 7.9, 0]);
  assert.equal(classic.character.targetHeight, 19.5);
  assert.equal(classic.floor.kind, "shadowCatcher");
  assert.equal(classic.floor.opacity, 0.2);
  assert.equal(classic.shadowMapType, THREE.PCFShadowMap);

  assert.equal(genshin.background, null);
  assert.equal(genshin.camera.fov, classic.camera.fov);
  assert.deepEqual(genshin.camera.position, classic.camera.position);
  assert.deepEqual(genshin.camera.target, classic.camera.target);
  assert.equal(genshin.camera.locked, false);
  assert.equal(genshin.backdrop.enabled, false);
  assert.equal(genshin.outline.enabled, false);
  assert.equal(genshin.postfx.enabled, false);
  assert.equal(genshin.lights.ambient.intensity, 0.8);
  assert.equal(genshin.lights.hemisphere.intensity, 0.6);
  assert.equal(genshin.lights.key.intensity, 1.2);
  assert.equal(genshin.lights.fill.intensity, 0.5);
  assert.equal(genshin.shadowMapType, THREE.PCFSoftShadowMap);
  assert.equal(genshin.floor.y, classic.floor.y);
  assert.equal(genshin.floor.opacity, classic.floor.opacity);

  assert.deepEqual(fallback, classic);
});

test("fitModelToPresentation recenters a loaded mesh on the stage floor and normalizes its height", () => {
  const presentation = getStagePresentationConfig("classic");
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(4, 10, 2), new THREE.MeshBasicMaterial());
  body.position.set(6, 5, -3);
  group.add(body);

  runtimeModule.fitModelToPresentation(group, presentation);

  const bounds = new THREE.Box3().setFromObject(group);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());

  assert.ok(Math.abs(bounds.min.y - presentation.floor.y) < 1e-6);
  assert.ok(Math.abs(center.x) < 1e-6);
  assert.ok(Math.abs(center.z) < 1e-6);
  assert.ok(Math.abs(size.y - presentation.character.targetHeight) < 1e-6);
});

test("stage presentation config supports hero-shot while preserving classic fallback", () => {
  const classic = getStagePresentationConfig("classic");
  const heroShot = getStagePresentationConfig("hero-shot");

  assert.equal(classic.camera.fov, 33);
  assert.notDeepEqual(heroShot.camera.position, classic.camera.position);
  assert.equal(heroShot.character.targetHeight, 19.5);
  assert.ok(heroShot.outline?.enabled);
  assert.ok(heroShot.backdrop?.enabled);
  assert.ok(heroShot.postfx?.enabled);
  assert.deepEqual(getStagePresentationConfig("unknown"), classic);
});

test("stage presentation config exposes mio-reference unlocked by default", () => {
  const reference = getStagePresentationConfig("mio-reference");

  assert.equal(reference.background, null);
  assert.equal(reference.renderer.toneMapping, "none");
  assert.equal(reference.renderer.exposure, 1.57);
  assert.equal(reference.camera.fov, 32);
  assert.deepEqual(reference.camera.position, [-9.39, 12.522935, 43.63]);
  assert.deepEqual(reference.camera.target, [-1.861732, -2.847643, 1.048369]);
  assert.equal(reference.camera.minDistance, 21);
  assert.equal(reference.camera.maxDistance, 72);
  assert.equal(reference.camera.maxPolarAngle, 1.5079644737231006);
  assert.equal(reference.camera.locked, false);
  assert.equal(reference.lights.ambient.intensity, 0.2);
  assert.equal(reference.lights.hemisphere.sky, "#ff6929");
  assert.equal(reference.lights.hemisphere.intensity, 0.48);
  assert.deepEqual(reference.lights.key.position, [-18.5, -25.6, 64.3]);
  assert.equal(reference.lights.key.intensity, 1.43);
  assert.equal(reference.lights.fill.intensity, 0.61);
  assert.deepEqual(reference.lights.rim.position, [0, 16.2, 3.5]);
  assert.equal(reference.lights.rim.intensity, 0);
  assert.equal(reference.backdrop.enabled, false);
  assert.equal(reference.floor.opacity, 0.22);
  assert.equal(reference.floor.contactShadow.enabled, true);
  assert.equal(reference.materialAdjustments.hair.tintColor, "#02c2f2");
  assert.equal(reference.materialAdjustments.hair.tintStrength, 0.61);
  assert.equal(reference.postfx.enabled, false);
  assert.equal(reference.postfx.bloomStrength, 0.88);
});

test("mio-reference keeps the chin line face detail disabled by default", () => {
  const reference = getStagePresentationConfig("mio-reference");

  assert.deepEqual(reference.faceDetails.chinLine.points, [
    [-0.34, -0.34, 0.56],
    [-0.18, -0.43, 0.62],
    [0, -0.46, 0.64],
    [0.18, -0.43, 0.62],
    [0.34, -0.34, 0.56],
  ]);
  assert.equal(reference.faceDetails.chinLine.enabled, false);
  assert.equal(reference.faceDetails.chinLine.anchor, "head");
  assert.equal(reference.faceDetails.chinLine.color, "#2f2632");
  assert.equal(reference.faceDetails.chinLine.opacity, 0.38);
  assert.equal(reference.faceDetails.chinLine.radius, 0.012);
});

test("stage presentation config exposes reze-npr as an isolated experimental renderer preset", () => {
  const classic = getStagePresentationConfig("classic");
  const reze = getStagePresentationConfig("reze-npr");

  assert.equal(classic.postfx.enabled, false);
  assert.equal(classic.outline.enabled, false);
  assert.equal(classic.renderer, undefined);

  assert.equal(reze.background, null);
  assert.equal(reze.camera.locked, false);
  assert.equal(reze.character.targetHeight, 19.5);
  assert.equal(reze.floor.kind, "shadowCatcher");
  assert.ok(reze.floor.opacity > 0);
  assert.equal(reze.outline.enabled, true);
  assert.equal(reze.postfx.enabled, true);
  assert.equal(reze.postfx.bloomThreshold, 0.5);
  assert.equal(reze.renderer.toneMapping, "aces");
  assert.ok(reze.lights.key.intensity > classic.lights.key.intensity);
});

test("stage presentation config applies the supplied Reze Design lighting while preserving the MIO stage base", () => {
  const rezeDesign = getStagePresentationConfig("reze-design");

  assert.equal(rezeDesign.background, null);
  assert.equal(rezeDesign.camera.fov, 32);
  assert.deepEqual(rezeDesign.camera.position, [0, 11.4, 26.2]);
  assert.deepEqual(rezeDesign.camera.target, [0, 11.4, 0]);
  assert.equal(rezeDesign.camera.minDistance, 21);
  assert.equal(rezeDesign.camera.maxDistance, 72);
  assert.equal(rezeDesign.lights.ambient.color, "#fef2f2");
  assert.equal(rezeDesign.lights.ambient.intensity, 0.4);
  assert.equal(rezeDesign.lights.key.intensity, 1.35);
  assert.deepEqual(rezeDesign.lights.key.position, [-20.45, 14.08, -14.32]);
  assert.equal(rezeDesign.floor.kind, "shadowCatcher");
  assert.equal(rezeDesign.floor.size, 44);
  assert.equal(rezeDesign.backdrop.enabled, false);
  assert.equal(rezeDesign.postfx.bloomStrength, 0.09);
  assert.equal(rezeDesign.postfx.bloomThreshold, 0.81);
  assert.equal(rezeDesign.outline.enabled, true);
});

test("stage presentation config exposes k3 as a high-fidelity preset with postfx and fine outline", () => {
  const classic = getStagePresentationConfig("classic");
  const k3 = getStagePresentationConfig("k3");

  assert.equal(classic.postfx.enabled, false);
  assert.equal(classic.outline.enabled, false);
  assert.equal(classic.renderer, undefined);
  assert.equal(classic.lights.key.shadowMapSize, undefined);

  assert.equal(k3.background, null);
  assert.equal(k3.camera.locked, false);
  assert.equal(k3.camera.fov, classic.camera.fov);
  assert.deepEqual(k3.camera.position, classic.camera.position);
  assert.equal(k3.character.targetHeight, 19.5);
  assert.equal(k3.renderer.toneMapping, "aces");
  assert.equal(k3.renderer.pixelRatioCap, 3);
  assert.equal(k3.lights.key.shadowMapSize, 4096);
  assert.equal(k3.shadowMapType, THREE.PCFSoftShadowMap);
  assert.equal(k3.outline.enabled, true);
  assert.ok(k3.outline.scale < 1.02);
  assert.equal(k3.postfx.enabled, true);
  // UnrealBloomPass 会涂黑透明背景，K3 的 bloom 必须保持关闭
  assert.equal(k3.postfx.bloomStrength, 0);
  assert.equal(k3.floor.kind, "shadowCatcher");
  assert.equal(k3.floor.contactShadow.enabled, true);
  assert.equal(k3.backdrop.enabled, false);
});

test("stage presentation config k3 is cloned per call and leaves other presets untouched", () => {
  const k3a = getStagePresentationConfig("k3");
  k3a.renderer.pixelRatioCap = 1;
  k3a.lights.key.shadowMapSize = 1024;
  k3a.outline.enabled = false;

  const k3b = getStagePresentationConfig("k3");
  assert.equal(k3b.renderer.pixelRatioCap, 3);
  assert.equal(k3b.lights.key.shadowMapSize, 4096);
  assert.equal(k3b.outline.enabled, true);

  const classic = getStagePresentationConfig("classic");
  assert.equal(classic.outline.enabled, false);
  assert.equal(classic.postfx.enabled, false);
});

test("reze-npr material tuning maps PMX material names to renderer-inspired presets", () => {
  assert.equal(inferRezeMaterialPreset(makeMaterial({ name: "face01" })), "face");
  assert.equal(inferRezeMaterialPreset(makeMaterial({ name: "body skin" })), "body");
  assert.equal(inferRezeMaterialPreset(makeMaterial({ name: "hair01" })), "hair");
  assert.equal(inferRezeMaterialPreset(makeMaterial({ name: "pupil_R" })), "eye");
  assert.equal(inferRezeMaterialPreset(makeMaterial({ name: "black stockings" })), "stockings");
  assert.equal(inferRezeMaterialPreset(makeMaterial({ name: "weapon metal" })), "metal");
  assert.equal(inferRezeMaterialPreset(makeMaterial({ name: "rough jacket" })), "cloth_rough");
  assert.equal(inferRezeMaterialPreset(makeMaterial({ name: "summer dress" })), "cloth_smooth");
});

test("reze-npr material tuning uses alpha-hash for stocking and cutout-like materials", () => {
  const stockings = makeMaterial({ name: "Black Stockings", transparent: true, opacity: 0.62, alphaMap: {} });
  const eye = makeMaterial({ name: "Pupil_R", shininess: 12, specular: 0.2 });

  tuneRezeNprMMDMaterial(stockings, {});
  tuneRezeNprMMDMaterial(eye, {});

  assert.equal(stockings.userData.rezePreset, "stockings");
  assert.equal(stockings.alphaHash, true);
  assert.equal(stockings.alphaToCoverage, true);
  assert.equal(stockings.depthWrite, true);
  assert.equal(stockings.transparent, false);
  assert.equal(stockings.side, THREE.DoubleSide);
  assert.ok(stockings.alphaTest > 0);
  assert.equal(stockings.needsUpdate, true);

  assert.equal(eye.userData.rezePreset, "eye");
  assert.ok(eye.emissiveIntensity > 0);
  assert.ok(eye.shininess > 12);
});

test("hero-shot presentation keeps portrait staging and lighting restrained", () => {
  const heroShot = getStagePresentationConfig("hero-shot");

  assert.ok(heroShot.camera.fov >= 30);
  assert.ok(heroShot.camera.fov <= 31);
  assert.ok(heroShot.camera.fov < getStagePresentationConfig("classic").camera.fov);
  assert.ok(heroShot.camera.position[2] <= 20.8);
  assert.ok(heroShot.floor.y <= -10.3);
  assert.ok(heroShot.floor.opacity <= 0.03);
  assert.ok(heroShot.lights.ambient.intensity <= 0.7);
  assert.ok(heroShot.lights.key.intensity <= 1.5);
  assert.ok(heroShot.backdrop.panelSize[1] >= 40);
  assert.ok(heroShot.backdrop.panelOpacity >= 0.58);
  assert.ok(heroShot.backdrop.ringOpacity >= 0.5);
  assert.notEqual(heroShot.backdrop.panelColorBottom, "#06162d");
  assert.ok(heroShot.outline.scale >= 1.038);
  assert.ok(heroShot.postfx.bloomStrength >= 0.1);
  assert.ok(heroShot.postfx.bloomStrength <= 0.16);
  assert.ok(heroShot.postfx.grade.contrast >= 1.08);
  assert.ok(heroShot.postfx.grade.saturation >= 1.1);
});

test("runtime stores explicit and default render pipelines", () => {
  const classicRuntime = new MMDCompanionRuntime({
    container: { clientWidth: 1, clientHeight: 1, replaceChildren() {} },
    statusElement: null,
  });
  const genshinRuntime = new MMDCompanionRuntime({
    container: { clientWidth: 1, clientHeight: 1, replaceChildren() {} },
    statusElement: null,
    renderPipeline: "genshin",
  });

  assert.equal(classicRuntime.renderPipeline, "classic");
  assert.equal(genshinRuntime.renderPipeline, "genshin");
});

test("setupScene runs classic shared setup steps in order and dispatches the classic branch", () => {
  const calls = [];
  const runtime = makeRuntime({
    renderPipeline: "classic",
    setupRenderer(presentation) {
      calls.push(["renderer", presentation.camera.fov]);
    },
    setupCamera(presentation) {
      calls.push(["camera", presentation.camera.target.join(",")]);
    },
    setupLights(presentation) {
      calls.push(["lights", presentation.lights.ambient.intensity]);
    },
    setupFloor(presentation) {
      calls.push(["floor", presentation.floor.opacity]);
    },
    setupBackdrop(presentation) {
      calls.push(["backdrop", presentation.background]);
    },
    setupClassicPipeline(presentation) {
      calls.push(["classic", presentation.floor.y]);
    },
    setupGenshinPipeline() {
      calls.push(["genshin"]);
    },
    setupPostprocessing() {},
  });

  runtime.setupScene();

  assert.equal(runtime.scene.isScene, true);
  assert.equal(runtime.scene.background, null);
  assert.equal(runtime.scene.fog, null);
  assert.deepEqual(calls, [
    ["renderer", 33],
    ["camera", "0,7.9,0"],
    ["lights", 0.78],
    ["floor", 0.2],
    ["backdrop", null],
    ["classic", -9.75],
  ]);
});

test("setupScene dispatches the genshin branch after the shared setup steps", () => {
  const calls = [];
  const runtime = makeRuntime({
    renderPipeline: "genshin",
    setupRenderer(presentation) {
      calls.push(["renderer", presentation.camera.fov]);
    },
    setupCamera(presentation) {
      calls.push(["camera", presentation.camera.target.join(",")]);
    },
    setupLights(presentation) {
      calls.push(["lights", presentation.lights.ambient.intensity]);
    },
    setupFloor(presentation) {
      calls.push(["floor", presentation.floor.opacity]);
    },
    setupBackdrop(presentation) {
      calls.push(["backdrop", presentation.background]);
    },
    setupClassicPipeline() {
      calls.push(["classic"]);
    },
    setupGenshinPipeline(presentation) {
      calls.push(["genshin", presentation.floor.y]);
    },
    setupPostprocessing() {},
  });

  runtime.setupScene();

  assert.equal(runtime.scene.isScene, true);
  assert.equal(runtime.scene.background, null);
  assert.deepEqual(calls, [
    ["renderer", 33],
    ["camera", "0,7.9,0"],
    ["lights", 0.8],
    ["floor", 0.2],
    ["backdrop", null],
    ["genshin", -9.75],
  ]);
});

test("setupCamera keeps genshin at the screenshot MMD framing without locking controls by default", () => {
  const runtime = makeRuntime({
    renderPipeline: "genshin",
    renderer: { domElement: createOrbitDomStub() },
  });

  runtime.setupCamera(getStagePresentationConfig("genshin"));

  assertVectorLikeClose(runtime.camera.position.toArray(), [0, 9.2, 21.6]);
  assertVectorLikeClose(runtime.controls.target.toArray(), [0, 7.9, 0]);
  assert.equal(runtime.controls.enabled, true);
  assert.equal(runtime.controls.enableRotate, true);
  assert.equal(runtime.controls.enablePan, true);
  assert.equal(runtime.controls.enableZoom, true);
});

test("runtime camera controls can be unlocked, moved, captured, and locked again", () => {
  const runtime = makeRuntime({
    renderPipeline: "genshin",
    renderer: { domElement: createOrbitDomStub() },
  });

  runtime.setupCamera(getStagePresentationConfig("genshin"));
  runtime.setCameraLocked(false);

  assert.equal(runtime.controls.enabled, true);
  assert.equal(runtime.controls.enableRotate, true);
  assert.equal(runtime.controls.enablePan, true);
  assert.equal(runtime.controls.enableZoom, true);
  assertVectorLikeClose(runtime.camera.position.toArray(), [0, 9.2, 21.6]);

  runtime.camera.fov = 37;
  runtime.camera.position.set(1, 2, 3);
  runtime.controls.target.set(4, 5, 6);

  const snapshot = runtime.getCameraSnapshot();
  assert.deepEqual(snapshot, {
    fov: 37,
    position: [1, 2, 3],
    target: [4, 5, 6],
    locked: false,
  });

  const lockedSnapshot = runtime.setCameraLocked(true);
  assert.deepEqual(lockedSnapshot, {
    fov: 37,
    position: [1, 2, 3],
    target: [4, 5, 6],
    locked: true,
  });
  assert.equal(runtime.controls.enabled, false);
});

test("hitTestModelAtClientPoint returns true only when the pointer intersects the loaded model", () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const model = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  model.updateMatrixWorld(true);

  const runtime = makeRuntime({
    camera,
    model,
    renderer: {
      domElement: {
        getBoundingClientRect() {
          return { left: 10, top: 20, width: 100, height: 100 };
        },
      },
    },
  });

  assert.equal(runtime.hitTestModelAtClientPoint(60, 70), true);
  assert.equal(runtime.hitTestModelAtClientPoint(10, 20), false);
});

test("setupScene applies a saved genshin camera snapshot before camera setup", () => {
  const calls = [];
  const runtime = makeRuntime({
    renderPipeline: "genshin",
    cameraSnapshot: {
      fov: 38,
      position: [2, 8, 19],
      target: [0.5, 7.25, -0.4],
      locked: true,
    },
    setupRenderer() {},
    setupCamera(presentation) {
      calls.push(["camera", presentation.camera.fov, presentation.camera.position, presentation.camera.target, presentation.camera.locked]);
    },
    setupLights() {},
    setupFloor() {},
    setupBackdrop() {},
    setupGenshinPipeline() {},
    setupPostprocessing() {},
  });

  runtime.setupScene();

  assert.deepEqual(calls, [["camera", 38, [2, 8, 19], [0.5, 7.25, -0.4], true]]);
});

test("genshin material tuning keeps texture color space, cutout safety, and clears ordinary emissive lift", () => {
  const material = makeMaterial({ name: "Hair Cloth", transparent: true, specular: 0.7, shininess: 40 });
  const ramp = { id: "genshin-ramp" };

  runtimeModule.tuneGenshinMMDMaterial?.(material, ramp);

  assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(material.emissiveMap.colorSpace, THREE.SRGBColorSpace);
  assert.equal(material.alphaTest, 0.5);
  assert.equal(material.side, THREE.DoubleSide);
  assert.equal(material.gradientMap, ramp);
  assert.equal(material.emissive.getHex(), 0x000000);
});

test("genshin material tuning boosts explicit glow materials without changing classic glow policy", () => {
  const classic = makeMaterial({ name: "purple glow fx", shininess: 20 });
  const genshin = makeMaterial({ name: "purple glow fx", shininess: 20 });
  const classicRamp = { id: "classic-ramp" };
  const genshinRamp = { id: "genshin-ramp" };

  runtimeModule.tuneClassicMMDMaterial?.(classic, classicRamp);
  runtimeModule.tuneGenshinMMDMaterial?.(genshin, genshinRamp);

  assert.notEqual(classic.emissive.getHex(), 0x9d00ff);
  assert.equal(genshin.emissive.getHex(), 0x9d00ff);
  assert.equal(genshin.emissiveIntensity, 1);
  assert.equal(genshin.gradientMap.id, "genshin-ramp");
});

test("genshin glow detection requires explicit glow or purple fx material names", () => {
  assert.equal(runtimeModule.isGenshinGlowMaterial?.("purple glow fx"), true);
  assert.equal(runtimeModule.isGenshinGlowMaterial?.("emissive aura"), true);
  assert.equal(runtimeModule.isGenshinGlowMaterial?.("nonemissive cloth"), false);
  assert.equal(runtimeModule.isGenshinGlowMaterial?.("purple cloth"), false);
  assert.equal(runtimeModule.isGenshinGlowMaterial?.("fx dress"), false);
});

test("classic material tuning remains separate from genshin emissive cleanup policy", () => {
  const classic = makeMaterial({ name: "Glow FX" });
  const genshin = makeMaterial({ name: "Face Skin" });
  const classicRamp = { id: "classic-ramp" };
  const genshinRamp = { id: "genshin-ramp" };

  runtimeModule.tuneClassicMMDMaterial?.(classic, classicRamp);
  runtimeModule.tuneGenshinMMDMaterial?.(genshin, genshinRamp);

  assert.notEqual(classic.emissive.getHex(), 0x000000);
  assert.equal(genshin.emissive.getHex(), 0x000000);
  assert.equal(classic.gradientMap.id, "classic-ramp");
  assert.equal(genshin.gradientMap.id, "genshin-ramp");
});

test("genshin mask detection follows the broader project2 mask suppression rule", () => {
  assert.equal(runtimeModule.isGenshinSuppressedMaskMaterial?.("face skin"), false);
  assert.equal(runtimeModule.isGenshinSuppressedMaskMaterial?.("eye lash"), false);
  assert.equal(runtimeModule.isGenshinSuppressedMaskMaterial?.("surface mask"), true);
  assert.equal(runtimeModule.isGenshinSuppressedMaskMaterial?.("tengu mask"), true);
  assert.equal(runtimeModule.isGenshinSuppressedMaskMaterial?.("mask ornament"), true);
  assert.equal(runtimeModule.isGenshinSuppressedMaskMaterial?.("face mask ornament"), true);
  assert.equal(runtimeModule.isGenshinSuppressedMaskMaterial?.("face mask"), true);
  assert.equal(runtimeModule.isGenshinSuppressedMaskMaterial?.("mouth mask"), true);
});

test("genshin material tuning suppresses broad project2-style mask materials", () => {
  const mask = makeMaterial({ name: "face mask" });
  const ornament = makeMaterial({ name: "mask ornament" });

  runtimeModule.tuneGenshinMMDMaterial?.(mask, { id: "genshin-ramp" });
  runtimeModule.tuneGenshinMMDMaterial?.(ornament, { id: "genshin-ramp" });

  assert.equal(mask.visible, false);
  assert.equal(mask.transparent, true);
  assert.equal(mask.opacity, 0);
  assert.equal(ornament.visible, false);
  assert.equal(ornament.opacity, 0);
});

test("classic and genshin material tuners diverge while preserving cutout safety", () => {
  const classic = makeMaterial({ name: "Hair Cloth", transparent: true, specular: 0.7, shininess: 40 });
  const genshin = makeMaterial({ name: "Hair Cloth", transparent: true, specular: 0.7, shininess: 40 });
  const classicRamp = { id: "classic-ramp" };
  const genshinRamp = { id: "genshin-ramp" };

  runtimeModule.tuneClassicMMDMaterial?.(classic, classicRamp);
  runtimeModule.tuneGenshinMMDMaterial?.(genshin, genshinRamp);

  assert.equal(classic.alphaTest, 0.5);
  assert.equal(classic.side, THREE.DoubleSide);
  assert.equal(classic.gradientMap, classicRamp);
  assert.equal(classic.shininess, 26);

  assert.equal(genshin.alphaTest, 0.5);
  assert.equal(genshin.side, THREE.DoubleSide);
  assert.equal(genshin.gradientMap, genshinRamp);
  assert.equal(genshin.emissive.getHex(), 0x000000);
});

test("genshin material tuning preserves authored toon ramps while keeping hair presentation readable", () => {
  const existingGradientMap = { id: "authored-ramp" };
  const hair = makeMaterial({ name: "前髪", transparent: false, specular: 0.7, shininess: 40 });
  hair.gradientMap = existingGradientMap;

  runtimeModule.tuneGenshinMMDMaterial?.(hair, { id: "generated-ramp" });

  assert.equal(hair.gradientMap, existingGradientMap);
  assert.equal(hair.side, THREE.DoubleSide);
  assert.equal(hair.emissive.getHex(), 0x000000);
});

test("mio-reference character rendering reuses genshin material tuning", () => {
  const genshin = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });
  const reference = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });

  runtimeModule.tuneGenshinMMDMaterial?.(genshin, { id: "genshin-ramp" });
  runtimeModule.tuneGenshinMMDMaterial?.(reference, { id: "mio-reference-ramp" });

  assert.equal(reference.alphaTest, genshin.alphaTest);
  assert.equal(reference.side, genshin.side);
  assert.equal(reference.shininess, genshin.shininess);
  assert.equal(reference.emissive.getHex(), genshin.emissive.getHex());
  assert.equal(reference.envMapIntensity, genshin.envMapIntensity);
});

test("mio-reference applies exported material tint settings after genshin cleanup", async () => {
  const hairMaterial = makeMaterial({ name: "Hair Main", shininess: 80, specular: 1 });
  const runtime = makeRuntime({
    renderPipeline: "mio-reference",
    toonRampTexture: { id: "mio-ramp" },
    presentation: getStagePresentationConfig("mio-reference"),
  });
  runtime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [hairMaterial] }));
    },
  };

  await runtime.loadModel("/fake-model.pmx");

  const expectedHairTint = new THREE.Color(1, 1, 1).lerp(new THREE.Color("#02c2f2"), 0.61);
  assertVectorLikeClose(hairMaterial.color.toArray(), expectedHairTint.toArray());
  assert.equal(hairMaterial.userData.mioMaterialAdjustmentSlot, "hair");
});

test("hero-shot material tuning differs from classic while preserving alpha safety", () => {
  const classic = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });
  const hero = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });
  const classicRamp = { id: "classic-ramp" };
  const heroRamp = { id: "hero-shot-ramp" };

  runtimeModule.tuneClassicMMDMaterial?.(classic, classicRamp);
  runtimeModule.tuneHeroShotMMDMaterial?.(hero, heroRamp);

  assert.ok(classic.alphaTest >= 0.48);
  assert.ok(hero.alphaTest >= 0.48);
  assert.notEqual(hero.emissiveIntensity, classic.emissiveIntensity);
  assert.equal(hero.gradientMap, heroRamp);
});

test("hero-shot keeps face shading softer than generic cloth shading", () => {
  const face = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });
  const cloth = makeMaterial({ name: "Cape Cloth", transparent: true, specular: 1, shininess: 80 });
  const heroRamp = { id: "hero-shot-ramp" };

  runtimeModule.tuneHeroShotMMDMaterial?.(face, heroRamp);
  runtimeModule.tuneHeroShotMMDMaterial?.(cloth, heroRamp);

  assert.ok(face.alphaTest >= 0.48);
  assert.ok(cloth.alphaTest >= 0.48);
  assert.ok(face.shininess < cloth.shininess);
  assert.ok(face.emissiveIntensity > cloth.emissiveIntensity);
  assert.ok(face.envMapIntensity < cloth.envMapIntensity);
});

test("hero-shot face material lift stays below overexposure range", () => {
  const face = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });

  runtimeModule.tuneHeroShotMMDMaterial?.(face, { id: "hero-shot-ramp" });

  assert.ok(face.emissiveIntensity >= 0.24);
  assert.ok(face.emissiveIntensity <= 0.3);
  assert.ok(face.specular.r <= 0.16);
  assert.ok(face.envMapIntensity <= 0.18);
});

test("loadModel selects material tuning by renderPipeline", async () => {
  const classicMaterial = makeMaterial({ name: "Hair Cloth", transparent: true, specular: 0.7, shininess: 40 });
  const genshinMaterial = makeMaterial({ name: "Hair Cloth", transparent: true, specular: 0.7, shininess: 40 });
  const genshinFaceMaterial = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });
  const heroShotMaterial = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });
  const mioReferenceMaterial = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });

  const classicRuntime = makeRuntime({ renderPipeline: "classic", toonRampTexture: { id: "classic-ramp" } });
  classicRuntime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [classicMaterial] }));
    },
  };

  const genshinRuntime = makeRuntime({ renderPipeline: "genshin", toonRampTexture: { id: "genshin-ramp" } });
  genshinRuntime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [genshinMaterial] }));
    },
  };

  const genshinFaceRuntime = makeRuntime({ renderPipeline: "genshin", toonRampTexture: { id: "genshin-ramp" } });
  genshinFaceRuntime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [genshinFaceMaterial] }));
    },
  };

  const heroShotRuntime = makeRuntime({ renderPipeline: "hero-shot", toonRampTexture: { id: "hero-shot-ramp" } });
  heroShotRuntime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [heroShotMaterial] }));
    },
  };

  const mioReferenceRuntime = makeRuntime({ renderPipeline: "mio-reference", toonRampTexture: { id: "mio-reference-ramp" } });
  mioReferenceRuntime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [mioReferenceMaterial] }));
    },
  };

  await classicRuntime.loadModel("/classic-model.pmx");
  await genshinRuntime.loadModel("/genshin-model.pmx");
  await genshinFaceRuntime.loadModel("/genshin-face-model.pmx");
  await heroShotRuntime.loadModel("/hero-shot-model.pmx");
  await mioReferenceRuntime.loadModel("/mio-reference-model.pmx");

  assert.equal(classicMaterial.alphaTest, 0.5);
  assert.equal(classicMaterial.shininess, 26);
  assert.equal(classicMaterial.gradientMap.id, "classic-ramp");

  assert.equal(genshinMaterial.alphaTest, 0.5);
  assert.equal(genshinMaterial.side, THREE.DoubleSide);
  assert.equal(genshinMaterial.gradientMap.id, "genshin-ramp");
  assert.equal(genshinMaterial.emissive.getHex(), 0x000000);

  assert.ok(heroShotMaterial.alphaTest >= 0.48);
  assert.equal(heroShotMaterial.gradientMap.id, "hero-shot-ramp");
  assert.notEqual(heroShotMaterial.shininess, classicMaterial.shininess);
  assert.notEqual(heroShotMaterial.emissiveIntensity, classicMaterial.emissiveIntensity);

  assert.equal(mioReferenceMaterial.alphaTest, 0.5);
  assert.equal(mioReferenceMaterial.gradientMap.id, "mio-reference-ramp");
  assert.equal(mioReferenceMaterial.shininess, genshinFaceMaterial.shininess);
  assert.equal(mioReferenceMaterial.emissive.getHex(), genshinFaceMaterial.emissive.getHex());
});

test("k3 material tuning softens skin, keeps hair sheen, and boosts eye highlights", () => {
  const face = makeMaterial({ name: "face01", specular: 1, shininess: 80 });
  const hair = makeMaterial({ name: "hair01", specular: 1, shininess: 80 });
  const eye = makeMaterial({ name: "eye pupil", specular: 1, shininess: 12 });
  tuneK3MMDMaterial(face, null);
  tuneK3MMDMaterial(hair, null);
  tuneK3MMDMaterial(eye, null);

  assert.equal(face.side, THREE.DoubleSide);
  assert.equal(face.alphaTest, 0.5);
  assert.ok(face.shininess <= 12);
  assert.ok(face.specular.r <= 0.45);
  assert.equal(face.emissive.getHex(), 0x1c100c);
  assert.equal(face.emissiveIntensity, 0.14);

  assert.equal(hair.shininess, 32);
  assert.ok(hair.specular.r > face.specular.r);

  assert.equal(eye.shininess, 40);
  assert.ok(eye.envMapIntensity > hair.envMapIntensity);
  assert.ok(eye.emissiveIntensity >= 0.2);
});

test("k3 material tuning boosts explicit glow and suppresses project2-style masks", () => {
  const glow = makeMaterial({ name: "emissive glow" });
  const mask = makeMaterial({ name: "face mask" });
  tuneK3MMDMaterial(glow, null);
  tuneK3MMDMaterial(mask, null);

  assert.equal(glow.emissive.getHex(), 0x9d00ff);
  assert.equal(glow.emissiveIntensity, 1);
  assert.notEqual(glow.visible, false);

  assert.equal(mask.visible, false);
  assert.equal(mask.opacity, 0);
});

test("loadModel routes k3 materials through k3 tuning instead of genshin or classic", async () => {
  const k3FaceMaterial = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });
  const genshinFaceMaterial = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });

  const k3Runtime = makeRuntime({
    renderPipeline: "k3",
    toonRampTexture: { id: "k3-ramp" },
    toonSkinRampTexture: { id: "k3-skin-ramp" },
  });
  k3Runtime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [k3FaceMaterial] }));
    },
  };

  const genshinRuntime = makeRuntime({ renderPipeline: "genshin", toonRampTexture: { id: "genshin-ramp" } });
  genshinRuntime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [genshinFaceMaterial] }));
    },
  };

  await k3Runtime.loadModel("/k3-model.pmx");
  await genshinRuntime.loadModel("/genshin-face-model.pmx");

  assert.equal(k3FaceMaterial.gradientMap.id, "k3-skin-ramp");
  assert.equal(k3FaceMaterial.emissive.getHex(), 0x1c100c);
  assert.equal(k3FaceMaterial.emissiveIntensity, 0.14);
  assert.equal(genshinFaceMaterial.emissive.getHex(), 0x000000);
  assert.equal(genshinFaceMaterial.emissiveIntensity, 0);
});

test("k3 skin materials use the warm skin ramp while hair keeps the global ramp", () => {
  const globalRamp = { id: "k3-global-ramp" };
  const skinRamp = { id: "k3-skin-ramp" };
  const skin = makeMaterial({ name: "skin body", specular: 1, shininess: 40 });
  const face = makeMaterial({ name: "face01", specular: 1, shininess: 40 });
  const hair = makeMaterial({ name: "hair01", specular: 1, shininess: 40 });
  const eye = makeMaterial({ name: "eye pupil", specular: 1, shininess: 40 });

  tuneK3MMDMaterial(skin, globalRamp, skinRamp);
  tuneK3MMDMaterial(face, globalRamp, skinRamp);
  tuneK3MMDMaterial(hair, globalRamp, skinRamp);
  tuneK3MMDMaterial(eye, globalRamp, skinRamp);

  assert.equal(skin.gradientMap.id, "k3-skin-ramp");
  assert.equal(face.gradientMap.id, "k3-skin-ramp");
  assert.equal(hair.gradientMap.id, "k3-global-ramp");
  assert.equal(eye.gradientMap.id, "k3-global-ramp");

  const fallback = makeMaterial({ name: "skin arm", specular: 1, shininess: 40 });
  tuneK3MMDMaterial(fallback, globalRamp, null);
  assert.equal(fallback.gradientMap.id, "k3-global-ramp");
});

test("loadModel routes hero-shot face materials through hero-shot tuning instead of classic tuning", async () => {
  const classicFaceMaterial = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });
  const heroShotFaceMaterial = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });

  const classicRuntime = makeRuntime({ renderPipeline: "classic", toonRampTexture: { id: "classic-ramp" } });
  classicRuntime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [classicFaceMaterial] }));
    },
  };

  const heroShotRuntime = makeRuntime({ renderPipeline: "hero-shot", toonRampTexture: { id: "hero-shot-ramp" } });
  heroShotRuntime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [heroShotFaceMaterial] }));
    },
  };

  await classicRuntime.loadModel("/classic-face-model.pmx");
  await heroShotRuntime.loadModel("/hero-shot-face-model.pmx");

  assert.notEqual(heroShotFaceMaterial.shininess, classicFaceMaterial.shininess);
  assert.notEqual(heroShotFaceMaterial.emissiveIntensity, classicFaceMaterial.emissiveIntensity);
});

test("loadModel keeps outline disabled for classic and genshin while preserving hero-shot outline support", async () => {
  const classicCalls = [];
  const classicRuntime = makeRuntime({
    renderPipeline: "classic",
    toonRampTexture: { id: "classic-ramp" },
    attachCharacterOutline() {
      classicCalls.push("classic");
    },
    presentation: getStagePresentationConfig("classic"),
  });
  classicRuntime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [makeMaterial({ name: "Hair Cloth", transparent: true })] }));
    },
  };

  const genshinCalls = [];
  const genshinRuntime = makeRuntime({
    renderPipeline: "genshin",
    toonRampTexture: { id: "genshin-ramp" },
    attachCharacterOutline() {
      genshinCalls.push("genshin");
    },
    presentation: getStagePresentationConfig("genshin"),
  });
  genshinRuntime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [makeMaterial({ name: "Hair Cloth", transparent: true })] }));
    },
  };

  const heroShotCalls = [];
  const heroShotRuntime = makeRuntime({
    renderPipeline: "hero-shot",
    toonRampTexture: { id: "hero-shot-ramp" },
    attachCharacterOutline() {
      heroShotCalls.push("hero-shot");
    },
    presentation: getStagePresentationConfig("hero-shot"),
  });
  heroShotRuntime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [makeMaterial({ name: "Hair Cloth", transparent: true })] }));
    },
  };

  await classicRuntime.loadModel("/classic-model.pmx");
  await genshinRuntime.loadModel("/genshin-model.pmx");
  await heroShotRuntime.loadModel("/hero-shot-model.pmx");

  assert.deepEqual(classicCalls, []);
  assert.deepEqual(genshinCalls, []);
  assert.deepEqual(heroShotCalls, ["hero-shot"]);
});

test("non-genshin outlines keep hidden source material slots on the existing shared path", () => {
  const runtime = makeRuntime({
    renderPipeline: "hero-shot",
    presentation: getStagePresentationConfig("hero-shot"),
  });
  const visibleMaterial = makeMaterial({ name: "Hair" });
  const hiddenMaterial = makeMaterial({ name: "face mask" });
  hiddenMaterial.visible = false;
  const parent = { added: [], add(node) { this.added.push(node); }, remove() {} };

  runtime.attachCharacterOutline(
    {
      traverse(visitor) {
        visitor({
          isMesh: true,
          isSkinnedMesh: false,
          geometry: new THREE.BufferGeometry(),
          material: [visibleMaterial, hiddenMaterial],
          parent,
          position: new THREE.Vector3(),
          quaternion: new THREE.Quaternion(),
          scale: new THREE.Vector3(1, 1, 1),
          renderOrder: 0,
          name: "hero-shot-mixed-face",
        });
      },
    },
    getStagePresentationConfig("hero-shot"),
  );

  assert.equal(runtime.outlineObjects.length, 1);
  assert.equal(parent.added.length, 1);
  assert.equal(Array.isArray(runtime.outlineObjects[0].material), false);
});

test("attachFaceDetails skips the disabled mio-reference chin line by default", () => {
  const runtime = makeRuntime({
    renderPipeline: "mio-reference",
    faceDetailObjects: [],
    faceDetailMaterials: [],
  });
  const mesh = new THREE.Group();
  const head = new THREE.Bone();
  head.name = "head";
  mesh.add(head);
  runtime.captureBones(mesh);

  runtime.attachFaceDetails(mesh, getStagePresentationConfig("mio-reference"));

  assert.equal(runtime.faceDetailObjects.length, 0);
  assert.equal(runtime.faceDetailMaterials.length, 0);
  assert.equal(head.children.length, 0);
});

test("attachFaceDetails can still add a disposable chin line when explicitly enabled", () => {
  const runtime = makeRuntime({
    renderPipeline: "mio-reference",
    faceDetailObjects: [],
    faceDetailMaterials: [],
  });
  const mesh = new THREE.Group();
  const neck = new THREE.Bone();
  neck.name = "neck";
  const head = new THREE.Bone();
  head.name = "head";
  mesh.add(neck);
  neck.add(head);
  runtime.captureBones(mesh);

  const presentation = getStagePresentationConfig("mio-reference");
  presentation.faceDetails.chinLine.enabled = true;
  runtime.attachFaceDetails(mesh, presentation);

  assert.equal(runtime.faceDetailObjects.length, 1);
  assert.equal(runtime.faceDetailObjects[0].name, "mio-reference__chin-line");
  assert.equal(runtime.faceDetailObjects[0].parent, head);
  assert.equal(runtime.faceDetailMaterials.length, 1);
  assert.equal(runtime.faceDetailMaterials[0].transparent, true);
  assert.equal(runtime.faceDetailMaterials[0].opacity, 0.38);

  runtime.disposeFaceDetails();

  assert.equal(runtime.faceDetailObjects.length, 0);
  assert.equal(runtime.faceDetailMaterials.length, 0);
  assert.equal(head.children.length, 0);
});

test("setupBackdrop stays disabled for classic and genshin once genshin follows project2 staging", () => {
  const classicAdds = [];
  const classicRuntime = makeRuntime({
    scene: { add(node) { classicAdds.push(node); }, remove() {} },
  });
  classicRuntime.setupBackdrop(getStagePresentationConfig("classic"));
  assert.equal(classicRuntime.backdropGroup, null);
  assert.deepEqual(classicAdds, []);

  const genshinAdds = [];
  const genshinRuntime = makeRuntime({
    scene: { add(node) { genshinAdds.push(node); }, remove() {} },
  });
  genshinRuntime.setupBackdrop(getStagePresentationConfig("genshin"));
  assert.equal(genshinRuntime.backdropGroup, null);
  assert.deepEqual(genshinAdds, []);
});

test("setupBackdrop stays disabled for mio-reference while the design bitmap remains the visual base", () => {
  const adds = [];
  const runtime = makeRuntime({
    renderPipeline: "mio-reference",
    scene: { add(node) { adds.push(node); }, remove() {} },
  });

  runtime.setupBackdrop(getStagePresentationConfig("mio-reference"));

  assert.equal(runtime.backdropGroup, null);
  assert.deepEqual(adds, []);
});

test("setupFloor keeps genshin to a plain shadow catcher without decorative stage layers", () => {
  withStubbedDocument(() => {
    const adds = [];
    const runtime = makeRuntime({
      scene: { add(node) { adds.push(node); }, remove() {} },
    });

    runtime.setupFloor(getStagePresentationConfig("genshin"));

    assert.equal(adds.length, 1);
    assert.ok(runtime.floorGroup);
    assert.equal(runtime.floorGroup.children.length, 1);
    assert.deepEqual(runtime.floorTextures, []);
  });
});

test("setupFloor keeps mio-reference to shadow catching plus contact grounding only", () => {
  withStubbedDocument(() => {
    const adds = [];
    const runtime = makeRuntime({
      renderPipeline: "mio-reference",
      scene: { add(node) { adds.push(node); }, remove() {} },
    });

    runtime.setupFloor(getStagePresentationConfig("mio-reference"));

    assert.equal(adds.length, 1);
    assert.ok(runtime.floorGroup);
    assert.equal(runtime.floorGroup.children.length, 2);
    assert.equal(runtime.floorTextures.length, 1);
  });
});

test("setupFloor keeps reze-design on the MIO-compatible shadow and contact grounding base", () => {
  withStubbedDocument(() => {
    const adds = [];
    const runtime = makeRuntime({
      renderPipeline: "reze-design",
      scene: { add(node) { adds.push(node); }, remove() {} },
    });

    runtime.setupFloor(getStagePresentationConfig("reze-design"));

    assert.equal(adds.length, 1);
    assert.ok(runtime.floorGroup);
    assert.equal(runtime.floorGroup.children.length, 2);
    assert.equal(runtime.floorTextures.length, 1);
  });
});

test("renderScene uses direct renderer for both classic and project2-style genshin", () => {
  const classicCalls = [];
  const classicRuntime = makeRuntime({
    presentation: getStagePresentationConfig("classic"),
    renderer: {
      render() {
        classicCalls.push("renderer");
      },
    },
    composer: {
      render() {
        classicCalls.push("composer");
      },
    },
  });
  classicRuntime.renderScene();
  assert.deepEqual(classicCalls, ["renderer"]);

  const genshinCalls = [];
  const genshinPresentation = getStagePresentationConfig("genshin");
  const genshinRuntime = makeRuntime({
    presentation: genshinPresentation,
    renderer: {
      render() {
        genshinCalls.push("renderer");
      },
    },
    composer: {
      render() {
        genshinCalls.push("composer");
      },
    },
  });
  genshinRuntime.renderScene();
  assert.deepEqual(genshinCalls, ["renderer"]);
});

test("stage presentation config returns fresh objects on every call", () => {
  const first = getStagePresentationConfig("classic");
  first.camera.position[0] = 999;
  first.lights.key.position[1] = 999;
  first.floor.opacity = 0.99;

  const second = getStagePresentationConfig("classic");
  const fallback = getStagePresentationConfig("unknown");

  assert.notStrictEqual(first, second);
  assert.notStrictEqual(second, fallback);
  assert.deepEqual(second.camera.position, [0, 9.2, 21.6]);
  assert.deepEqual(second.lights.key.position, [-14, 20, 28]);
  assert.equal(second.floor.opacity, 0.2);
  assert.deepEqual(fallback, second);
});

test("stage runtime state applies current speaking and procedural interaction to recreated runtimes", () => {
  const calls = [];
  const interaction = { emotion: "happy", action: "nod", mode: "procedural" };
  const runtime = {
    setSpeaking(value) {
      calls.push(["speaking", value]);
    },
    applyInteraction(value) {
      calls.push(["interaction", value]);
    },
    playVmd(value) {
      calls.push(["vmd", value]);
    },
  };

  applyStageRuntimeState(runtime, {
    speaking: true,
    interaction,
    resolveUrl: (url) => `abs:${url}`,
  });

  assert.deepEqual(calls, [
    ["speaking", true],
    ["interaction", interaction],
  ]);
});

test("stage runtime state reapplies current VMD interaction to recreated runtimes", () => {
  const calls = [];
  const interaction = {
    emotion: "happy",
    action: "idle",
    mode: "vmd",
    vmdUrl: "/motions/wave.vmd",
    playbackRate: 1.5,
    vmdLoopUrls: ["/motions/idle-a.vmd", "/motions/idle-b.vmd", "/motions/idle-c.vmd"],
    standbyVmdUrl: "/motions/standby.vmd",
    loopGapMs: 240,
    loopMode: "sequential",
  };
  const runtime = {
    setSpeaking(value) {
      calls.push(["speaking", value]);
    },
    applyInteraction(value) {
      calls.push(["interaction", value]);
    },
    playVmd(value, playbackRate, vmdLoopUrls, loopOptions) {
      calls.push(["vmd", value, playbackRate, vmdLoopUrls, loopOptions]);
    },
  };

  applyStageRuntimeState(runtime, {
    speaking: false,
    interaction,
    resolveUrl: (url) => `abs:${url}`,
  });

  assert.deepEqual(calls, [
    ["speaking", false],
    ["interaction", interaction],
    [
      "vmd",
      "abs:/motions/wave.vmd",
      1.5,
      ["abs:/motions/idle-a.vmd", "abs:/motions/idle-b.vmd", "abs:/motions/idle-c.vmd"],
      {
        standbyUrl: "abs:/motions/standby.vmd",
        loopGapMs: 240,
        loopMode: "sequential",
      },
    ],
  ]);
});

test("pickNextLoopMotionUrl avoids immediately repeating the active loop motion", () => {
  const urls = ["/motions/idle-a.vmd", "/motions/idle-b.vmd", "/motions/idle-c.vmd"];

  assert.equal(pickNextLoopMotionUrl(urls, "/motions/idle-a.vmd", 0), "/motions/idle-b.vmd");
  assert.equal(pickNextLoopMotionUrl(urls, "/motions/idle-b.vmd", 0.99), "/motions/idle-c.vmd");
  assert.equal(pickNextLoopMotionUrl(["/motions/idle-a.vmd"], "/motions/idle-a.vmd", 0.4), "/motions/idle-a.vmd");
});

test("pickSequentialLoopMotionUrl advances in order and wraps around", () => {
  const urls = ["/motions/idle-a.vmd", "/motions/idle-b.vmd", "/motions/idle-c.vmd"];

  assert.equal(pickSequentialLoopMotionUrl(urls, ""), "/motions/idle-a.vmd");
  assert.equal(pickSequentialLoopMotionUrl(urls, "/motions/idle-a.vmd"), "/motions/idle-b.vmd");
  assert.equal(pickSequentialLoopMotionUrl(urls, "/motions/idle-c.vmd"), "/motions/idle-a.vmd");
});

test("shouldUsePostFX follows the active presentation config", () => {
  const classicRuntime = makeRuntime({ presentation: getStagePresentationConfig("classic") });
  const genshinRuntime = makeRuntime({ presentation: getStagePresentationConfig("genshin") });

  assert.equal(classicRuntime.shouldUsePostFX(), false);
  assert.equal(genshinRuntime.shouldUsePostFX(), false);
});

test("transparent stages disable bloom so their canvas alpha remains available to the CSS background", () => {
  const runtime = makeRuntime({ presentation: getStagePresentationConfig("genshin") });
  const genshinPresentation = getStagePresentationConfig("genshin");
  const rezeNprPresentation = getStagePresentationConfig("reze-npr");
  const rezeDesignPresentation = getStagePresentationConfig("reze-design");

  assert.equal(runtime.shouldUseBloom(genshinPresentation), false);
  assert.equal(runtime.shouldUseBloom(getStagePresentationConfig("classic")), false);
  assert.equal(runtime.shouldUseBloom(rezeNprPresentation), false);
  assert.equal(runtime.shouldUseBloom(rezeDesignPresentation), false);
});

test("loadModel keeps genshin base skeleton capture aligned with classic integration semantics", async () => {
  const classicAsset = createProject2PoseMesh();
  const genshinAsset = createProject2PoseMesh();

  const classicRuntime = makeRuntime({
    renderPipeline: "classic",
    presentation: getStagePresentationConfig("classic"),
    toonRampTexture: { id: "classic-ramp" },
  });
  classicRuntime.loader = {
    load(_url, onLoad) {
      onLoad(classicAsset.mesh);
    },
  };

  const genshinRuntime = makeRuntime({
    renderPipeline: "genshin",
    presentation: getStagePresentationConfig("genshin"),
    toonRampTexture: { id: "genshin-ramp" },
  });
  genshinRuntime.loader = {
    load(_url, onLoad) {
      onLoad(genshinAsset.mesh);
    },
  };

  await classicRuntime.loadModel("/classic-pose-model.pmx");
  await genshinRuntime.loadModel("/genshin-pose-model.pmx");

  assert.equal(classicAsset.bones.leftArm.rotation.z, 0);
  assert.equal(classicAsset.bones.rightArm.rotation.z, 0);
  assert.equal(classicRuntime.baseBoneRotation.leftArm.z, 0);
  assert.equal(classicRuntime.baseBoneRotation.rightArm.z, 0);

  assert.equal(genshinAsset.bones.hip.rotation.z, 0);
  assert.equal(genshinAsset.bones.chest.rotation.z, 0);
  assert.equal(genshinAsset.bones.leftLeg.rotation.z, 0);
  assert.equal(genshinAsset.bones.leftLeg.rotation.y, 0);
  assert.equal(genshinAsset.bones.leftKnee.rotation.x, 0);
  assert.equal(genshinAsset.bones.leftArm.rotation.z, 0);
  assert.equal(genshinAsset.bones.rightArm.rotation.z, 0);
  assert.equal(genshinRuntime.baseBoneRotation.leftArm.z, 0);
  assert.equal(genshinRuntime.baseBoneRotation.rightArm.z, 0);
  assert.ok(genshinRuntime.baseBoneTransformMap.get(genshinAsset.bones.leftKnee).quaternion.angleTo(genshinAsset.bones.leftKnee.quaternion) < 1e-9);
});

test("renderFrame accelerates active VMD clips without applying procedural pose updates", async () => {
  const helperDeltas = [];
  const poseDeltas = [];
  const morphCalls = [];
  const resetCalls = [];
  const model = { isSkinnedMesh: true };
  const runtime = makeRuntime({
    model,
    clock: { getDelta: () => 0.25 },
    helper: {
      remove() {},
      add() {},
      update(delta) {
        helperDeltas.push(delta);
      },
    },
    controls: { update() {} },
    renderer: { render() {} },
    loader: {
      loadAnimation(_url, _model, onLoad) {
        onLoad({ name: "motion-clip" });
      },
    },
    resetToBasePose() {
      resetCalls.push("reset");
    },
    updateBonePose(delta) {
      poseDeltas.push(delta);
    },
    updateMorph() {
      morphCalls.push("morph");
    },
    renderScene() {},
  });

  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;

  try {
    await runtime.playVmd("/motions/test.vmd", 1.5);
    runtime.renderFrame();
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }

  assert.deepEqual(helperDeltas, [0.375]);
  assert.deepEqual(poseDeltas, [0.25]);
  assert.deepEqual(morphCalls, ["morph"]);
  assert.deepEqual(resetCalls, ["reset"]);
});

test("seekVmdFrame pins the current VMD action to an exact frame", () => {
  const calls = [];
  const model = {
    updateMatrixWorld(force) {
      calls.push(["model", "updateMatrixWorld", force]);
    },
  };
  const clip = { name: "axis-calibration", duration: 4 };
  const action = {
    enabled: false,
    paused: false,
    time: 0,
    play() {
      calls.push(["action", "play"]);
      return this;
    },
  };
  const mixer = {
    setTime(value) {
      calls.push(["mixer", "setTime", value, { actionPaused: action.paused }]);
    },
  };
  const runtime = makeRuntime({
    model,
    currentClip: clip,
    currentVmdAction: action,
    helper: {
      objects: {
        get(target) {
          if (target === model) return { mixer };
          return null;
        },
      },
      update(delta) {
        calls.push(["helper", "update", delta]);
      },
    },
    renderScene() {
      calls.push(["runtime", "renderScene"]);
    },
  });

  assert.equal(runtime.seekVmdFrame(45, 30), true);
  assert.equal(action.enabled, true);
  assert.equal(action.paused, true);
  assert.equal(action.time, 1.5);
  assert.deepEqual(calls, [
    ["action", "play"],
    ["mixer", "setTime", 1.5, { actionPaused: false }],
    ["helper", "update", 0],
    ["model", "updateMatrixWorld", true],
    ["runtime", "renderScene"],
  ]);
});

test("seekVmdFrame samples VMD bone tracks directly in calibration mode", () => {
  const bone = {
    name: "Arm",
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1),
  };
  const targetQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0));
  const clip = {
    tracks: [
      new THREE.QuaternionKeyframeTrack(".bones[Arm].quaternion", [0, 1], [
        0,
        0,
        0,
        1,
        targetQuaternion.x,
        targetQuaternion.y,
        targetQuaternion.z,
        targetQuaternion.w,
      ]),
    ],
  };
  const runtime = makeRuntime({
    calibrationCaptureMode: true,
    model: {
      skeleton: { bones: [bone] },
      updateMatrixWorld() {},
    },
    currentClip: clip,
    currentVmdAction: {
      enabled: false,
      paused: false,
      time: 0,
      play() {
        return this;
      },
    },
    helper: {
      objects: {
        get() {
          return { mixer: { setTime() {} } };
        },
      },
      update() {},
    },
  });

  assert.equal(runtime.seekVmdFrame(30, 30), true);
  assert.ok(Math.abs(bone.quaternion.y - targetQuaternion.y) < 0.00001);
  assert.ok(Math.abs(bone.quaternion.w - targetQuaternion.w) < 0.00001);
});

test("calibration capture mode freezes VMD playback without procedural overlays", () => {
  const calls = [];
  const runtime = makeRuntime({
    currentClip: { name: "axis-calibration", duration: 2 },
    currentVmdPlaybackRate: 1.25,
    clock: { getDelta: () => 0.2 },
    helper: {
      update(delta) {
        calls.push(["helper", delta]);
      },
    },
    controls: { update() { calls.push(["controls"]); } },
    updateVmdLoop() {
      calls.push(["loop"]);
    },
    updateBonePose() {
      calls.push(["pose"]);
    },
    updateMorph() {
      calls.push(["morph"]);
    },
    renderScene() {
      calls.push(["render"]);
    },
  });
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;

  try {
    runtime.setCalibrationCaptureMode(true);
    runtime.renderFrame();
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }

  assert.deepEqual(calls, [["controls"], ["render"]]);
});

test("playVmd crossfades into the next VMD when mixer actions are available", async () => {
  const helperCalls = [];
  const actionCalls = [];
  const existingClip = { name: "existing-clip", duration: 1 };
  const replacementClip = { name: "standby-clip", duration: 1 };
  const existingAction = {
    stopFading() {
      actionCalls.push(["existing", "stopFading"]);
      return this;
    },
    stopWarping() {
      actionCalls.push(["existing", "stopWarping"]);
      return this;
    },
  };
  const nextAction = {
    reset() {
      actionCalls.push(["next", "reset"]);
      return this;
    },
    stopFading() {
      actionCalls.push(["next", "stopFading"]);
      return this;
    },
    stopWarping() {
      actionCalls.push(["next", "stopWarping"]);
      return this;
    },
    setEffectiveTimeScale(value) {
      actionCalls.push(["next", "timeScale", value]);
      return this;
    },
    setEffectiveWeight(value) {
      actionCalls.push(["next", "weight", value]);
      return this;
    },
    play() {
      actionCalls.push(["next", "play"]);
      return this;
    },
    crossFadeFrom(action, duration, warp) {
      actionCalls.push(["next", "crossFadeFrom", action, duration, warp]);
      return this;
    },
  };
  const mixer = {
    existingAction(clip) {
      if (clip === existingClip) return existingAction;
      return null;
    },
    clipAction(clip) {
      actionCalls.push(["mixer", "clipAction", clip]);
      return clip === replacementClip ? nextAction : null;
    },
  };
  const model = { isSkinnedMesh: true };
  const runtime = makeRuntime({
    model,
    currentClip: existingClip,
    helper: {
      objects: {
        get(target) {
          if (target === model) return { mixer };
          return null;
        },
      },
      remove(target) {
        helperCalls.push(["remove", target]);
      },
      add(target, options) {
        helperCalls.push(["add", target, Boolean(options?.animation), Boolean(options?.physics)]);
      },
      update() {},
    },
    loader: {
      loadAnimation(_url, _model, onLoad) {
        onLoad(replacementClip);
      },
    },
    renderScene() {},
  });

  await runtime.playVmd("/motions/standby.vmd", 1, ["/motions/loop-a.vmd"], {
    standbyUrl: "/motions/standby.vmd",
    resumePhase: "standby",
  });

  assert.deepEqual(helperCalls, []);
  assert.deepEqual(actionCalls, [
    ["mixer", "clipAction", replacementClip],
    ["next", "reset"],
    ["next", "stopFading"],
    ["next", "stopWarping"],
    ["next", "timeScale", 1],
    ["next", "weight", 1],
    ["next", "play"],
    ["existing", "stopFading"],
    ["existing", "stopWarping"],
    ["next", "crossFadeFrom", existingAction, 0.5, false],
  ]);
  assert.equal(runtime.currentClip, replacementClip);
  assert.equal(runtime.currentVmdAction, nextAction);
  assert.equal(runtime.pendingVmdActionCleanups.length, 1);
  assert.equal(runtime.pendingVmdActionCleanups[0].clip, existingClip);
  assert.equal(runtime.pendingVmdActionCleanups[0].action, existingAction);
});

test("playVmd crossfades when leaving standby for the next loop motion", async () => {
  const helperCalls = [];
  const actionCalls = [];
  const standbyClip = { name: "standby-clip", duration: 1 };
  const nextLoopClip = { name: "loop-clip", duration: 1 };
  const standbyAction = {
    stopFading() {
      actionCalls.push(["standby", "stopFading"]);
      return this;
    },
    stopWarping() {
      actionCalls.push(["standby", "stopWarping"]);
      return this;
    },
  };
  const mixer = {
    existingAction(clip) {
      if (clip === standbyClip) return standbyAction;
      return null;
    },
    clipAction(clip) {
      actionCalls.push(["mixer", "clipAction", clip]);
      return clip === nextLoopClip ? nextAction : null;
    },
  };
  const nextAction = {
    reset() {
      actionCalls.push(["next", "reset"]);
      return this;
    },
    stopFading() {
      actionCalls.push(["next", "stopFading"]);
      return this;
    },
    stopWarping() {
      actionCalls.push(["next", "stopWarping"]);
      return this;
    },
    setEffectiveTimeScale(value) {
      actionCalls.push(["next", "timeScale", value]);
      return this;
    },
    setEffectiveWeight(value) {
      actionCalls.push(["next", "weight", value]);
      return this;
    },
    play() {
      actionCalls.push(["next", "play"]);
      return this;
    },
    crossFadeFrom(action, duration, warp) {
      actionCalls.push(["next", "crossFadeFrom", action, duration, warp]);
      return this;
    },
  };
  const model = { isSkinnedMesh: true };
  const runtime = makeRuntime({
    model,
    currentClip: standbyClip,
    currentVmdLoopPhase: "standby",
    currentVmdAction: standbyAction,
    helper: {
      objects: {
        get(target) {
          if (target === model) return { mixer };
          return null;
        },
      },
      remove(target) {
        helperCalls.push(["remove", target]);
      },
      add(target, options) {
        helperCalls.push(["add", target, Boolean(options?.animation), Boolean(options?.physics)]);
      },
      update() {},
    },
    loader: {
      loadAnimation(_url, _model, onLoad) {
        onLoad(nextLoopClip);
      },
    },
    renderScene() {},
  });

  await runtime.playVmd("/motions/loop-b.vmd", 1, ["/motions/loop-a.vmd", "/motions/loop-b.vmd"], {
    standbyUrl: "/motions/standby.vmd",
    resumePhase: "loop",
  });

  assert.deepEqual(actionCalls, [
    ["mixer", "clipAction", nextLoopClip],
    ["next", "reset"],
    ["next", "stopFading"],
    ["next", "stopWarping"],
    ["next", "timeScale", 1],
    ["next", "weight", 1],
    ["next", "play"],
    ["standby", "stopFading"],
    ["standby", "stopWarping"],
    ["next", "crossFadeFrom", standbyAction, 0.5, false],
  ]);
  assert.deepEqual(helperCalls, []);
  assert.equal(runtime.currentClip, nextLoopClip);
});

test("playVmd resets to the base pose before helper-swapping to a replacement VMD clip", async () => {
  const resetCalls = [];
  const helperCalls = [];
  const model = { isSkinnedMesh: true };
  const runtime = makeRuntime({
    model,
    currentClip: { name: "existing-clip", duration: 1 },
    helper: {
      remove(target) {
        helperCalls.push(["remove", target]);
      },
      add(target, options) {
        helperCalls.push(["add", target, Boolean(options?.animation), Boolean(options?.physics)]);
      },
      update() {},
    },
    loader: {
      loadAnimation(_url, _model, onLoad) {
        onLoad({ name: "replacement-clip", duration: 1 });
      },
    },
    resetToBasePose() {
      resetCalls.push("reset");
    },
    renderScene() {},
  });

  await runtime.playVmd("/motions/replacement.vmd", 1);

  assert.deepEqual(resetCalls, ["reset"]);
  assert.deepEqual(helperCalls, [
    ["remove", model],
    ["add", model, true, false],
  ]);
  assert.equal(runtime.currentClip?.name, "replacement-clip");
});

test("playVmd reports failure when a requested VMD cannot be loaded", async () => {
  const statuses = [];
  const runtime = makeRuntime({
    model: { isSkinnedMesh: true },
    loader: {
      loadAnimation(_url, _model, _onLoad, _onProgress, onError) {
        onError(new Error("bad motion"));
      },
    },
    setStatus(message) {
      statuses.push(message);
    },
    renderScene() {},
  });

  const originalConsoleWarn = console.warn;
  console.warn = () => {};
  let result;
  try {
    result = await runtime.playVmd("/motions/broken.vmd", 1);
  } finally {
    console.warn = originalConsoleWarn;
  }

  assert.equal(result, false);
  assert.equal(runtime.isLoadingVmd, false);
  assert.deepEqual(statuses, ["VMD playback failed, fallback to procedural."]);
});

test("playVmd skips crossfade when loop options disable it", async () => {
  const resetCalls = [];
  const helperCalls = [];
  const actionCalls = [];
  const previousAction = {
    stopFading() {
      actionCalls.push(["previous", "stopFading"]);
      return this;
    },
    stopWarping() {
      actionCalls.push(["previous", "stopWarping"]);
      return this;
    },
  };
  const model = { isSkinnedMesh: true };
  const runtime = makeRuntime({
    model,
    currentClip: { name: "existing-clip", duration: 1 },
    currentVmdAction: previousAction,
    helper: {
      objects: {
        get(target) {
          if (target === model) {
            return {
              mixer: {
                existingAction() {
                  return previousAction;
                },
              },
            };
          }
          return null;
        },
      },
      remove(target) {
        helperCalls.push(["remove", target]);
      },
      add(target, options) {
        helperCalls.push(["add", target, Boolean(options?.animation), Boolean(options?.physics)]);
      },
      update() {},
    },
    loader: {
      loadAnimation(_url, _model, onLoad) {
        onLoad({ name: "replacement-clip", duration: 1 });
      },
    },
    resetToBasePose() {
      resetCalls.push("reset");
    },
    renderScene() {},
  });

  await runtime.playVmd("/motions/replacement.vmd", 1, [], { disableCrossfade: true });

  assert.deepEqual(resetCalls, ["reset"]);
  assert.deepEqual(helperCalls, [
    ["remove", model],
    ["add", model, true, false],
  ]);
  assert.equal(runtime.currentClip?.name, "replacement-clip");
});

test("breathing offsets do not accumulate on bones that the active VMD clip does not animate", () => {
  const upperBody = { name: "\u4e0a\u534a\u8eab", rotation: new THREE.Euler(0, 0, 0) };
  const runtime = makeRuntime({
    bones: { upperBody },
    baseBoneRotation: { upperBody: new THREE.Euler(0, 0, 0) },
    currentClip: { tracks: [{ name: ".bones[\u982d].quaternion" }] },
  });

  runtime.updateBonePose(1 / 60, 0);
  const firstX = upperBody.rotation.x;
  runtime.updateBonePose(1 / 60, 0);

  assert.equal(clipAnimatesBone(runtime.currentClip, upperBody), false);
  assert.ok(Math.abs(firstX - -0.0736) < 0.00001);
  assert.ok(Math.abs(upperBody.rotation.x - firstX) < 0.00001);
});

test("breathing offsets remain additive for bones animated by the active VMD clip", () => {
  const upperBody = { name: "\u4e0a\u534a\u8eab", rotation: new THREE.Euler(0.2, 0, 0) };
  const runtime = makeRuntime({
    bones: { upperBody },
    baseBoneRotation: { upperBody: new THREE.Euler(0, 0, 0) },
    currentClip: { tracks: [{ name: ".bones[\u4e0a\u534a\u8eab].quaternion" }] },
  });

  runtime.updateBonePose(1 / 60, 0);

  assert.equal(clipAnimatesBone(runtime.currentClip, upperBody), true);
  assert.ok(Math.abs(upperBody.rotation.x - 0.1264) < 0.00001);
});

test("VMD transitions reset bones not animated by the next clip", () => {
  const leg = {
    name: "\u53f3\u8db3\uff29\uff2b",
    position: new THREE.Vector3(0, 2, 0),
    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.8, 0, 0)),
    scale: new THREE.Vector3(1, 1, 1),
  };
  const baseQuaternion = new THREE.Quaternion();

  resetBonesNotAnimatedByClip(
    [
      {
        bone: leg,
        position: new THREE.Vector3(0, 0, 0),
        quaternion: baseQuaternion.clone(),
        scale: new THREE.Vector3(1, 1, 1),
      },
    ],
    { tracks: [{ name: ".bones[\u4e0a\u534a\u8eab].quaternion" }] },
  );

  assert.deepEqual(leg.position.toArray(), [0, 0, 0]);
  assert.ok(Math.abs(leg.quaternion.x - baseQuaternion.x) < 0.00001);
});

test("companion loop lower-body lock restores leg bones even when the VMD animates them", () => {
  const legIk = {
    name: "\u53f3\u8db3\uff29\uff2b",
    position: new THREE.Vector3(0, 2, 0),
    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.8, 0, 0)),
    scale: new THREE.Vector3(1, 1, 1),
  };
  const arm = {
    name: "\u53f3\u8155",
    position: new THREE.Vector3(1, 0, 0),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1),
  };

  resetLowerBodyBonesToBase([
    {
      bone: legIk,
      position: new THREE.Vector3(0, 0, 0),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(1, 1, 1),
    },
    {
      bone: arm,
      position: new THREE.Vector3(0, 0, 0),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(1, 1, 1),
    },
  ]);

  assert.deepEqual(legIk.position.toArray(), [0, 0, 0]);
  assert.deepEqual(arm.position.toArray(), [1, 0, 0]);
});

test("lower-body detection covers IK parents and waist chain bones", () => {
  assert.equal(isLowerBodyBoneName("右足IK親"), true);
  assert.equal(isLowerBodyBoneName("腰"), true);
  assert.equal(isLowerBodyBoneName("pelvis"), true);
  assert.equal(isLowerBodyBoneName("右腕"), false);
});

test("updateVmdLoop starts another built-in idle motion after the current clip duration elapses", () => {
  const playCalls = [];
  const runtime = makeRuntime({
    currentClip: { name: "motion-clip", duration: 1.2 },
    currentVmdPlaybackRate: 1.5,
    currentVmdLoopUrls: ["/motions/idle-a.vmd", "/motions/idle-b.vmd", "/motions/idle-c.vmd"],
    currentVmdUrl: "/motions/idle-a.vmd",
    currentVmdStartedAt: 1000,
    currentVmdDurationMs: 750,
    isLoadingVmd: false,
    playVmd(url, playbackRate, loopUrls, loopOptions) {
      playCalls.push([url, playbackRate, loopUrls, loopOptions]);
    },
  });

  const originalMathRandom = Math.random;
  Math.random = () => 0;

  try {
    runtime.updateVmdLoop(1800);
  } finally {
    Math.random = originalMathRandom;
  }

  assert.deepEqual(playCalls, [[
    "/motions/idle-b.vmd",
    1.5,
    ["/motions/idle-a.vmd", "/motions/idle-b.vmd", "/motions/idle-c.vmd"],
    {
      standbyUrl: "",
      loopGapMs: 0,
      loopMode: "random",
      resumePhase: "loop",
    },
  ]]);
});

test("updateVmdLoop starts loading the next loop before the current clip fully ends", () => {
  const playCalls = [];
  const runtime = makeRuntime({
    currentClip: { name: "motion-clip", duration: 1.2 },
    currentVmdPlaybackRate: 1.5,
    currentVmdLoopUrls: ["/motions/idle-a.vmd", "/motions/idle-b.vmd"],
    currentVmdUrl: "/motions/idle-a.vmd",
    currentVmdStartedAt: 1000,
    currentVmdDurationMs: 750,
    isLoadingVmd: false,
    playVmd(url) {
      playCalls.push(url);
    },
  });

  runtime.updateVmdLoop(1249);
  runtime.updateVmdLoop(1250);

  assert.deepEqual(playCalls, ["/motions/idle-b.vmd"]);
});

test("updateVmdLoop waits for loopGapMs before transitioning to the next loop motion", () => {
  const playCalls = [];
  const runtime = makeRuntime({
    currentClip: { name: "motion-clip", duration: 1.2 },
    currentVmdPlaybackRate: 1.5,
    currentVmdLoopUrls: ["/motions/idle-a.vmd", "/motions/idle-b.vmd"],
    currentVmdLoopGapMs: 200,
    currentVmdUrl: "/motions/idle-a.vmd",
    currentVmdStartedAt: 1000,
    currentVmdDurationMs: 750,
    isLoadingVmd: false,
    playVmd(url) {
      playCalls.push(url);
    },
  });

  runtime.updateVmdLoop(1900);
  runtime.updateVmdLoop(2000);

  assert.deepEqual(playCalls, ["/motions/idle-b.vmd"]);
});

test("updateVmdLoop transitions from a loop motion into standby before resuming favorites", () => {
  const playCalls = [];
  const runtime = makeRuntime({
    currentClip: { name: "motion-clip", duration: 1.2 },
    currentVmdPlaybackRate: 1.5,
    currentVmdLoopUrls: ["/motions/idle-a.vmd", "/motions/idle-b.vmd"],
    currentVmdStandbyUrl: "/motions/standby.vmd",
    currentVmdLoopMode: "random",
    currentVmdLoopPhase: "loop",
    currentVmdUrl: "/motions/idle-a.vmd",
    lastPlayedLoopMotionUrl: "/motions/idle-a.vmd",
    currentVmdStartedAt: 1000,
    currentVmdDurationMs: 750,
    isLoadingVmd: false,
    playVmd(url, playbackRate, loopUrls, loopOptions) {
      playCalls.push([url, playbackRate, loopUrls, loopOptions]);
    },
  });

  runtime.updateVmdLoop(1800);

  assert.deepEqual(playCalls, [[
    "/motions/standby.vmd",
    1.5,
    ["/motions/idle-a.vmd", "/motions/idle-b.vmd"],
    {
      standbyUrl: "/motions/standby.vmd",
      loopGapMs: 0,
      loopMode: "random",
      resumePhase: "standby",
    },
  ]]);
});

test("updateVmdLoop replays standby when only a standby favorite exists", () => {
  const playCalls = [];
  const runtime = makeRuntime({
    currentClip: { name: "motion-clip", duration: 1.2 },
    currentVmdPlaybackRate: 1.5,
    currentVmdLoopUrls: [],
    currentVmdStandbyUrl: "/motions/standby.vmd",
    currentVmdLoopMode: "random",
    currentVmdLoopPhase: "standby-only",
    currentVmdUrl: "/motions/standby.vmd",
    currentVmdStartedAt: 1000,
    currentVmdDurationMs: 750,
    isLoadingVmd: false,
    playVmd(url, playbackRate, loopUrls, loopOptions) {
      playCalls.push([url, playbackRate, loopUrls, loopOptions]);
    },
  });

  runtime.updateVmdLoop(1800);

  assert.deepEqual(playCalls, [[
    "/motions/standby.vmd",
    1.5,
    [],
    {
      standbyUrl: "/motions/standby.vmd",
      loopGapMs: 0,
      loopMode: "random",
      resumePhase: "standby-only",
    },
  ]]);
});

test("updateVmdLoop uses the last played loop motion as the sequential anchor after standby", () => {
  const playCalls = [];
  const runtime = makeRuntime({
    currentClip: { name: "motion-clip", duration: 1.2 },
    currentVmdPlaybackRate: 1.5,
    currentVmdLoopUrls: ["/motions/idle-a.vmd", "/motions/idle-b.vmd", "/motions/idle-c.vmd"],
    currentVmdStandbyUrl: "/motions/standby.vmd",
    currentVmdLoopMode: "sequential",
    currentVmdLoopPhase: "standby",
    currentVmdUrl: "/motions/standby.vmd",
    lastPlayedLoopMotionUrl: "/motions/idle-b.vmd",
    currentVmdStartedAt: 1000,
    currentVmdDurationMs: 750,
    isLoadingVmd: false,
    playVmd(url, playbackRate, loopUrls, loopOptions) {
      playCalls.push([url, playbackRate, loopUrls, loopOptions]);
    },
  });

  runtime.updateVmdLoop(1800);

  assert.deepEqual(playCalls, [[
    "/motions/idle-c.vmd",
    1.5,
    ["/motions/idle-a.vmd", "/motions/idle-b.vmd", "/motions/idle-c.vmd"],
    {
      standbyUrl: "/motions/standby.vmd",
      loopGapMs: 0,
      loopMode: "sequential",
      resumePhase: "loop",
    },
  ]]);
});

test("updateVmdLoop leaves zero-duration standby clips and resumes the next loop motion", () => {
  const playCalls = [];
  const runtime = makeRuntime({
    currentClip: { name: "standby-clip", duration: 0 },
    currentVmdPlaybackRate: 1.5,
    currentVmdLoopUrls: ["/motions/idle-a.vmd", "/motions/idle-b.vmd", "/motions/idle-c.vmd"],
    currentVmdStandbyUrl: "/motions/standby.vmd",
    currentVmdLoopMode: "sequential",
    currentVmdLoopPhase: "standby",
    currentVmdUrl: "/motions/standby.vmd",
    lastPlayedLoopMotionUrl: "/motions/idle-b.vmd",
    currentVmdStartedAt: 1000,
    currentVmdDurationMs: 0,
    isLoadingVmd: false,
    playVmd(url, playbackRate, loopUrls, loopOptions) {
      playCalls.push([url, playbackRate, loopUrls, loopOptions]);
    },
  });

  runtime.updateVmdLoop(1001);

  assert.deepEqual(playCalls, [[
    "/motions/idle-c.vmd",
    1.5,
    ["/motions/idle-a.vmd", "/motions/idle-b.vmd", "/motions/idle-c.vmd"],
    {
      standbyUrl: "/motions/standby.vmd",
      loopGapMs: 0,
      loopMode: "sequential",
      resumePhase: "loop",
    },
  ]]);
});

test("idle pose keeps natural standing bone offsets", () => {
  const runtime = makeRuntime();

  assert.deepEqual(runtime.getOffsetsForAction("idle", 1, 1), {});
  assert.deepEqual(runtime.getActionOffsets(1000), {});
});
