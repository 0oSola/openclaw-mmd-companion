type OpenExternal = (url: string) => Promise<void>;

export type CodexDesktopLaunchResult = {
  workspacePath?: string;
  codexSessionId?: string;
  url: string;
};

export function buildCodexDesktopNewThreadUrl(options: {
  workspacePath: string;
  prompt?: string;
}): string {
  const workspacePath = options.workspacePath.trim();
  if (!workspacePath) throw new Error("Workspace path is required");

  const url = new URL("codex://new");
  url.searchParams.set("path", workspacePath);
  const prompt = options.prompt?.trim();
  if (prompt) url.searchParams.set("prompt", prompt);
  return url.toString();
}

export function buildCodexDesktopThreadUrl(codexSessionId: string): string {
  const sessionId = codexSessionId.trim();
  if (!sessionId) throw new Error("Codex session ID is required");
  return `codex://threads/${encodeURIComponent(sessionId)}`;
}

async function openExternalWithElectron(url: string): Promise<void> {
  const { shell } = await import("electron");
  await shell.openExternal(url);
}

export async function launchNewCodexDesktopUnboundSession(
  options: { openExternal?: OpenExternal } = {},
): Promise<{ url: string }> {
  const url = "codex://threads/new";
  await (options.openExternal ?? openExternalWithElectron)(url);
  return { url };
}

export async function launchNewCodexDesktopSession(options: {
  workspacePath: string;
  prompt?: string;
  openExternal?: OpenExternal;
}): Promise<CodexDesktopLaunchResult> {
  const workspacePath = options.workspacePath.trim();
  const url = buildCodexDesktopNewThreadUrl({
    workspacePath,
    prompt: options.prompt,
  });
  await (options.openExternal ?? openExternalWithElectron)(url);
  return { workspacePath, url };
}

export async function launchCodexDesktopExistingSession(options: {
  codexSessionId: string;
  openExternal?: OpenExternal;
}): Promise<CodexDesktopLaunchResult> {
  const codexSessionId = options.codexSessionId.trim();
  const url = buildCodexDesktopThreadUrl(codexSessionId);
  await (options.openExternal ?? openExternalWithElectron)(url);
  return { codexSessionId, url };
}
