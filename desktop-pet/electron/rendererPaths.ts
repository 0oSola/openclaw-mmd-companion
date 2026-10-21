import path from "node:path";

export const PRODUCTION_RENDERER_PAGES = ["index", "menu", "notification"] as const;

export type ProductionRendererPage = (typeof PRODUCTION_RENDERER_PAGES)[number];

export function resolveProductionRendererRoot(electronDir: string, configuredRoot?: string): string {
  const trimmedRoot = configuredRoot?.trim();
  return path.resolve(trimmedRoot || path.join(electronDir, "..", "dist"));
}

export function resolveProductionRendererPage(
  rendererRoot: string,
  page: ProductionRendererPage,
): string {
  return path.join(rendererRoot, `${page}.html`);
}
