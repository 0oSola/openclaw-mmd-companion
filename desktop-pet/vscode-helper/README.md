# MMD Codex Pet VSCode Helper

This helper extension runs desktop-pet Codex requests inside a VSCode integrated terminal named `Codex Pet`.

For each new or resumed Codex session, desktop-pet creates a unique temporary
workspace bundle:

```text
<os.tmpdir()>/mmd-codex-pet/vscode-workspaces/<launch-id>/session.code-workspace
<os.tmpdir()>/mmd-codex-pet/vscode-workspaces/<launch-id>/.codex-pet/vscode-terminal-request.json
<os.tmpdir()>/mmd-codex-pet/vscode-workspaces/<launch-id>/.codex-pet/vscode-terminal-ack.json
```

The request contains the real `workspacePath`, `targetWorkspaceFilePath`, an
`ackPath`, and a short `expiresAt`. The helper derives its own
`vscode.workspace.workspaceFile`, consumes only a matching scoped request, and
creates or reuses the integrated terminal. Windows mode runs `codex` or
`codex resume --cd <workspace> <session_id>` directly. WSL mode sends an
explicit `wsl.exe --cd <workspace> --exec codex ...` bridge command; resume uses
`--cd .` after WSL has entered the workspace. After `sendText`, it writes the
matching ACK and only then deletes the request. This prevents unrelated VSCode
windows that also have the helper loaded from stealing the request. Legacy
workspace/global request scanning remains read-compatible, but current Pet
launches do not write those singleton files.

## Development Mode

This is the default mode. desktop-pet starts VSCode with:

```text
code --new-window --skip-add-to-recently-opened --extensionDevelopmentPath <desktop-pet/vscode-helper> <session.code-workspace>
```

Use this while developing the helper or running from the repo. Development mode
reuses the default VSCode profile/main process while the unique workspace-file
URI creates a separate window. This also avoids starting a second VSCode main
process that can be blocked by the Windows updater mutex.

## Installed Mode

For regular use, install the helper once:

```powershell
desktop-pet/scripts/install-vscode-helper.ps1 -Force
```

Then start desktop-pet with:

```powershell
$env:MMD_PET_VSCODE_HELPER_MODE = "installed"
```

In installed mode, desktop-pet opens VSCode without `--extensionDevelopmentPath`.
New and resume requests open the target workspace in a new VSCode window:

```text
code --new-window --skip-add-to-recently-opened <session.code-workspace>
```

The installed extension is responsible for reading the pending terminal request.
If the helper is not installed or disabled, VSCode still opens the workspace,
but Pet will keep the status at starting/resuming and report a failed launch if
the scoped ACK does not arrive before the request expires.

## Diagnostics

The helper writes a VSCode output channel named `MMD Codex Pet Helper`. It logs
activation, workspace-folder visibility, and terminal request handling. The
corresponding file appears under VSCode's `logs/**/exthost/output_logging_*`
directory.

## Environment

- `MMD_PET_VSCODE_HELPER_MODE=development|installed`
- `MMD_PET_VSCODE_CLI` overrides the `code` executable.
- `MMD_PET_VSCODE_HELPER_EXTENSION_PATH` overrides the development helper path.
- `MMD_PET_CODEX_CLI` overrides the terminal command, defaulting to `codex`.
- `MMD_PET_WSL_EXEC` overrides the WSL bridge executable, defaulting to `wsl.exe`.
- `MMD_PET_WSL_CODEX_CLI` overrides the Codex executable inside WSL, defaulting to `codex`.
