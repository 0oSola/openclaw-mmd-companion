const KOLEDA_MODEL_HINTS = ["克莱妲", "koleda"];
const KOLEDA_MASK_HINTS = ["mask", "mouth mask", "face mask", "口罩", "面具"];
const lockedMorphWeightsByModel = new WeakMap();

function normalize(value = "") {
  return `${value}`.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

/**
 * 克莱妲角色规则以模型资源名为准，而非单一 PMX 路径；原皮、换装和本地导入
 * 只要名称包含“克莱妲”或 “Koleda”都会取得相同默认外观。
 */
export function isKoledaModelIdentifier(...values) {
  return values.some((value) => {
    const text = normalize(value);
    return KOLEDA_MODEL_HINTS.some((hint) => text.includes(hint));
  });
}

export function isKoledaMaskMaterialName(materialName = "") {
  const text = normalize(materialName);
  return KOLEDA_MASK_HINTS.some((hint) => text.includes(hint));
}

export function selectKoledaClosedEyeMorphNames(morphNames = []) {
  const names = (Array.isArray(morphNames) ? morphNames : []).filter(Boolean);
  const explicitlyClosed = names.filter((name) => {
    const text = normalize(name);
    return (
      (text.includes("eye") || text.includes("eyes") || text.includes("目") || text.includes("眼")) &&
      (text.includes("close") || text.includes("closed") || text.includes("閉") || text.includes("闭"))
    );
  });
  if (explicitlyClosed.length) return explicitlyClosed;

  return names.filter((name) => {
    const text = normalize(name);
    return text.includes("blink") || text.includes("まばたき") || text.includes("瞬き") || text.includes("眨眼");
  });
}

/** 动作控制的眼睑、眼形和瞳孔通道；不把“真面目”等整脸表情误判为眼部。 */
export function selectKoledaEyeMorphNames(morphNames = []) {
  const japanese = /^(?:まばたき|瞬き|ウィンク|笑い|じと目|ジト目|滑稽|なごみ|はぅ|はちゅ目|びっくり|ぐるぐる|星目|はぁと|光消|恐ろしい子|瞳)/;
  return (Array.isArray(morphNames) ? morphNames : []).filter((name) =>
    typeof name === "string" && (japanese.test(name) || /eye|blink|wink|iris|pupil|眼|眨眼/i.test(name)),
  );
}

/**
 * 显式诊断/手动预览使用；生产默认外观不安装此锁。
 * reze-engine 会在每帧采样 VMD Morph 轨道；仅在加载时 setMorphWeight 会被后续
 * 的轨道值覆盖。闭眼模式需要在每次 model.update() 后重新写入闭眼 Morph，既
 * 保持闭眼，也等效禁用该模型的眨眼动画。
 */
export function lockKoledaMorphWeights(model, morphWeights = {}) {
  if (!model?.update || !model?.setMorphWeight) return false;
  const weights = Object.entries(morphWeights).filter(
    ([name, weight]) => Boolean(name) && typeof weight === "number" && Number.isFinite(weight),
  );
  if (!weights.length) return false;

  const previous = lockedMorphWeightsByModel.get(model) || new Map();
  for (const [name, weight] of weights) previous.set(name, weight);
  lockedMorphWeightsByModel.set(model, previous);
  if (model.__koledaClosedEyeLockInstalled) {
    for (const [name, weight] of previous) model.setMorphWeight(name, weight);
    return true;
  }

  const originalUpdate = model.update.bind(model);
  model.update = (...args) => {
    const result = originalUpdate(...args);
    for (const [name, weight] of lockedMorphWeightsByModel.get(model) || []) {
      model.setMorphWeight(name, weight);
    }
    return result;
  };
  model.__koledaClosedEyeLockInstalled = true;
  for (const [name, weight] of previous) model.setMorphWeight(name, weight);
  return true;
}

export function lockKoledaClosedEyeMorphs(model, morphNames = []) {
  const names = Array.from(new Set((Array.isArray(morphNames) ? morphNames : []).filter(Boolean)));
  return lockKoledaMorphWeights(model, Object.fromEntries(names.map((name) => [name, 1])));
}
