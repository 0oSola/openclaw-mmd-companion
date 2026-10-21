export type PetInteractionMode = "window-drag" | "camera-adjust";
export const PET_WINDOW_DRAG_MAX_MOVE_PX = 6;

type PetPoint = { x: number; y: number };

export function hasPetPointerMoved({
  origin,
  current,
  maxMovePx = PET_WINDOW_DRAG_MAX_MOVE_PX,
}: {
  origin: PetPoint;
  current: PetPoint;
  maxMovePx?: number;
}): boolean {
  return Math.hypot(current.x - origin.x, current.y - origin.y) > maxMovePx;
}

export function shouldStartPetWindowDrag({
  interactionMode,
  button,
}: {
  interactionMode: PetInteractionMode;
  button: number;
}): boolean {
  return interactionMode === "window-drag" && button === 0;
}

export function shouldActivatePetWindowDrag({
  interactionMode,
  button,
  moved,
}: {
  interactionMode: PetInteractionMode;
  button: number;
  moved: boolean;
}): boolean {
  return moved && shouldStartPetWindowDrag({ interactionMode, button });
}

export function shouldStopPetWindowDragPropagation({
  eventType,
  dragActive,
}: {
  eventType: "pointerdown" | "pointermove" | "pointerup" | "pointercancel";
  dragActive: boolean;
}): boolean {
  return dragActive && eventType === "pointermove";
}
