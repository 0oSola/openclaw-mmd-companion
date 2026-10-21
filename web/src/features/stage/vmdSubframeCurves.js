import { Quaternion } from "three";

export const VMD_BODY_INTERPOLATION_MODEL_NAME = "MMD:body-legacy:v1";

// 声明只占标准VMD模型名称字段，不依赖文件名、路径或特定动作哈希。
export function readVmdBodyInterpolation(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 50) return null;
  const bytes = new Uint8Array(buffer, 30, 20);
  const end = bytes.indexOf(0);
  const name = String.fromCharCode(...bytes.subarray(0, end < 0 ? 20 : end));
  return name === VMD_BODY_INTERPOLATION_MODEL_NAME ? "preserve-original" : null;
}

// 标准VMD曲线求值；连续帧也读取曲线，不把中间时刻强制保持为上一帧。
function bezier(x1, x2, y1, y2, x) {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 30; i += 1) {
    const t = (low + high) / 2;
    const value = 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t ** 2 * x2 + t ** 3;
    if (value < x) low = t;
    else high = t;
  }
  const t = (low + high) / 2;
  return 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3;
}

function interpolate(i1, t0, t, t1) {
  const { resultBuffer: result, sampleValues: values, valueSize: stride, interpolationParams: params } = this;
  const offset1 = i1 * stride;
  const offset0 = offset1 - stride;
  // VMD关键帧是整数帧；恢复Float32时间数组丢失的小数精度，避免辅助曲线相消放大误差。
  const start = Math.round(t0 * 30) / 30;
  const end = Math.round(t1 * 30) / 30;
  const weight = Math.min(1, Math.max(0, (t - start) / (end - start)));
  if (stride === 4) {
    const p = i1 * 4;
    const ratio = bezier(params[p], params[p + 1], params[p + 2], params[p + 3], weight);
    Quaternion.slerpFlat(result, 0, values, offset0, values, offset1, ratio);
  } else {
    for (let axis = 0; axis < stride; axis += 1) {
      const p = i1 * stride * 4 + axis * 4;
      const ratio = bezier(params[p], params[p + 1], params[p + 2], params[p + 3], weight);
      result[axis] = values[offset0 + axis] * (1 - ratio) + values[offset1 + axis] * ratio;
    }
  }
  return result;
}

export function enableVmdSubframeCurves(clip, { compensationMorphIndices = [], allBoneTracks = false } = {}) {
  const preserveBody = clip?.userData?.vmdBodyInterpolation === "preserve-original";
  // 默认只接入已声明的辅助骨，或当前模型中实际被动作使用的烘焙补偿形态。
  // 已明确配套的独立武器可显式请求全部骨轨道；不改变人物默认条件。
  // 不能仅凭模型存在补偿形态，就改变加载到它上面的普通动作。
  const compensationIndices = new Set(compensationMorphIndices);
  const explicitBake = clip?.tracks?.some((track) => {
    if (/^\.bones\[E\d{3}T\]\.position$/.test(track.name)) return true;
    const morph = /^\.morphTargetInfluences\[(\d+)\]$/.exec(track.name);
    return morph && compensationIndices.has(Number(morph[1]));
  });
  if (!explicitBake && !allBoneTracks) return false;
  for (const track of clip.tracks) {
    if (!track.name.startsWith(".bones[") || track.vmdSubframeCurves) continue;
    if (preserveBody && !allBoneTracks && !/^\.bones\[E\d{3}[^\]]*\]\./.test(track.name)) continue;
    const create = track.createInterpolant;
    track.createInterpolant = function (buffer) {
      const result = create.call(this, buffer);
      if (result.interpolationParams) result.interpolate_ = interpolate;
      return result;
    };
    track.vmdSubframeCurves = true;
  }
  return true;
}
