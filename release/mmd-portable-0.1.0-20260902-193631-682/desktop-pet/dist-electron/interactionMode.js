export const INTERACTION_MODES = ["window-drag", "camera-adjust"];
export const DEFAULT_INTERACTION_MODE = "window-drag";
export const INTERACTION_MODE_LABELS = {
    "window-drag": "Drag Whole App",
    "camera-adjust": "Adjust Camera",
};
export function normalizeInteractionMode(value) {
    return INTERACTION_MODES.includes(value)
        ? value
        : DEFAULT_INTERACTION_MODE;
}
export function shouldOpenPetContextMenu(interactionMode) {
    return interactionMode !== "camera-adjust";
}
