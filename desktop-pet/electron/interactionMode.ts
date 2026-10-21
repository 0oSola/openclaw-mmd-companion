export const INTERACTION_MODES = ["window-drag", "camera-adjust"] as const;

export type PetInteractionMode = (typeof INTERACTION_MODES)[number];

export const DEFAULT_INTERACTION_MODE: PetInteractionMode = "window-drag";

export const INTERACTION_MODE_LABELS: Record<PetInteractionMode, string> = {
  "window-drag": "Drag Whole App",
  "camera-adjust": "Adjust Camera",
};

export function normalizeInteractionMode(value: unknown): PetInteractionMode {
  return INTERACTION_MODES.includes(value as PetInteractionMode)
    ? (value as PetInteractionMode)
    : DEFAULT_INTERACTION_MODE;
}

export function shouldOpenPetContextMenu(interactionMode: PetInteractionMode): boolean {
  return interactionMode !== "camera-adjust";
}
