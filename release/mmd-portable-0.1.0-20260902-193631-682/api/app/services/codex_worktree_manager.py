from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import shutil
import subprocess


class CodexWorktreeError(RuntimeError):
    pass


@dataclass(frozen=True)
class CodexWorktree:
    worktree_path: Path
    branch_name: str


@dataclass(frozen=True)
class CodexDiff:
    changed_files: list[str]
    stat: str
    patch: str


@dataclass(frozen=True)
class CodexApplyResult:
    applied: bool
    changed_files: list[str]
    patch: str


_SAFE_SESSION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$")


class CodexWorktreeManager:
    def __init__(self, *, worktree_root: Path, branch_prefix: str = "codex/"):
        self.worktree_root = Path(worktree_root).resolve()
        self.branch_prefix = branch_prefix or "codex/"

    def create_worktree(self, workspace_path: Path, session_id: str) -> CodexWorktree:
        workspace = Path(workspace_path).resolve()
        self._require_safe_session_id(session_id)
        self._require_git_repo(workspace)
        self.worktree_root.mkdir(parents=True, exist_ok=True)
        worktree_path = (self.worktree_root / session_id).resolve()
        self._require_under(worktree_path, self.worktree_root, "worktree path escapes configured root")
        if worktree_path.exists():
            raise CodexWorktreeError(f"Codex worktree already exists: {worktree_path}")

        branch_name = f"{self.branch_prefix}{session_id}"
        self._git(workspace, "worktree", "add", "-b", branch_name, str(worktree_path), "HEAD")
        return CodexWorktree(worktree_path=worktree_path, branch_name=branch_name)

    def diff(self, worktree_path: Path) -> CodexDiff:
        worktree = Path(worktree_path).resolve()
        self._require_git_repo(worktree)
        changed_files = self._changed_files(worktree)
        if not changed_files:
            return CodexDiff(changed_files=[], stat="", patch="")

        untracked = self._untracked_files(worktree)
        self._mark_untracked_intent_to_add(worktree, untracked)
        try:
            stat = self._git(worktree, "diff", "--stat", "HEAD", "--").stdout
            patch = self._git(worktree, "diff", "--binary", "HEAD", "--").stdout
        finally:
            self._clear_untracked_intent_to_add(worktree, untracked)
        return CodexDiff(changed_files=changed_files, stat=stat, patch=patch)

    def apply_patch_to_workspace(self, worktree_path: Path, workspace_path: Path, *, confirm: bool) -> CodexApplyResult:
        if not confirm:
            raise CodexWorktreeError("Codex apply requires explicit confirmation")

        workspace = Path(workspace_path).resolve()
        self._require_git_repo(workspace)
        if self.is_dirty(workspace):
            raise CodexWorktreeError("Cannot apply Codex patch because main workspace has uncommitted changes")

        diff = self.diff(worktree_path)
        if not diff.patch.strip():
            raise CodexWorktreeError("Cannot apply Codex patch because the session has no diff")

        self._git(workspace, "apply", "--check", input_text=diff.patch)
        self._git(workspace, "apply", input_text=diff.patch)
        return CodexApplyResult(applied=True, changed_files=diff.changed_files, patch=diff.patch)

    def discard_worktree(self, workspace_path: Path, worktree_path: Path) -> None:
        workspace = Path(workspace_path).resolve()
        worktree = Path(worktree_path).resolve()
        self._require_under(worktree, self.worktree_root, "worktree cleanup path escapes configured root")
        try:
            self._git(workspace, "worktree", "remove", "--force", str(worktree))
        except CodexWorktreeError:
            if worktree.exists():
                shutil.rmtree(worktree)

    def is_dirty(self, workspace_path: Path) -> bool:
        workspace = Path(workspace_path).resolve()
        result = self._git(workspace, "status", "--porcelain").stdout
        return bool(result.strip())

    def _changed_files(self, worktree: Path) -> list[str]:
        output = self._git(worktree, "status", "--porcelain").stdout
        changed: list[str] = []
        for raw_line in output.splitlines():
            if len(raw_line) < 4:
                continue
            path = raw_line[3:]
            if " -> " in path:
                path = path.rsplit(" -> ", 1)[1]
            changed.append(path.strip('"'))
        return sorted(dict.fromkeys(changed))

    def _untracked_files(self, worktree: Path) -> list[str]:
        output = self._git(worktree, "status", "--porcelain").stdout
        return [line[3:].strip('"') for line in output.splitlines() if line.startswith("?? ")]

    def _mark_untracked_intent_to_add(self, worktree: Path, paths: list[str]) -> None:
        if paths:
            self._git(worktree, "add", "--intent-to-add", "--", *paths)

    def _clear_untracked_intent_to_add(self, worktree: Path, paths: list[str]) -> None:
        if paths:
            self._git(worktree, "reset", "--", *paths)

    def _require_safe_session_id(self, session_id: str) -> None:
        if not _SAFE_SESSION_ID.match(session_id):
            raise CodexWorktreeError("Invalid Codex session id")

    def _require_git_repo(self, path: Path) -> None:
        if not path.exists():
            raise CodexWorktreeError(f"Git workspace does not exist: {path}")
        self._git(path, "rev-parse", "--show-toplevel")

    @staticmethod
    def _require_under(path: Path, root: Path, message: str) -> None:
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise CodexWorktreeError(message) from exc

    @staticmethod
    def _git(repo: Path, *args: str, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            ["git", "-C", str(repo), *args],
            input=input_text,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "git command failed").strip()
            raise CodexWorktreeError(detail)
        return result
