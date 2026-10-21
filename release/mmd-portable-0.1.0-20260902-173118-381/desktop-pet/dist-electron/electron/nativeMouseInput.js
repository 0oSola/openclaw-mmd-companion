export const WM_MOUSEMOVE = 0x0200;
export const WM_LBUTTONDOWN = 0x0201;
export const WM_LBUTTONUP = 0x0202;
export const WM_RBUTTONUP = 0x0205;
export const CONTEXT_MENU_NATIVE_DRAG_SUPPRESSION_MS = 750;
export const NATIVE_CLICK_MAX_MOVE_PX = 6;
export function hasNativeClickMoved({ origin, current, maxMovePx = NATIVE_CLICK_MAX_MOVE_PX, }) {
    return Math.hypot(current.x - origin.x, current.y - origin.y) > maxMovePx;
}
export function readNativeClientPoint(lParam) {
    if (!lParam || lParam.length < 4)
        return null;
    return {
        x: lParam.readInt16LE(0),
        y: lParam.readInt16LE(2),
    };
}
export function shouldDispatchNativePetClick({ interactionMode, moved, contextMenuActive = false, lastContextMenuClosedAtMs, nowMs = Date.now(), }) {
    if (moved || contextMenuActive)
        return false;
    if (lastContextMenuClosedAtMs !== undefined &&
        nowMs - lastContextMenuClosedAtMs <= CONTEXT_MENU_NATIVE_DRAG_SUPPRESSION_MS) {
        return false;
    }
    return interactionMode === "window-drag" || interactionMode === "camera-adjust";
}
export function shouldStartNativeWindowDrag({ interactionMode, contextMenuActive = false, lastContextMenuClosedAtMs, nowMs = Date.now(), }) {
    if (contextMenuActive)
        return false;
    if (lastContextMenuClosedAtMs !== undefined &&
        nowMs - lastContextMenuClosedAtMs <= CONTEXT_MENU_NATIVE_DRAG_SUPPRESSION_MS) {
        return false;
    }
    return interactionMode === "window-drag";
}
export function shouldActivateNativeWindowDrag({ interactionMode, moved, contextMenuActive = false, lastContextMenuClosedAtMs, nowMs = Date.now(), }) {
    return (moved &&
        shouldStartNativeWindowDrag({
            interactionMode,
            contextMenuActive,
            lastContextMenuClosedAtMs,
            nowMs,
        }));
}
