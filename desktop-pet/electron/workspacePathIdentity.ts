import path from "node:path";

function trimTrailingSeparators(value: string, root: string): string {
  return value === root ? value : value.replace(/\/+$/, "");
}

export function normalizeWorkspacePathIdentity(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "";

  const slashPath = trimmed.replace(/\\/g, "/");
  const wslMount = slashPath.match(/^\/mnt\/([a-z])(?:\/(.*))?$/i);
  if (wslMount) {
    const drive = wslMount[1].toLowerCase();
    const tail = path.posix.normalize(`/${wslMount[2] ?? ""}`).replace(/^\/+/, "");
    return tail ? `${drive}:/${tail}`.replace(/\/+$/, "").toLowerCase() : `${drive}:/`;
  }

  if (/^[a-z]:(?:[\\/]|$)/i.test(trimmed) || /^[\\/]{2}/.test(trimmed) || trimmed.includes("\\")) {
    const normalized = path.win32.normalize(trimmed).replace(/\\/g, "/");
    const root = path.win32.parse(path.win32.normalize(trimmed)).root.replace(/\\/g, "/");
    return trimTrailingSeparators(normalized, root).toLowerCase();
  }

  const normalized = path.posix.normalize(trimmed);
  return trimTrailingSeparators(normalized, path.posix.parse(normalized).root);
}

export function isSameWorkspacePath(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const leftIdentity = normalizeWorkspacePathIdentity(left);
  return Boolean(leftIdentity) && leftIdentity === normalizeWorkspacePathIdentity(right);
}
