const DEFAULT_RENDER_PIPELINE = "mio-reference";

const RENDER_PIPELINES = new Set([
  "classic",
  "hero-shot",
  "genshin",
  "mio-reference",
  "reze-npr",
  "reze-design",
  "k3",
  "reze-k3",
  "v14d-game",
  "gf2",
]);

export function normalizeRememberedRenderPipeline(value, fallback = DEFAULT_RENDER_PIPELINE) {
  return typeof value === "string" && RENDER_PIPELINES.has(value) ? value : fallback;
}

export function companionRenderPipelineStorageKey(userId) {
  return `mmd_companion_render_pipeline_v1:${userId}`;
}
