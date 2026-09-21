import test from "node:test";
import assert from "node:assert/strict";

let clickModule;
try {
  clickModule = await import("../src/features/stage/stageCharacterClick.js");
} catch (error) {
  assert.fail(`stage character click helper should be importable: ${error.message}`);
}

const {
  createStageClickRipple,
  resolveStageCharacterClickInteraction,
  shouldTriggerStageCharacterClick,
} = clickModule;

function favoriteAsset(assetId, slot = "happy", category = "") {
  return {
    asset_id: assetId,
    slot,
    filename: `${assetId}.vmd`,
    display_name: `${assetId}.vmd`,
    url: `/assets/vmd/file/${assetId}`,
    is_favorite: true,
    favorite_relative_path: category ? `usage/vmd/Eula[动作]/${category}/${assetId}.vmd` : undefined,
  };
}

test("createStageClickRipple stores the click position relative to the stage", () => {
  assert.deepEqual(
    createStageClickRipple({
      id: "fixed",
      clientX: 125,
      clientY: 260,
      rect: { left: 25, top: 60, width: 400, height: 500 },
    }),
    {
      id: "fixed",
      x: 100,
      y: 200,
      xPercent: 25,
      yPercent: 40,
    },
  );
});

test("createStageClickRipple clamps pointer coordinates into the stage bounds", () => {
  assert.deepEqual(
    createStageClickRipple({
      id: "fixed",
      clientX: -20,
      clientY: 240,
      rect: { left: 20, top: 40, width: 100, height: 100 },
    }),
    {
      id: "fixed",
      x: 0,
      y: 100,
      xPercent: 0,
      yPercent: 100,
    },
  );
});

test("shouldTriggerStageCharacterClick accepts only short stationary clicks", () => {
  assert.equal(
    shouldTriggerStageCharacterClick({
      downClientX: 100,
      downClientY: 120,
      upClientX: 104,
      upClientY: 124,
      downTimeMs: 1000,
      upTimeMs: 1220,
    }),
    true,
  );
});

test("shouldTriggerStageCharacterClick rejects long press and drag gestures", () => {
  assert.equal(
    shouldTriggerStageCharacterClick({
      downClientX: 100,
      downClientY: 120,
      upClientX: 100,
      upClientY: 120,
      downTimeMs: 1000,
      upTimeMs: 1800,
    }),
    false,
  );
  assert.equal(
    shouldTriggerStageCharacterClick({
      downClientX: 100,
      downClientY: 120,
      upClientX: 132,
      upClientY: 120,
      downTimeMs: 1000,
      upTimeMs: 1120,
    }),
    false,
  );
});

test("resolveStageCharacterClickInteraction chooses a single favorite VMD motion", () => {
  const result = resolveStageCharacterClickInteraction({
    assets: [favoriteAsset("wave", "happy"), favoriteAsset("nod", "caring")],
    randomValue: 0.9,
  });

  assert.equal(result.activeVmdAssetId, "nod");
  assert.deepEqual(result.interaction, {
    emotion: "caring",
    action: "click_react",
    mode: "vmd",
    vmdUrl: "/assets/vmd/file/nod",
    vmdLoopUrls: [],
    vmdLoopEmotionByUrl: { "/assets/vmd/file/nod": "caring" },
    standbyVmdUrl: "",
    loopGapMs: 0,
    loopMode: "random",
    lockLowerBody: true,
    disableCrossfade: true,
    playbackRate: 1,
    sequence: [],
  });
});

test("resolveStageCharacterClickInteraction chooses only social soft or strong personality categories when available", () => {
  const idle = favoriteAsset("idle", "neutral", "00_idle_loop");
  const answer = favoriteAsset("answer", "neutral", "04_answering_explain");
  const greet = favoriteAsset("greet", "happy", "02_greeting_social");
  const soft = favoriteAsset("soft", "caring", "05_soft_emotion");
  const strong = favoriteAsset("strong", "happy", "06_strong_personality");

  const result = resolveStageCharacterClickInteraction({
    assets: [idle, answer, greet, soft, strong],
    randomValue: 0.2,
  });

  assert.equal(result.activeVmdAssetId, "greet");
  assert.equal(result.interaction.vmdUrl, greet.url);
});

test("resolveStageCharacterClickInteraction avoids immediately repeating the previous click motion", () => {
  const greet = favoriteAsset("greet", "happy", "02_greeting_social");
  const greetDuplicate = {
    ...favoriteAsset("greet-copy", "happy", "02_greeting_social"),
    filename: "greet (2).vmd",
    display_name: "greet (2).vmd",
  };
  const soft = favoriteAsset("soft", "caring", "05_soft_emotion");

  const result = resolveStageCharacterClickInteraction({
    assets: [greet, greetDuplicate, soft],
    previousActiveVmdAssetId: "greet",
    randomValue: 0,
  });

  assert.equal(result.activeVmdAssetId, "soft");
  assert.equal(result.interaction.vmdUrl, soft.url);
});

test("resolveStageCharacterClickInteraction keeps categorized click VMDs even when lower body motion is present", () => {
  const greet = {
    ...favoriteAsset("greet", "happy", "02_greeting_social"),
    motion_profile: { companion_safe: false },
  };
  const strong = {
    ...favoriteAsset("strong", "happy", "06_strong_personality"),
    motion_profile: { companion_safe: false },
  };

  const result = resolveStageCharacterClickInteraction({
    assets: [greet, strong],
    previousActiveVmdAssetId: "greet",
    randomValue: 0,
  });

  assert.equal(result.activeVmdAssetId, "strong");
  assert.equal(result.interaction.vmdUrl, strong.url);
  assert.equal(result.interaction.lockLowerBody, true);
});

test("resolveStageCharacterClickInteraction plays uncategorized unsafe favorites instead of waving", () => {
  const koleda = {
    asset_id: "c469c832-f623-4039-bf49-a6b2f82510a0",
    slot: "neutral",
    filename: "Koleda_zhuan_shu.vmd",
    display_name: "Koleda_zhuan_shu.vmd",
    url: "/assets/vmd/file/c469c832-f623-4039-bf49-a6b2f82510a0",
    is_favorite: true,
    motion_profile: { companion_safe: false, lower_body_motion_score: 1.322 },
  };

  const result = resolveStageCharacterClickInteraction({
    assets: [koleda],
    randomValue: 0,
  });

  assert.equal(result.activeVmdAssetId, koleda.asset_id);
  assert.equal(result.interaction.action, "click_react");
  assert.equal(result.interaction.mode, "vmd");
  assert.equal(result.interaction.vmdUrl, koleda.url);
  assert.equal(result.interaction.lockLowerBody, true);
});

test("resolveStageCharacterClickInteraction falls back to a procedural wave when no VMD is available", () => {
  const result = resolveStageCharacterClickInteraction({ assets: [] });

  assert.deepEqual(result, {
    activeVmdAssetId: "",
    interaction: {
      emotion: "happy",
      action: "wave",
      mode: "procedural",
      vmdUrl: "",
      vmdLoopUrls: [],
      vmdLoopEmotionByUrl: {},
      standbyVmdUrl: "",
      loopGapMs: 0,
      loopMode: "random",
      playbackRate: 1,
      sequence: [{ template: "greet_wave", action: "wave", durationMs: 1100, intensity: 0.75 }],
    },
  });
});
