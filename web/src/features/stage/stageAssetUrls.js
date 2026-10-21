// 网页默认沿用构建配置；桌宠显式传入主进程确定的 API 地址。
export function resolveStageAssetUrl(url, apiBaseUrl) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  let base = (apiBaseUrl || "http://127.0.0.1:8000").replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    try {
      const baseUrl = new URL(base);
      const runtimeHost = window.location.hostname;
      if (
        runtimeHost &&
        runtimeHost !== "localhost" &&
        runtimeHost !== "127.0.0.1" &&
        (baseUrl.hostname === "localhost" || baseUrl.hostname === "127.0.0.1")
      ) {
        const protocol = window.location.protocol;
        base = `${protocol}//${runtimeHost}/api`;
      }
    } catch {
      // ignore
    }
  }
  // 浏览器端走 Next.js /api/backend 代理，避免直接暴露后端端口且自动带认证
  // 仅在 Next.js 网页（非 Electron/桌宠）环境走代理；Pet 直接打 apiBaseUrl。
  // Pet 通过 contextBridge 暴露 window.desktopPet；Electron 渲染进程也带 process.versions.electron。
  if (
    typeof window !== "undefined" &&
    url.startsWith("/assets/") &&
    !window.desktopPet &&
    !window.process?.versions?.electron
  ) {
    return `/api/backend${url}`;
  }
  return `${base}${url.startsWith("/") ? url : `/${url}`}`;
}

