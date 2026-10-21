// 每个模型独享。文件仍按原路径重新读取，以内容摘要命中，不能用同名/同长度代替版本。
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 16;

export class VmdClipCache {
  constructor() {
    this.entries = new Map();
    this.bytes = 0;
  }

  async keyFor(buffer) {
    // 进场等大文件通常只播放一次，不长期占用待机缓存；无摘要能力时正常解析。
    if (buffer.byteLength > MAX_SOURCE_BYTES || !globalThis.crypto?.subtle) return null;
    const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    this.entries.set(key, entry);
    // 每次独立轨道/UUID，防止播放器的插值补丁和混合器状态污染下一次播放。
    return entry.clip.clone();
  }

  put(key, clip) {
    if (!key || this.entries.has(key)) return;
    const cachedClip = clip.clone();
    let bytes = 0;
    for (const track of cachedClip.tracks) {
      bytes += track.times.byteLength + track.values.byteLength + 512;
      const { constructor: Interpolant, interpolationParams: params } = track.createInterpolant();
      if (params) {
        // MMD工厂原闭包保留Number数组，每次建插值器再复制为Float32Array。
        // 缓存保留它实际使用的同一精度参数，独立插值器只读共享参数，释放原工厂闭包。
        track.createInterpolant = function (result) {
          return new Interpolant(this.times, this.values, this.getValueSize(), result, params);
        };
        bytes += params.byteLength;
      }
    }
    if (bytes > MAX_CACHE_BYTES) return;
    while (this.entries.size && (this.entries.size >= MAX_ENTRIES || this.bytes + bytes > MAX_CACHE_BYTES)) {
      const oldest = this.entries.keys().next().value;
      this.bytes -= this.entries.get(oldest).bytes;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { clip: cachedClip, bytes });
    this.bytes += bytes;
  }

  clear() {
    this.entries.clear();
    this.bytes = 0;
  }

  getStats() {
    return { entries: this.entries.size, bytes: this.bytes };
  }
}
