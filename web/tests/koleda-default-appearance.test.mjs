import assert from "node:assert/strict";
import test from "node:test";

import {
  isKoledaMaskMaterialName,
  isKoledaModelIdentifier,
  lockKoledaClosedEyeMorphs,
  lockKoledaMorphWeights,
  selectKoledaClosedEyeMorphNames,
} from "../src/features/stage/koledaDefaultAppearance.js";

test("名称包含克莱妲或 Koleda 的模型启用默认外观", () => {
  assert.equal(isKoledaModelIdentifier("克莱妲原皮/GirlsFrontline KoledaDefault.pmx"), true);
  assert.equal(isKoledaModelIdentifier("Ayaka/Ayaka.pmx"), false);
});

test("克莱妲默认外观隐藏 mask/面具材质", () => {
  assert.equal(isKoledaMaskMaterialName("Face_Mask"), true);
  assert.equal(isKoledaMaskMaterialName("口罩"), true);
  assert.equal(isKoledaMaskMaterialName("Hair_Main"), false);
});

test("克莱妲默认外观优先选择明确闭眼 Morph", () => {
  assert.deepEqual(
    selectKoledaClosedEyeMorphNames(["Blink", "Eyes_Close_Down_Left", "Eyes_Close_Down_Right", "Smile"]),
    ["Eyes_Close_Down_Left", "Eyes_Close_Down_Right"],
  );
});

test("Reze 每帧采样 VMD 后仍会锁定闭眼 Morph，眨眼不会重新睁开", () => {
  const weights = { "まばたき": 0 };
  const model = {
    update() {
      weights["まばたき"] = 0;
      return true;
    },
    setMorphWeight(name, value) {
      weights[name] = value;
    },
  };

  assert.equal(lockKoledaClosedEyeMorphs(model, ["まばたき"]), true);
  assert.equal(lockKoledaMorphWeights(model, { "まばたき": 1 }), true);
  assert.equal(weights["まばたき"], 1);
  model.update(1 / 30, true);
  assert.equal(weights["まばたき"], 1);
});
