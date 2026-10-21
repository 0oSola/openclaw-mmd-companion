param(
  [int]$Port = 5174,
  [string]$ApiBaseUrl = "",
  [string]$WorkspacePath = "",
  [switch]$ReuseExisting,
  [switch]$ForceNew,
  [switch]$NoDebugEvents,
  [int]$RemoteDebuggingPort = 0
)

$ErrorActionPreference = "Stop"

$petRoot = $PSScriptRoot
$projectRoot = Split-Path -Parent $petRoot
$logsDir = Join-Path $petRoot ".codex-pet\logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

if ($ReuseExisting -and $ForceNew) {
  throw "-ReuseExisting and -ForceNew cannot be used together."
}

function Get-NpmCommand {
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($npm) { return $npm.Source }
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if ($npm) { return $npm.Source }
  throw "npm was not found on PATH."
}

function Test-HttpReady([string]$url) {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Wait-HttpReady([string]$url, [int]$timeoutSeconds = 30) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  do {
    if (Test-HttpReady $url) { return $true }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Read-EnvValue([string]$path, [string]$key) {
  if (-not (Test-Path -LiteralPath $path)) { return "" }
  $line = Get-Content -LiteralPath $path | Where-Object {
    $_ -match "^$key=" -and $_ -notmatch '^\s*#'
  } | Select-Object -First 1
  if (-not $line) { return "" }
  return ($line -split "=", 2)[1].Trim().Trim('"').Trim("'")
}

function Resolve-KnowledgeHandoffToken {
  $token = $env:MMD_PET_KNOWLEDGE_HANDOFF_TOKEN
  if ($token) { return $token }
  return Read-EnvValue (Join-Path $projectRoot "api\.env") "CODEX_AUTHOR_KNOWLEDGE_HANDOFF_TOKEN"
}

function Resolve-DefaultApiBaseUrl([string]$explicitApiBaseUrl) {
  if ($explicitApiBaseUrl) { return $explicitApiBaseUrl }
  if ($env:MMD_PET_API_BASE_URL) { return $env:MMD_PET_API_BASE_URL }

  $devStackStatePath = Join-Path $projectRoot ".runtime\dev-stack.json"
  if (Test-Path -LiteralPath $devStackStatePath) {
    try {
      $state = Get-Content -Path $devStackStatePath -Raw | ConvertFrom-Json
      $stateApiUrl = [string]$state.api.url
      if ($stateApiUrl -and (Test-HttpReady "$stateApiUrl/healthz")) {
        return $stateApiUrl
      }
    } catch {
    }
  }

  return "http://127.0.0.1:8000"
}

function Quote-PowerShellString([string]$value) {
  return "'" + $value.Replace("'", "''") + "'"
}

function Start-HiddenPowerShell([string]$command, [string]$logPath) {
  $wrappedCommand = "& { " + $command + " } *> " + (Quote-PowerShellString $logPath)
  return Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $wrappedCommand
  ) -WorkingDirectory $petRoot -WindowStyle Hidden -PassThru
}

function Get-DesktopPetMainProcesses {
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -eq "electron.exe" -and
      $_.CommandLine -match 'desktop-pet\\node_modules\\electron\\dist\\electron\.exe" \.' -and
      $_.CommandLine -notmatch '--type='
    }
}

function Get-DesktopPetMainProcess {
  Get-DesktopPetMainProcesses | Select-Object -First 1
}

function Stop-DesktopPetMainProcesses([object[]]$processes) {
  $stoppedIds = @()
  foreach ($process in $processes) {
    $processId = [int]$process.ProcessId
    if ($processId -le 0) { continue }
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    $stoppedIds += $processId
  }
  foreach ($processId in $stoppedIds) {
    Wait-Process -Id $processId -Timeout 8 -ErrorAction SilentlyContinue
  }
  return $stoppedIds
}

$existingPets = @(Get-DesktopPetMainProcesses)
$existingPet = $existingPets | Select-Object -First 1

if ($existingPet -and $ReuseExisting) {
  Write-Output "status=already-running"
  Write-Output "electronPid=$($existingPet.ProcessId)"
  Write-Output "rendererUrl="
  Write-Output "logsDir=$logsDir"
  return
}

if ($existingPets.Count -gt 0 -and -not $ForceNew) {
  Write-Output "status=restarting"
  $stoppedElectronPids = @(Stop-DesktopPetMainProcesses $existingPets)
  Write-Output "stoppedElectronPids=$($stoppedElectronPids -join ',')"
}

$npm = Get-NpmCommand
$electronExe = Join-Path $petRoot "node_modules\electron\dist\electron.exe"
if (-not (Test-Path -LiteralPath $electronExe)) {
  throw "Electron was not found under node_modules. Run npm install in $petRoot first."
}

