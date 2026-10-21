export function applyPetAlwaysOnTop(window, enabled) {
    if (enabled) {
        window.setAlwaysOnTop(true, "floating");
        return;
    }
    window.setAlwaysOnTop(false);
}
