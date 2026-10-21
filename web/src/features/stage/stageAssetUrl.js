// Electron 正式页面位于 dist/index.html；根路径资源应从同一发布目录读取。
// 网页仍保留站点根路径，HTTP/Blob 等完整地址不改写。
export function resolveStageAssetUrl(path) {
  const base = globalThis.location.href;
  const localPath = globalThis.location.protocol === 'file:' && path.startsWith('/stage-assets/')
    ? `.${path}` : path;
  return new URL(localPath, base).href;
}
