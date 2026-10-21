import path from "node:path";
export const PRODUCTION_RENDERER_PAGES = ["index", "menu", "notification"];
export function resolveProductionRendererRoot(electronDir, configuredRoot) {
    const trimmedRoot = configuredRoot?.trim();
    return path.resolve(trimmedRoot || path.join(electronDir, "..", "dist"));
}
export function resolveProductionRendererPage(rendererRoot, page) {
    return path.join(rendererRoot, `${page}.html`);
}
