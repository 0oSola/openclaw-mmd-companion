const VMD_HEADER_SIZE = 30;
const VMD_MODEL_NAME_SIZE = 20;
const VMD_BONE_FRAME_SIZE = 111;
const VMD_MORPH_FRAME_SIZE = 23;
const VMD_CAMERA_FRAME_SIZE = 61;
const VMD_LIGHT_FRAME_SIZE = 28;
const VMD_SHADOW_FRAME_SIZE = 9;
const VMD_IK_NAME_SIZE = 20;
const FOOT_IK_NAMES = new Set(["左足ＩＫ", "左つま先ＩＫ", "右足ＩＫ", "右つま先ＩＫ"]);

function assertReadable(view, offset, byteLength, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(byteLength) || offset < 0 || byteLength < 0) {
    throw new RangeError(`无效的 ${label} 偏移`);
  }
  if (offset + byteLength > view.byteLength) {
    throw new RangeError(`VMD 的 ${label} 数据不完整`);
  }
}

function readUint32(view, offset, label) {
  assertReadable(view, offset, 4, label);
  return view.getUint32(offset, true);
}

function skipFrameTable(view, offset, frameSize, label) {
  const count = readUint32(view, offset, `${label}数量`);
  const byteLength = count * frameSize;
  if (!Number.isSafeInteger(byteLength)) throw new RangeError(`VMD 的 ${label}数量过大`);
  const nextOffset = offset + 4;
  assertReadable(view, nextOffset, byteLength, label);
  return nextOffset + byteLength;
}

function decodeVmdText(bytes) {
  const zero = bytes.indexOf(0);
  const payload = zero >= 0 ? bytes.subarray(0, zero) : bytes;
  return new TextDecoder("shift_jis").decode(payload);
}

/**
 * 读取 VMD 显示/IK 帧，判断 Reze 当前只能静态处理的足 IK 策略。
 *
 * - 所有足 IK 条目都关闭：整段播放关闭引擎 IK，保护 FK 腿部轨道。
 * - 所有足 IK 条目都开启：整段播放开启引擎 IK。
 * - 没有足 IK 条目或动作中途切换：保持舞台默认值；后者需要引擎支持逐帧 IK。
 */
export function inspectRezeVmdIkPolicy(buffer) {
  const view = new DataView(buffer);
  const headerBytes = new Uint8Array(buffer, 0, Math.min(VMD_HEADER_SIZE, buffer.byteLength));
  const header = new TextDecoder("ascii").decode(headerBytes);
  if (!header.startsWith("Vocaloid Motion Data")) throw new Error("无效的 VMD 文件头");

  let offset = VMD_HEADER_SIZE + VMD_MODEL_NAME_SIZE;
  assertReadable(view, 0, offset, "文件头");
  offset = skipFrameTable(view, offset, VMD_BONE_FRAME_SIZE, "骨骼帧");
  offset = skipFrameTable(view, offset, VMD_MORPH_FRAME_SIZE, "表情帧");

  // 一些只含动作的旧 VMD 会在表情帧后结束；这种文件没有可用的 IK 策略。
  if (offset === view.byteLength) {
    return { mode: "absent", engineIkEnabled: null, ikFrameCount: 0, footIkEntryCount: 0 };
  }

  offset = skipFrameTable(view, offset, VMD_CAMERA_FRAME_SIZE, "相机帧");
  offset = skipFrameTable(view, offset, VMD_LIGHT_FRAME_SIZE, "光照帧");
  offset = skipFrameTable(view, offset, VMD_SHADOW_FRAME_SIZE, "阴影帧");

  if (offset === view.byteLength) {
    return { mode: "absent", engineIkEnabled: null, ikFrameCount: 0, footIkEntryCount: 0 };
  }

  const ikFrameCount = readUint32(view, offset, "IK 帧数量");
  offset += 4;
  const footIkStates = [];
  const allIkStates = [];

  for (let frameIndex = 0; frameIndex < ikFrameCount; frameIndex += 1) {
    assertReadable(view, offset, 9, `IK 帧 ${frameIndex}`);
    offset += 4; // 帧号
    offset += 1; // 模型显示状态
    const ikEntryCount = readUint32(view, offset, `IK 帧 ${frameIndex}条目数量`);
    offset += 4;

    for (let entryIndex = 0; entryIndex < ikEntryCount; entryIndex += 1) {
      assertReadable(view, offset, VMD_IK_NAME_SIZE + 1, `IK 帧 ${frameIndex}条目 ${entryIndex}`);
      const name = decodeVmdText(new Uint8Array(buffer, offset, VMD_IK_NAME_SIZE));
      offset += VMD_IK_NAME_SIZE;
      const enabled = view.getUint8(offset) !== 0;
      offset += 1;
      allIkStates.push(enabled);
      if (FOOT_IK_NAMES.has(name)) footIkStates.push(enabled);
    }
  }

  if (!footIkStates.length) {
    return { mode: "absent", engineIkEnabled: null, ikFrameCount, footIkEntryCount: 0 };
  }
  if (footIkStates.every((enabled) => !enabled) && allIkStates.every((enabled) => !enabled)) {
    return {
      mode: "disabled",
      engineIkEnabled: false,
      ikFrameCount,
      footIkEntryCount: footIkStates.length,
    };
  }
  if (footIkStates.every(Boolean) && allIkStates.every(Boolean)) {
    return {
      mode: "enabled",
      engineIkEnabled: true,
      ikFrameCount,
      footIkEntryCount: footIkStates.length,
    };
  }
  return {
    mode: "animated",
    engineIkEnabled: null,
    ikFrameCount,
    footIkEntryCount: footIkStates.length,
  };
}

