export function getModelDisplayLabel(model) {
  const relativePath = `${model?.relative_path || ""}`.trim().replace(/\\/g, "/");
  const parts = relativePath.split("/").filter(Boolean);
  const parentFolder = parts.length >= 2 ? parts[parts.length - 2] : "";
  const rootFolder = parts[0] || "";
  const baseLabel = model?.label?.trim() || parentFolder;
  if (baseLabel && rootFolder && parts.length > 2 && rootFolder !== parentFolder) {
    return `${baseLabel}（${rootFolder}）`;
  }
  if (baseLabel) return baseLabel;
  const name = `${model?.name || ""}`.trim();
  return name.replace(/\.(pmx|pmd)$/i, "") || "Unknown Model";
}

export function pickInitialModelSelection(models, preferredRelativePath = "") {
  if (!Array.isArray(models) || models.length === 0) return null;
  return models.find((item) => item?.relative_path === preferredRelativePath) || models[0] || null;
}

export function pickRememberedModelSelection(models, rememberedRelativePath = "", fallbackRelativePath = "") {
  if (!Array.isArray(models) || models.length === 0) return null;
  return (
    models.find((item) => item?.relative_path === rememberedRelativePath) ||
    pickInitialModelSelection(models, fallbackRelativePath)
  );
}
