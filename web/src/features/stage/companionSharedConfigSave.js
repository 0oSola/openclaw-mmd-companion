export const COMPANION_SHARED_CONFIG_SAVE_TIMEOUT_MS = 8_000;

const REZE_EDITOR_PIPELINES = new Set(["reze-k3", "reze-design"]);

/**
 * 生成主站与桌面 Pet 共用的配置载荷。
 * Reze 管线必须把当前材质预设和场景调试值放进同一个舞台文档，
 * 但相机距离属于各窗口的本地构图，不能随主站配置同步。
 */
export function buildCompanionSharedConfigPayload({
  selectedModelPath,
  renderPipeline,
  rezeStageDocument,
  rezeSceneDebugSettings,
}) {
  const { cameraDistance: _cameraDistance, ...sharedScene } = rezeSceneDebugSettings || {};
  return {
    selected_model_path: selectedModelPath,
    render_pipeline: renderPipeline,
    reze_stage_document: REZE_EDITOR_PIPELINES.has(renderPipeline) && rezeStageDocument
      ? {
          ...rezeStageDocument,
          scene: sharedScene,
        }
      : null,
  };
}

/**
 * 手动保存到桌面 Pet 必须有客户端超时边界。网络代理或后端迁移被阻塞时，
 * fetch 可能长期不返回；AbortController 可保证界面恢复可操作状态。
 */
export async function saveCompanionSharedConfigWithTimeout(
  save,
  timeoutMs = COMPANION_SHARED_CONFIG_SAVE_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await save(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("保存到桌面 Pet 超时，请确认 API 服务可用后重试。");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}
