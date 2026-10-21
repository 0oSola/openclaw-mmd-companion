export type ContextMenuPoint = {
  x: number;
  y: number;
};

export function clampContextMenuPosition({
  requested,
  viewport,
  menu,
  margin,
}: {
  requested: ContextMenuPoint;
  viewport: { width: number; height: number };
  menu: { width: number; height: number };
  margin: number;
}): ContextMenuPoint {
  const maxX = Math.max(margin, viewport.width - menu.width - margin);
  const maxY = Math.max(margin, viewport.height - menu.height - margin);
  return {
    x: Math.min(Math.max(requested.x, margin), maxX),
    y: Math.min(Math.max(requested.y, margin), maxY),
  };
}

export function enterContextMenuSubmenu(path: readonly string[], itemId: string): string[] {
  return [...path, itemId];
}

export function leaveContextMenuSubmenu(path: readonly string[]): string[] {
  return path.slice(0, -1);
}