export async function fetchRezeVmdIkPolicy(url, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("当前环境没有可用的 fetch");
  const response = await fetchImpl(url);
  if (!response?.ok) throw new Error(`读取 VMD IK 状态失败：${response?.status ?? "unknown"}`);
  return inspectRezeVmdIkPolicy(await response.arrayBuffer());
}

export function applyRezeVmdIkPolicy(engine, policy, defaultIkEnabled = true) {
  const enabled = typeof policy?.engineIkEnabled === "boolean" ? policy.engineIkEnabled : defaultIkEnabled;
  engine?.setIKEnabled?.(enabled);
  return enabled;
}

/**
 * 播放局部骨骼 VMD 时保留当前姿势。
 *
 * reze-engine 的 Model.show()/play() 会先 resetAllBones()；对只含少量骨骼轨道
 * 的动作会把未覆盖的骨骼重置到 PMX 绑定 T 姿势。已有动作姿势时，直接切换
 * animationState 可让引擎只覆盖 VMD 实际包含的骨骼轨道。
 */
export function playRezeVmd(model, name, { preserveCurrentPose = false } = {}) {
  if (preserveCurrentPose && model?.animationState?.show && model?.animationState?.play) {
    model.animationState.show(name);
    return model.animationState.play(name, { loop: false });
  }

  model.show(name);
  return model.play(name, { loop: false });
}

/**
 * 在剪辑自然结束后回到 PMX 绑定姿势（T 形待机），而不是停在最后一帧。
 *
 * 复用引擎自己的 resetAllBones()/resetAllMorphs() + clearAnimation() 组合：
 * clearAnimation() 先解除逐帧姿势重放，随后 reset 才能真正生效。该辅助只应在
 * 「不再有后续 VMD」的收尾路径调用；后续还有 VMD 要接播时保持当前姿势。
 */
export function resetRezeModelToBindPose(model) {
  if (!model?.animationState) return;
  model.animationState.clear?.();
  model.resetAllBones?.();
  model.resetAllMorphs?.();
}

export function setRezeVmdCompletionHandler(model, onEnd) {
  if (!model?.animationState?.setOnEnd) return false;
  model.animationState.setOnEnd(onEnd);
  return true;
}
