function isPointInsideWindow(point, bounds) {
    return (point.x >= bounds.x &&
        point.x <= bounds.x + bounds.width &&
        point.y >= bounds.y &&
        point.y <= bounds.y + bounds.height);
}
export function normalizeRendererMenuPosition(value) {
    if (!value || typeof value !== "object")
        return null;
    const point = value;
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y))
        return null;
    return {
        x: Math.max(0, Math.round(x)),
        y: Math.max(0, Math.round(y)),
    };
}
export function toWindowMenuPosition(point, bounds) {
    return {
        x: Math.max(0, Math.min(bounds.width, Math.round(point.x - bounds.x))),
        y: Math.max(0, Math.min(bounds.height, Math.round(point.y - bounds.y))),
    };
}
export function toScreenMenuPosition(point, bounds) {
    return {
        x: Math.round(bounds.x + Math.max(0, Math.min(bounds.width, point.x))),
        y: Math.round(bounds.y + Math.max(0, Math.min(bounds.height, point.y))),
    };
}
export function resolveContextMenuPosition({ input, bounds, }) {
    if (input.space === "screen" && !isPointInsideWindow(input.point, bounds)) {
        return null;
    }
    const popupPosition = input.space === "screen"
        ? toWindowMenuPosition(input.point, bounds)
        : {
            x: Math.max(0, Math.min(bounds.width, Math.round(input.point.x))),
            y: Math.max(0, Math.min(bounds.height, Math.round(input.point.y))),
        };
    return {
        popupPosition,
        screenPosition: input.space === "screen" ? input.point : toScreenMenuPosition(popupPosition, bounds),
    };
}
