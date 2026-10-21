const IMMEDIATE_DUPLICATE_WINDOW_MS = 350;
const SAME_POINT_DUPLICATE_WINDOW_MS = 1500;
const MENU_CLOSE_FALLBACK_SUPPRESSION_MS = 350;
const SAME_POINT_TOLERANCE_PX = 4;
function isSameMenuPoint(left, right) {
    return Math.abs(left.x - right.x) <= SAME_POINT_TOLERANCE_PX && Math.abs(left.y - right.y) <= SAME_POINT_TOLERANCE_PX;
}
export function shouldSuppressDuplicateContextMenuPopup({ nowMs, source, position, lastPopup, lastMenuClosedAtMs, menuActive = false, }) {
    if (menuActive)
        return true;
    if (!lastPopup)
        return false;
    const elapsedMs = nowMs - lastPopup.atMs;
    if (elapsedMs < 0)
        return false;
    if (elapsedMs <= IMMEDIATE_DUPLICATE_WINDOW_MS)
        return true;
    const elapsedSinceCloseMs = typeof lastMenuClosedAtMs === "number" ? nowMs - lastMenuClosedAtMs : undefined;
    if (typeof elapsedSinceCloseMs === "number" &&
        elapsedSinceCloseMs >= 0 &&
        elapsedSinceCloseMs <= MENU_CLOSE_FALLBACK_SUPPRESSION_MS &&
        (lastPopup.source === "native" || lastPopup.source === "system") &&
        (source === "renderer" || source === "webcontents")) {
        return true;
    }
    if (!position || !lastPopup.position)
        return false;
    return elapsedMs <= SAME_POINT_DUPLICATE_WINDOW_MS && isSameMenuPoint(position, lastPopup.position);
}
