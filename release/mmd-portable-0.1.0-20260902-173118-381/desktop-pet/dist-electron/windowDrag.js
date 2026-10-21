export function calculateDraggedWindowPosition(snapshot) {
    return {
        x: Math.round(snapshot.originBounds.x + snapshot.currentCursor.x - snapshot.originCursor.x),
        y: Math.round(snapshot.originBounds.y + snapshot.currentCursor.y - snapshot.originCursor.y),
    };
}
export function calculateDraggedWindowBounds(snapshot) {
    return {
        ...calculateDraggedWindowPosition(snapshot),
        width: snapshot.originBounds.width,
        height: snapshot.originBounds.height,
    };
}
export function calculateEndedWindowDragBounds({ currentBounds, originBounds: _originBounds, }) {
    return {
        x: currentBounds.x,
        y: currentBounds.y,
        width: currentBounds.width,
        height: currentBounds.height,
    };
}
export function shouldAcceptWindowDragStart(activeSource, _nextSource) {
    return activeSource === undefined;
}
export function shouldApplyWindowDragMove(activeSource, source) {
    return activeSource === source;
}
