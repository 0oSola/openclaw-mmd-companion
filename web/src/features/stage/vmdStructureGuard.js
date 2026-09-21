// VMD 结构预检：在交给 three-stdlib 的 parseVmd 之前先按标准布局校验长度。
//
// 为什么需要它：MMDLoader.loadVMD 在 FileLoader 的成功回调里同步调用
// parser.parseVmd（three-stdlib MMDLoader.js:166）。解析抛出的异常被
// FileLoader 内部的 promise 链吞成未捕获的 promise 拒绝，onError 回调收不到，
// loadAnimation 的 reject 也永远不触发。损坏的 VMD（例如只有 169 字节、在
// morph 段被截断）会让浏览器控制台刷出 Uncaught (in promise) RangeError。
//
// 这里不解析骨骼数据，只按各段声明的数量推进 offset 并检查是否越界。

const HEADER_SIZE = 50;
const MOTION_ENTRY_SIZE = 111;
const MORPH_ENTRY_SIZE = 23;
const CAMERA_ENTRY_SIZE = 61;
const SECTIONS = [
  ["motion", MOTION_ENTRY_SIZE],
  ["morph", MORPH_ENTRY_SIZE],
  ["camera", CAMERA_ENTRY_SIZE],
];

export function inspectVmdStructure(buffer) {
  const size = buffer?.byteLength ?? 0;
  if (size < HEADER_SIZE + 4) {
    return { ok: false, reason: `file too small (${size} bytes)` };
  }

  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(...bytes.slice(0, 30)).split("\u0000")[0];
  if (magic !== "Vocaloid Motion Data 0002") {
    return { ok: false, reason: `bad magic: ${magic.slice(0, 40)}` };
  }

  const view = new DataView(buffer);
  let offset = HEADER_SIZE;
  for (const [label, entrySize] of SECTIONS) {
    if (offset + 4 > size) {
      return { ok: false, reason: `${label}: no count at ${offset}` };
    }
    const count = view.getUint32(offset, true);
    offset += 4 + count * entrySize;
    if (offset > size) {
      return {
        ok: false,
        reason: `${label} overruns: need ${offset}, have ${size} (count=${count})`,
      };
    }
  }
  return { ok: true };
}

