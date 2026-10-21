param(
  [ValidateSet("build", "start", "stop", "status")]
  [string]$Action = "start",
  [int]$ApiPort = 8200,
  [int]$WebPort = 3200,
  [string]$ApiHost = "127.0.0.1",
  [string]$WebHost = "127.0.0.1",
  [string]$ApiBaseUrl = "",
  [string]$ApiDataDir = "",
  [string]$UserId = "admin-1",
  [string]$WorkspacePath = "",
  [switch]$SkipBuild,
  [switch]$NoDebugEvents,
  [int]$PetReadyTimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptPath = Join-Path $projectRoot "scripts\release-stack.ps1"
if (-not (Test-Path -LiteralPath $scriptPath)) {
  throw "Missing script: $scriptPath"
}

$forwardedArguments = @(
  "-Action", $Action,
  "-ApiPort", [string]$ApiPort,
  "-WebPort", [string]$WebPort,
  "-ApiHost", $ApiHost,
  "-WebHost", $WebHost,
  "-UserId", $UserId,
  "-PetReadyTimeoutSeconds", [string]$PetReadyTimeoutSeconds
)
if ($ApiBaseUrl) { $forwardedArguments += @("-ApiBaseUrl", $ApiBaseUrl) }
if ($ApiDataDir) { $forwardedArguments += @("-ApiDataDir", $ApiDataDir) }
if ($WorkspacePath) { $forwardedArguments += @("-WorkspacePath", $WorkspacePath) }
if ($SkipBuild) { $forwardedArguments += "-SkipBuild" }
if ($NoDebugEvents) { $forwardedArguments += "-NoDebugEvents" }

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath @forwardedArguments

exit $LASTEXITCODE
