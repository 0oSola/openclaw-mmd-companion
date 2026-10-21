// GF2 mode 对应已验收的克莱妲原皮动作兼容模型与兵营捕获资源。
export const GF2_MODEL_PATH = "克莱妲原皮/Koleda_v1.1_动作兼容.pmx";
export const GF2_MODEL_SHA256 = "441edc6e3ce7f1e9545906d8ba2df4c6682659f1d066946d49b26c863c6bb4c4";
export const GF2_FRAME_ROOT = "/assets/gf2/frame/";

export function isGf2StageModel(path) {
  return String(path || "").replaceAll("\\", "/") === GF2_MODEL_PATH;
}
