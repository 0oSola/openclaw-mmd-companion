import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRezeVmdIkPolicy,
  inspectRezeVmdIkPolicy,
  playRezeVmd,
  resetRezeModelToBindPose,
  setRezeVmdCompletionHandler,
} from "../src/features/stage/rezeVmdPlayback.js";

const FOOT_IK_NAME_BYTES = {
  "左足ＩＫ": "8db691ab8268826a",
  "左つま先ＩＫ": "8db682c282dc90e68268826a",
  "右足ＩＫ": "894591ab8268826a",
  "右つま先ＩＫ": "894582c282dc90e68268826a",
};

function makeVmdWithIkFrames(frames) {
  const ikFrames = frames.map(({ frame, states }) => {
    const payload = Buffer.alloc(9 + states.length * 21);
    payload.writeUInt32LE(frame, 0);
    payload.writeUInt8(1, 4);
    payload.writeUInt32LE(states.length, 5);
    let offset = 9;
    for (const [name, enabled] of states) {
      const nameBytes = FOOT_IK_NAME_BYTES[name]
        ? Buffer.from(FOOT_IK_NAME_BYTES[name], "hex")
        : Buffer.from(name, "ascii");
      nameBytes.copy(payload, offset);
      offset += 20;
      payload.writeUInt8(enabled ? 1 : 0, offset);
      offset += 1;
    }
    return payload;
  });
  const header = Buffer.alloc(50);
  header.write("Vocaloid Motion Data 0002", 0, "ascii");
  const emptyTables = Buffer.alloc(4 * 5);
  const ikCount = Buffer.alloc(4);
  ikCount.writeUInt32LE(ikFrames.length, 0);
  const result = Buffer.concat([header, emptyTables, ikCount, ...ikFrames]);
  return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
}

test("VMD 明确关闭左右足 IK 时，Reze 播放策略关闭引擎 IK", () => {
  const states = Object.keys(FOOT_IK_NAME_BYTES).map((name) => [name, false]);
  const policy = inspectRezeVmdIkPolicy(makeVmdWithIkFrames([
    { frame: 0, states },
    { frame: 217, states },
  ]));
  const calls = [];

  assert.deepEqual(policy, {
    mode: "disabled",
    engineIkEnabled: false,
    ikFrameCount: 2,
    footIkEntryCount: 8,
  });
  assert.equal(applyRezeVmdIkPolicy({ setIKEnabled: (enabled) => calls.push(enabled) }, policy, true), false);
  assert.deepEqual(calls, [false]);
});

test("VMD 在动作中切换足 IK 时保持 Reze 默认值，避免错误静态化", () => {
  const policy = inspectRezeVmdIkPolicy(makeVmdWithIkFrames([
    { frame: 0, states: [["左足ＩＫ", false], ["右足ＩＫ", false]] },
    { frame: 30, states: [["左足ＩＫ", true], ["右足ＩＫ", true]] },
  ]));
  const calls = [];

  assert.equal(policy.mode, "animated");
  assert.equal(policy.engineIkEnabled, null);
  assert.equal(applyRezeVmdIkPolicy({ setIKEnabled: (enabled) => calls.push(enabled) }, policy, true), true);
  assert.deepEqual(calls, [true]);
});

test("脚 IK 关闭但其他 IK 开启时不关闭 Reze 全局 IK", () => {
  const policy = inspectRezeVmdIkPolicy(makeVmdWithIkFrames([
    {
      frame: 0,
      states: [["左足ＩＫ", false], ["右足ＩＫ", false], ["ArmIK", true]],
    },
  ]));

  assert.equal(policy.mode, "animated");
  assert.equal(policy.engineIkEnabled, null);
  assert.equal(policy.footIkEntryCount, 2);
});

test("局部 VMD 在已有姿势上播放时不调用会重置全部骨骼的 Model.play", () => {
  const calls = [];
  const model = {
    show() {
      calls.push("model.show");
    },
    play() {
      calls.push("model.play");
    },
    animationState: {
      show(name) {
        calls.push(`state.show:${name}`);
      },
      play(name, options) {
        calls.push(`state.play:${name}:${options.loop}`);
        return true;
      },
    },
  };

  const played = playRezeVmd(model, "cheer.vmd", { preserveCurrentPose: true });

  assert.equal(played, true);
  assert.deepEqual(calls, ["state.show:cheer.vmd", "state.play:cheer.vmd:false"]);
});

test("reze VMD 结束事件可转发给舞台状态机", () => {
  let registered;
  const model = {
    animationState: {
      setOnEnd(callback) {
        registered = callback;
      },
    },
  };
  const completed = [];

  assert.equal(setRezeVmdCompletionHandler(model, (name) => completed.push(name)), true);
  registered("cheer.vmd");
  assert.deepEqual(completed, ["cheer.vmd"]);
});

test("单次动作收尾会清掉活动剪辑并复原 PMX 绑定姿势", () => {
  const calls = [];
  const model = {
    animationState: {
      clear() {
        calls.push("animationState.clear");
      },
    },
    resetAllBones() {
      calls.push("resetAllBones");
    },
    resetAllMorphs() {
      calls.push("resetAllMorphs");
    },
  };

  resetRezeModelToBindPose(model);

  assert.deepEqual(calls, ["animationState.clear", "resetAllBones", "resetAllMorphs"]);
});
