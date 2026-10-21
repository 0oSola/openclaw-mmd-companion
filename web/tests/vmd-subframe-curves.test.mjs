import test from "node:test";
import assert from "node:assert/strict";
import { Bone, Skeleton, Quaternion, Vector3 } from "three";
import { MMDLoader } from "three-stdlib";
import { enableVmdSubframeCurves } from "../src/features/stage/vmdSubframeCurves.js";

function clip(name) {
  const bone = new Bone(); bone.name = name;
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2).toArray();
  const interpolation = [...Array(4)].flatMap(() => [...Array(8).fill(20), ...Array(8).fill(107)]);
  return new MMDLoader().animationBuilder.build({
    metadata: { motionCount: 2, morphCount: 2 },
    motions: [0, 1].map((frame) => ({ boneName: name, frameNum: frame, position: [frame, 0, 0], rotation: frame ? rotation : [0, 0, 0, 1], interpolation })),
    morphs: [0, 1].map((frame) => ({ morphName: "test", frameNum: frame, weight: frame })),
  }, { skeleton: new Skeleton([bone]), morphTargetDictionary: { test: 0 } });
}

test("辅助骨连续帧读取位置和旋转曲线，时长不变", () => {
  const animation = clip("E000T");
  const position = animation.tracks.find((track) => track.name.endsWith(".position"));
  assert.ok(position.createInterpolant().evaluate(1 / 60)[0] < 1e-4, "复现原导入器保持上一帧（含其贝塞尔求解误差）");
  const duration = animation.duration;
  assert.equal(enableVmdSubframeCurves(animation), true);
  assert.equal(animation.duration, duration);
  assert.ok(Math.abs(position.createInterpolant().evaluate(1 / 60)[0] - 0.5) < 1e-6);
  const rotation = animation.tracks.find((track) => track.name.endsWith(".quaternion"));
  const q = new Quaternion().fromArray(rotation.createInterpolant().evaluate(1 / 60));
  assert.ok(Math.abs(q.angleTo(new Quaternion()) - Math.PI / 4) < 1e-6);
  const morph = animation.tracks.find((track) => track.name.startsWith(".morph"));
  assert.ok(Math.abs(morph.createInterpolant().evaluate(1 / 60)[0] - 0.5) < 1e-6);
  const factory = position.createInterpolant;
  enableVmdSubframeCurves(animation);
  assert.equal(position.createInterpolant, factory);
});

test("普通动作保留现有插值行为", () => {
  const animation = clip("上半身");
  const factory = animation.tracks[0].createInterpolant;
  assert.equal(enableVmdSubframeCurves(animation), false);
  assert.equal(animation.tracks[0].createInterpolant, factory);
});
