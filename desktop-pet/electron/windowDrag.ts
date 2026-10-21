import type { Rectangle } from "electron";

import type { ScreenPoint } from "./contextMenuPosition.js";

export type WindowDragSource = "ipc" | "native";

export type WindowDragSnapshot = {
  originBounds: Rectangle;
  originCursor: ScreenPoint;
  currentCursor: ScreenPoint;
};

export type WindowDragSession = {
  originBounds: Rectangle;
  originCursor: ScreenPoint;
  source: WindowDragSource;
};

export function calculateDraggedWindowPosition(snapshot: WindowDragSnapshot): ScreenPoint {
  return {
    x: Math.round(snapshot.originBounds.x + snapshot.currentCursor.x - snapshot.originCursor.x),
    y: Math.round(snapshot.originBounds.y + snapshot.currentCursor.y - snapshot.originCursor.y),
  };
}

export function calculateDraggedWindowBounds(snapshot: WindowDragSnapshot): Rectangle {
  return {
    ...calculateDraggedWindowPosition(snapshot),
    width: snapshot.originBounds.width,
    height: snapshot.originBounds.height,
  };
}

export function calculateEndedWindowDragBounds({
  currentBounds,
  originBounds: _originBounds,
}: {
  currentBounds: Rectangle;
  originBounds: Rectangle;
}): Rectangle {
  return {
    x: currentBounds.x,
    y: currentBounds.y,
    width: currentBounds.width,
    height: currentBounds.height,
  };
}

export function shouldAcceptWindowDragStart(
  activeSource: WindowDragSource | undefined,
  _nextSource: WindowDragSource,
): boolean {
  return activeSource === undefined;
}

export function shouldApplyWindowDragMove(
  activeSource: WindowDragSource | undefined,
  source: WindowDragSource,
): boolean {
  return activeSource === source;
}
