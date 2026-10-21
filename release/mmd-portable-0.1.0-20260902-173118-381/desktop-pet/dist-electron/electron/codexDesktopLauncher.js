export function buildCodexDesktopNewThreadUrl(options) {
    const workspacePath = options.workspacePath.trim();
    if (!workspacePath)
        throw new Error("Workspace path is required");
    const url = new URL("codex://new");
    url.searchParams.set("path", workspacePath);
    const prompt = options.prompt?.trim();
    if (prompt)
        url.searchParams.set("prompt", prompt);
    return url.toString();
}
async function openExternalWithElectron(url) {
    const { shell } = await import("electron");
    await shell.openExternal(url);
}
export async function launchNewCodexDesktopUnboundSession(options = {}) {
    const url = "codex://threads/new";
    await (options.openExternal ?? openExternalWithElectron)(url);
    return { url };
}
export async function launchNewCodexDesktopSession(options) {
    const workspacePath = options.workspacePath.trim();
    const url = buildCodexDesktopNewThreadUrl({
        workspacePath,
        prompt: options.prompt,
    });
    await (options.openExternal ?? openExternalWithElectron)(url);
    return { workspacePath, url };
}
