import assert from "node:assert/strict";

import {
  buildAutoFavoriteInteraction,
  buildAutoplayResumeInteraction,
  createDefaultFavoriteLoopInteraction,
  createVmdPreviewInteraction,
  resolveVmdPlaybackRate,
} from "../src/features/mapping/vmdPreview.js";

const interaction = createVmdPreviewInteraction({
  asset_id: "asset-1",
  user_id: "u1",
  slot: "happy",
  filename: "wave.vmd",
  size_bytes: 1234,
  created_at: "2026-04-17T10:00:00Z",
  url: "/assets/vmd/file/asset-1",
});

assert.deepEqual(interaction, {
  emotion: "happy",
  action: "idle",
  mode: "vmd",
  vmdUrl: "/assets/vmd/file/asset-1",
  vmdLoopEmotionByUrl: { "/assets/vmd/file/asset-1": "happy" },
  playbackRate: 1,
  lockLowerBody: false,
  lockRootPosition: false,
  bakedBoneAnimation: false,
  disableCrossfade: true,
  sequence: [],
});

assert.equal(resolveVmdPlaybackRate({ filename: "idle_animations_pack/pose.vmd" }), 2.5);
assert.equal(resolveVmdPlaybackRate({ filename: "idle_animations_pack/pose.vmd" }, 0.8), 2);
assert.equal(resolveVmdPlaybackRate({ url: "/assets/mmd/vmd/idle_animations_pack/sample.vmd" }), 2.5);
assert.equal(
  resolveVmdPlaybackRate({
    filename: "Smelling Something in the Air.vmd",
    source_relative_path: "Idle Animations Pack - Copy/Air Scent Idle Animation/Smelling Something in the Air.vmd",
  }),
  2.5,
);
assert.equal(resolveVmdPlaybackRate({ filename: "wave.vmd", url: "/assets/vmd/file/asset-1" }), 1);
assert.equal(resolveVmdPlaybackRate({ filename: "wave.vmd", url: "/assets/vmd/file/asset-1" }, 1.5), 1.5);

assert.deepEqual(
  createDefaultFavoriteLoopInteraction([
    {
      asset_id: "asset-standby",
      slot: "neutral",
      filename: "进场待机.vmd",
      display_name: "进场待机.vmd",
      url: "/assets/vmd/file/asset-standby",
    },
    {
      asset_id: "asset-3",
      slot: "happy",
      filename: "latest.vmd",
      display_name: "latest.vmd",
      url: "/assets/vmd/file/asset-3",
    },
    {
      asset_id: "asset-1",
      slot: "happy",
      filename: "older.vmd",
      display_name: "older.vmd",
      url: "/assets/vmd/file/asset-1",
    },
  ], { randomValue: 0 }),
  {
    emotion: "neutral",
    action: "idle",
    mode: "vmd",
    vmdUrl: "/assets/vmd/file/asset-standby",
    vmdLoopUrls: ["/assets/vmd/file/asset-standby", "/assets/vmd/file/asset-3", "/assets/vmd/file/asset-1"],
    lockLowerBody: false,
    vmdBakedBoneAnimationByUrl: { "/assets/vmd/file/asset-standby": false, "/assets/vmd/file/asset-3": false, "/assets/vmd/file/asset-1": false },
    vmdLoopEmotionByUrl: {
      "/assets/vmd/file/asset-standby": "neutral",
      "/assets/vmd/file/asset-3": "happy",
      "/assets/vmd/file/asset-1": "happy",
    },
    standbyVmdUrl: "",
    loopMode: "random",
    playbackRate: 1,
    sequence: [],
  },
);
assert.deepEqual(
  buildAutoFavoriteInteraction([
    {
      asset_id: "asset-standby",
      slot: "neutral",
      filename: "杩涘満寰呮満.vmd",
      display_name: "杩涘満寰呮満.vmd",
      url: "/assets/vmd/file/asset-standby",
    },
    {
      asset_id: "asset-3",
      slot: "happy",
      filename: "latest.vmd",
      display_name: "latest.vmd",
      url: "/assets/vmd/file/asset-3",
    },
    {
      asset_id: "asset-1",
      slot: "happy",
      filename: "older.vmd",
      display_name: "older.vmd",
      url: "/assets/vmd/file/asset-1",
    },
  ], { randomValue: 0 }),
  {
    emotion: "neutral",
    action: "idle",
    mode: "vmd",
    vmdUrl: "/assets/vmd/file/asset-standby",
    vmdLoopUrls: ["/assets/vmd/file/asset-standby", "/assets/vmd/file/asset-3", "/assets/vmd/file/asset-1"],
    lockLowerBody: false,
    vmdBakedBoneAnimationByUrl: { "/assets/vmd/file/asset-standby": false, "/assets/vmd/file/asset-3": false, "/assets/vmd/file/asset-1": false },
    vmdLoopEmotionByUrl: {
      "/assets/vmd/file/asset-standby": "neutral",
      "/assets/vmd/file/asset-3": "happy",
      "/assets/vmd/file/asset-1": "happy",
    },
    standbyVmdUrl: "",
    loopMode: "random",
    playbackRate: 1,
    sequence: [],
  },
);
assert.deepEqual(
  buildAutoplayResumeInteraction([
    {
      asset_id: "asset-standby",
      slot: "neutral",
      filename: "杩涘満寰呮満.vmd",
      display_name: "杩涘満寰呮満.vmd",
      url: "/assets/vmd/file/asset-standby",
    },
    {
      asset_id: "asset-3",
      slot: "happy",
      filename: "latest.vmd",
      display_name: "latest.vmd",
      url: "/assets/vmd/file/asset-3",
    },
    {
      asset_id: "asset-1",
      slot: "happy",
      filename: "older.vmd",
      display_name: "older.vmd",
      url: "/assets/vmd/file/asset-1",
    },
  ], { randomValue: 0 }),
  {
    emotion: "neutral",
    action: "idle",
    mode: "vmd",
    vmdUrl: "/assets/vmd/file/asset-standby",
    vmdLoopUrls: ["/assets/vmd/file/asset-standby", "/assets/vmd/file/asset-3", "/assets/vmd/file/asset-1"],
    lockLowerBody: false,
    vmdBakedBoneAnimationByUrl: { "/assets/vmd/file/asset-standby": false, "/assets/vmd/file/asset-3": false, "/assets/vmd/file/asset-1": false },
    vmdLoopEmotionByUrl: {
      "/assets/vmd/file/asset-standby": "neutral",
      "/assets/vmd/file/asset-3": "happy",
      "/assets/vmd/file/asset-1": "happy",
    },
    standbyVmdUrl: "",
    loopMode: "random",
    playbackRate: 1,
    sequence: [],
  },
);
assert.equal(
  createDefaultFavoriteLoopInteraction([
    {
      asset_id: "asset-standby-only",
      slot: "neutral",
      filename: "杩涘満寰呮満.vmd",
      display_name: "杩涘満寰呮満.vmd",
      url: "/assets/vmd/file/asset-standby-only",
    },
  ]).vmdUrl,
  "/assets/vmd/file/asset-standby-only",
);
assert.equal(createDefaultFavoriteLoopInteraction([]), null);

console.log("vmd preview checks passed");
