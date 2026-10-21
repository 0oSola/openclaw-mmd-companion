param(
  [ValidateSet("start", "stop", "status")]
  [string]$Action = "start",
  [int]$ApiPort = 8100,
  [int]$WebPort = 3100,
  [string]$AdminUserIds = "admin-1,sola",
  [ValidateSet("win", "wsl")]
  [string]$RunEnv = "win"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptPath = Join-Path $projectRoot "scripts\dev-stack.ps1"

if (-not (Test-Path $scriptPath)) {
  throw "Missing script: $scriptPath"
}

powershell -ExecutionPolicy Bypass -File $scriptPath `
  -Action $Action `
  -ApiPort $ApiPort `
  -WebPort $WebPort `
  -AdminUserIds $AdminUserIds `
  -RunEnv $RunEnv

exit $LASTEXITCODE