$rendererUrl = "http://127.0.0.1:$Port"
$rendererLog = Join-Path $logsDir "renderer.log"
$electronOutLog = Join-Path $logsDir "electron.out.log"
$electronErrLog = Join-Path $logsDir "electron.err.log"
$debugEventsLog = Join-Path $petRoot "desktop-pet-debug-events.ndjson"
$resolvedApiBaseUrl = Resolve-DefaultApiBaseUrl $ApiBaseUrl

$rendererProcess = $null
if (-not (Test-HttpReady $rendererUrl)) {
  # Start the renderer with npm run dev in a hidden background process.
  $rendererCommand = @(
    "`$env:MMD_PET_DEV_PORT = '$Port'",
    "Set-Location -LiteralPath $(Quote-PowerShellString $petRoot)",
    "& $(Quote-PowerShellString $npm) run dev"
  ) -join "; "
  $rendererProcess = Start-HiddenPowerShell $rendererCommand $rendererLog
}

if (-not (Wait-HttpReady $rendererUrl 35)) {
  throw "desktop-pet renderer did not become ready at $rendererUrl. See $rendererLog."
}

$previousRendererUrl = $env:MMD_PET_RENDERER_URL
$previousDebugEvents = $env:MMD_PET_DEBUG_EVENTS
$previousDebugEventsLog = $env:MMD_PET_DEBUG_EVENTS_LOG
$previousApiBaseUrl = $env:MMD_PET_API_BASE_URL
$previousWorkspacePath = $env:MMD_PET_WORKSPACE_PATH
$previousRemoteDebuggingPort = $env:MMD_PET_REMOTE_DEBUGGING_PORT
$previousKnowledgeTransport = $env:MMD_PET_KNOWLEDGE_HANDOFF_TRANSPORT_ENABLED
$previousKnowledgeToken = $env:MMD_PET_KNOWLEDGE_HANDOFF_TOKEN

try {
  $env:MMD_PET_RENDERER_URL = $rendererUrl
  if (-not $NoDebugEvents) {
    $env:MMD_PET_DEBUG_EVENTS = "1"
    $env:MMD_PET_DEBUG_EVENTS_LOG = $debugEventsLog
  }
  if ($resolvedApiBaseUrl) {
    $env:MMD_PET_API_BASE_URL = $resolvedApiBaseUrl
  }
  if ($WorkspacePath) {
    $env:MMD_PET_WORKSPACE_PATH = $WorkspacePath
  }
  if ($RemoteDebuggingPort -gt 0) {
    $env:MMD_PET_REMOTE_DEBUGGING_PORT = [string]$RemoteDebuggingPort
  }
  $knowledgeToken = Resolve-KnowledgeHandoffToken
  if ($knowledgeToken) {
    $env:MMD_PET_KNOWLEDGE_HANDOFF_TRANSPORT_ENABLED = "1"
    $env:MMD_PET_KNOWLEDGE_HANDOFF_TOKEN = $knowledgeToken
  }

  # Keep the Electron GUI visible; -WindowStyle Hidden can suppress the pet BrowserWindow.
  $electronProcess = Start-Process -FilePath $electronExe -ArgumentList "." -WorkingDirectory $petRoot -PassThru `
    -RedirectStandardOutput $electronOutLog -RedirectStandardError $electronErrLog
} finally {
  $env:MMD_PET_RENDERER_URL = $previousRendererUrl
  $env:MMD_PET_DEBUG_EVENTS = $previousDebugEvents
  $env:MMD_PET_DEBUG_EVENTS_LOG = $previousDebugEventsLog
  $env:MMD_PET_API_BASE_URL = $previousApiBaseUrl
  $env:MMD_PET_WORKSPACE_PATH = $previousWorkspacePath
  $env:MMD_PET_REMOTE_DEBUGGING_PORT = $previousRemoteDebuggingPort
  $env:MMD_PET_KNOWLEDGE_HANDOFF_TRANSPORT_ENABLED = $previousKnowledgeTransport
  $env:MMD_PET_KNOWLEDGE_HANDOFF_TOKEN = $previousKnowledgeToken
}

Write-Output "status=started"
Write-Output "rendererUrl=$rendererUrl"
Write-Output "apiBaseUrl=$resolvedApiBaseUrl"
Write-Output "rendererPid=$(if ($rendererProcess) { $rendererProcess.Id } else { '' })"
Write-Output "electronPid=$($electronProcess.Id)"
Write-Output "debugEventsLog=$(if ($NoDebugEvents) { '' } else { $debugEventsLog })"
Write-Output "logsDir=$logsDir"
