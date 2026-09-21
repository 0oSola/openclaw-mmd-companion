import test from "node:test";
import assert from "node:assert/strict";

import { getModelDisplayLabel, pickInitialModelSelection, pickRememberedModelSelection } from "../src/features/stage/modelCatalog.js";

test("pickInitialModelSelection prefers the requested relative path", () => {
  const models = [
    {
      name: "miku_v2.pmd",
      label: "Miku",
      relative_path: "Miku/miku_v2.pmd",
      size_bytes: 1,
      url: "/assets/mmd/Miku/miku_v2.pmd",
    },
    {
      name: "GirlsFrontline NemesisGnosisDefault.pmx",
      label: "Nemesis",
      relative_path: "Nemesis/GirlsFrontline NemesisGnosisDefault.pmx",
      size_bytes: 2,
      url: "/assets/mmd/Nemesis/GirlsFrontline%20NemesisGnosisDefault.pmx",
    },
  ];

  const selected = pickInitialModelSelection(models, "Nemesis/GirlsFrontline NemesisGnosisDefault.pmx");

  assert.equal(selected?.label, "Nemesis");
  assert.equal(selected?.relative_path, "Nemesis/GirlsFrontline NemesisGnosisDefault.pmx");
});

test("pickInitialModelSelection falls back to the first model when preferred path is missing", () => {
  const models = [
    {
      name: "miku_v2.pmd",
      label: "Miku",
      relative_path: "Miku/miku_v2.pmd",
      size_bytes: 1,
      url: "/assets/mmd/Miku/miku_v2.pmd",
    },
    {
      name: "other_model.pmx",
      label: "Other",
      relative_path: "Other/other_model.pmx",
      size_bytes: 2,
      url: "/assets/mmd/Other/other_model.pmx",
    },
  ];

  const selected = pickInitialModelSelection(models, "Nemesis/GirlsFrontline NemesisGnosisDefault.pmx");

  assert.equal(selected?.label, "Miku");
  assert.equal(selected?.relative_path, "Miku/miku_v2.pmd");
});

test("pickInitialModelSelection returns null for an empty catalog", () => {
  assert.equal(pickInitialModelSelection([], "Nemesis/GirlsFrontline NemesisGnosisDefault.pmx"), null);
});

test("pickRememberedModelSelection restores the last selected model when it still exists", () => {
  const models = [
    { relative_path: "优菈/优菈.pmx" },
    { relative_path: "克莱妲/GirlsFrontline KoledaDefault.pmx" },
  ];

  assert.equal(
    pickRememberedModelSelection(models, "克莱妲/GirlsFrontline KoledaDefault.pmx", "优菈/优菈.pmx")?.relative_path,
    "克莱妲/GirlsFrontline KoledaDefault.pmx",
  );
});

test("pickRememberedModelSelection falls back safely when the remembered model was removed", () => {
  const models = [
    { relative_path: "优菈/优菈.pmx" },
    { relative_path: "克莱妲/GirlsFrontline KoledaDefault.pmx" },
  ];

  assert.equal(
    pickRememberedModelSelection(models, "已删除/旧模型.pmx", "优菈/优菈.pmx")?.relative_path,
    "优菈/优菈.pmx",
  );
});

test("getModelDisplayLabel falls back to the parent folder when label is missing", () => {
  const label = getModelDisplayLabel({
    name: "GirlsFrontline NemesisGnosisDefault.pmx",
    relative_path: "Nemesis/GirlsFrontline NemesisGnosisDefault.pmx",
  });

  assert.equal(label, "Nemesis");
});

test("getModelDisplayLabel falls back to filename stem for root-level models", () => {
  const label = getModelDisplayLabel({
    name: "root_idle.pmd",
    relative_path: "root_idle.pmd",
  });

  assert.equal(label, "root_idle");
});

test("getModelDisplayLabel 区分两条同名克莱妲", () => {
  const shortLabel = getModelDisplayLabel({
    label: "克莱妲原皮",
    relative_path: "克莱妲原皮/GirlsFrontline KoledaDefault.pmx",
  });
  const longLabel = getModelDisplayLabel({
    label: "克莱妲原皮",
    relative_path: "克莱妲原皮_by_少女前线2：追放_3801ab976ee72bef4da6543c0f956bb0/克莱妲原皮/GirlsFrontline KoledaDefault.pmx",
  });
  assert.equal(shortLabel, "克莱妲原皮");
  assert.equal(longLabel, "克莱妲原皮（克莱妲原皮_by_少女前线2：追放_3801ab976ee72bef4da6543c0f956bb0）");
  assert.notEqual(shortLabel, longLabel);
});
