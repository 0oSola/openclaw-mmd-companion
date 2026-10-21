[CmdletBinding()]
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

$script:ProjectRoot = Split-Path -Parent $PSScriptRoot
$script:RuntimeRoot = Join-Path $script:ProjectRoot ".runtime\release-stack"
$script:StateFile = Join-Path $script:ProjectRoot ".runtime\release-stack.json"
$script:WebRoot = Join-Path $script:ProjectRoot "web"
$script:PetRoot = Join-Path $script:ProjectRoot "desktop-pet"
$script:ApiRoot = Join-Path $script:ProjectRoot "api"
$script:WebDistDir = ".next-codex-release"

function Write-Info([string]$Message) { Write-Host "[INFO] $Message" }
function Write-WarnLine([string]$Message) { Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-ErrorLine([string]$Message) { Write-Host "[ERROR] $Message" -ForegroundColor Red }

function Resolve-CommandPath([string[]]$Names, [string]$Description) {
  foreach ($name in $Names) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command -and $command.Source) { return $command.Source }
  }
  throw "未找到 $Description。请安装 Node.js（含 npm）并将其加入 PATH，然后重试。"
}

function Resolve-PythonExe {
  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python -and $python.Source -and $python.Source -notmatch "WindowsApps\\python(?:3)?(?:\.exe)?$") {
    return $python.Source
  }
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py -and $py.Source) {
    try {
      $resolved = & $py.Source -c "import sys; print(sys.executable)"
      if ($LASTEXITCODE -eq 0) {
        $resolved = ($resolved | Select-Object -First 1).Trim()
        if ($resolved -and (Test-Path -LiteralPath $resolved) -and $resolved -notmatch "WindowsApps\\python(?:3)?(?:\.exe)?$") {
          return $resolved
        }
      }
    } catch { }
  }
  $searchRoots = @(
    (Join-Path $env:LocalAppData "Programs\Python"),
    "C:\Program Files\Python",
    "C:\Python"
  )
  foreach ($root in $searchRoots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $candidates = Get-ChildItem -LiteralPath $root -Recurse -Filter python.exe -File -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notmatch "WindowsApps\\python(?:3)?(?:\.exe)?$" } |
      Sort-Object FullName -Descending
    if ($candidates) { return $candidates[0].FullName }
  }
  throw "未找到可用 Python。请安装 Python 3.11+ 并将其加入 PATH，然后重试。"
}

function Resolve-DataDirectory([string]$Candidate) {
  if ([string]::IsNullOrWhiteSpace($Candidate)) {
    throw "API data directory cannot be empty when explicitly configured."
  }
  if ([System.IO.Path]::IsPathRooted($Candidate)) {
    return [System.IO.Path]::GetFullPath($Candidate)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $script:ProjectRoot $Candidate))
}

function Test-GitLfsPointer([string]$DatabasePath) {
  if (-not (Test-Path -LiteralPath $DatabasePath -PathType Leaf)) { return $false }
  $reader = $null
  try {
    $reader = [System.IO.StreamReader]::new(
      $DatabasePath,
      [System.Text.Encoding]::UTF8,
      $true,
      256
    )
    $prefix = $reader.ReadToEnd()
    return $prefix -match '(?m)^version https://git-lfs\.github\.com/spec/v1\s*$'
  } catch {
    return $false
  } finally {
    if ($reader) { $reader.Dispose() }
  }
}

function Test-SqliteDatabaseFile([string]$DatabasePath) {
  if (-not (Test-Path -LiteralPath $DatabasePath -PathType Leaf)) { return $false }
  $stream = $null
  try {
    $stream = [System.IO.File]::OpenRead($DatabasePath)
    $header = [byte[]]::new(16)
    $read = $stream.Read($header, 0, $header.Length)
    if ($read -ne 16 -or [System.Text.Encoding]::ASCII.GetString($header) -ne ("SQLite format 3" + [char]0)) {
      return $false
    }
  } catch {
    return $false
  } finally {
    if ($stream) { $stream.Dispose() }
  }

  try {
    $python = Resolve-PythonExe
    $probe = @'
import sqlite3
import sys

try:
    connection = sqlite3.connect(sys.argv[1])
    connection.execute("PRAGMA schema_version").fetchone()
    connection.close()
except (OSError, sqlite3.Error):
    raise SystemExit(1)
raise SystemExit(0)
'@
    & $python -c $probe $DatabasePath *> $null
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
    return $exitCode -eq 0
  } catch {
    return $false
  }
}

function Resolve-ReleaseApiDataDir(
  [string]$ConfiguredParameter,
  [bool]$ParameterWasProvided,
  [string]$ConfiguredEnvironment
) {
  if ($ParameterWasProvided) {
    return Resolve-DataDirectory $ConfiguredParameter
  }
  if (-not [string]::IsNullOrWhiteSpace($ConfiguredEnvironment)) {
    return Resolve-DataDirectory $ConfiguredEnvironment
  }

  $defaultDataDir = Resolve-DataDirectory "api/data"
  $defaultDatabasePath = Join-Path $defaultDataDir "sqlite\trace.db"
  if (Test-SqliteDatabaseFile $defaultDatabasePath) {
    return $defaultDataDir
  }

  $fallbackDataDir = Resolve-DataDirectory ".runtime\release-stack\data"
  New-Item -ItemType Directory -Force -Path @(
    $fallbackDataDir,
    (Join-Path $fallbackDataDir "sqlite"),
    (Join-Path $fallbackDataDir "logs")
  ) | Out-Null
  $reason = if (Test-GitLfsPointer $defaultDatabasePath) {
    "the default trace.db is a Git LFS pointer"
  } elseif (-not (Test-Path -LiteralPath $defaultDatabasePath -PathType Leaf)) {
    "the default trace.db is missing"
  } else {
    "the default trace.db is not a valid SQLite database"
  }
  Write-WarnLine "Default API data directory is unusable because $reason; using fallback $fallbackDataDir."
  return $fallbackDataDir
}

function Resolve-NpmCommand { return Resolve-CommandPath @('npm.cmd', 'npm') "npm（Node.js 包管理器）" }
function Resolve-NodeExe { return Resolve-CommandPath @('node.exe', 'node') "Node.js" }

function Invoke-CheckedCommand(
  [string]$FilePath,
  [string[]]$Arguments,
  [string]$WorkingDirectory
) {
  $displayArguments = ($Arguments | ForEach-Object { [string]$_ }) -join " "
  Write-Info "Running: $FilePath $displayArguments"
  Push-Location -LiteralPath $WorkingDirectory
  try {
    & $FilePath @Arguments
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
  } finally {
    Pop-Location
  }
  if ($exitCode -ne 0) {
    throw "Command failed with exit code ${exitCode}: $FilePath $displayArguments"
  }
}

function Invoke-WithEnvironment([hashtable]$Values, [scriptblock]$ScriptBlock) {
  $previous = @{}
  foreach ($entry in $Values.GetEnumerator()) {
    $key = [string]$entry.Key
    $previous[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
    [Environment]::SetEnvironmentVariable($key, $entry.Value, "Process")
  }
  try { & $ScriptBlock } finally {
    foreach ($entry in $previous.GetEnumerator()) {
      [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
    }
  }
}

function Normalize-BaseUrl([string]$Value, [string]$Fallback) {
  $candidate = if ($Value) { $Value.Trim() } else { $Fallback }
  try { $uri = [Uri]$candidate } catch { throw "Invalid API base URL: $candidate" }
  if (-not $uri.IsAbsoluteUri -or $uri.Scheme -notin @('http', 'https')) {
    throw "API base URL must be an absolute http(s) URL: $candidate"
  }
  return $candidate.TrimEnd('/')
}

function Resolve-ProbeHost([string]$HostName) {
  if ($HostName -eq "0.0.0.0" -or $HostName -eq "::") { return "127.0.0.1" }
  return $HostName
}

function New-LocalBaseUrl([string]$HostName, [int]$Port) {
  return "http://$(Resolve-ProbeHost $HostName):$Port"
}

function Get-ListeningProcessId([int]$Port) {
  try {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
    return [int]$connection.OwningProcess
  } catch { return $null }
}

function Assert-PortAvailable([int]$Port, [string]$Label) {
  $owner = Get-ListeningProcessId $Port
  if ($owner) {
    $process = Get-Process -Id $owner -ErrorAction SilentlyContinue
    $name = if ($process) { $process.ProcessName } else { "unknown" }
    throw "$Label port $Port is already in use by pid=$owner ($name). Choose another port or stop that service first."
  }
}

function Test-HttpReady([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 400
  } catch { return $false }
}

function Wait-HttpReady([string]$Url, [int]$TimeoutSeconds = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (Test-HttpReady $Url) { return $true }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Read-State {
  if (-not (Test-Path -LiteralPath $script:StateFile)) { return $null }
  try { return Get-Content -LiteralPath $script:StateFile -Raw | ConvertFrom-Json }
  catch { throw "Release stack state file is invalid: $script:StateFile. Preserve it for inspection." }
}

function Write-State($State) {
  $runtimeParent = Split-Path -Parent $script:StateFile
  New-Item -ItemType Directory -Force -Path $runtimeParent | Out-Null
  $temporaryPath = "$($script:StateFile).tmp.$([Guid]::NewGuid().ToString('N'))"
  $json = $State | ConvertTo-Json -Depth 12
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  try {
    [System.IO.File]::WriteAllText($temporaryPath, $json, $utf8NoBom)
    Move-Item -LiteralPath $temporaryPath -Destination $script:StateFile -Force
  } finally {
    if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue }
  }
}

function Get-ProcessSnapshot {
  return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Select-Object ProcessId, ParentProcessId, Name, CommandLine, CreationDate)
}

function Get-ProcessSnapshotById([int]$ProcessId) {
  if ($ProcessId -le 0) { return $null }
  return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
}

function Test-CommandSignature($Process, $Record) {
  if ($null -eq $Process) { return $false }
  $signature = [string]$Record.command_signature
  if (-not $signature) { return $true }
  return ([string]$Process.CommandLine).IndexOf($signature, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Get-ProcessDescendants([int]$RootPid, [object[]]$Snapshot) {
  $childrenByParent = @{}
  foreach ($process in $Snapshot) {
    $parentPid = [int]$process.ParentProcessId
    if (-not $childrenByParent.ContainsKey($parentPid)) { $childrenByParent[$parentPid] = @() }
    $childrenByParent[$parentPid] += ,$process
  }
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue($RootPid)
  $seen = @{}
  $result = @()
  while ($queue.Count -gt 0) {
    $parentPid = [int]$queue.Dequeue()
    if ($seen.ContainsKey($parentPid)) { continue }
    $seen[$parentPid] = $true
    foreach ($child in @($childrenByParent[$parentPid])) {
      $childPid = [int]$child.ProcessId
      if ($childPid -eq $RootPid -or $seen.ContainsKey($childPid)) { continue }
      $result += ,$child
      $queue.Enqueue($childPid)
    }
  }
  return $result
}

function Get-TrackedProcessState($Record) {
  $process = Get-ProcessSnapshotById ([int]$Record.pid)
  if ($null -eq $process) {
    return [pscustomobject]@{ running = $false; identity_verified = $false; pid = [int]$Record.pid; process_name = [string]$Record.process_name; command_line = ""; descendant_count = 0 }
  }
  $descendants = @(Get-ProcessDescendants ([int]$Record.pid) (Get-ProcessSnapshot))
  return [pscustomobject]@{
    running = $true
    identity_verified = Test-CommandSignature $process $Record
    pid = [int]$Record.pid
    process_name = [string]$process.Name
    command_line = [string]$process.CommandLine
    descendant_count = $descendants.Count
  }
}

function Test-AllowedChildProcess($Record, $Process) {
  $name = ([string]$Process.Name).ToLowerInvariant()
  switch ([string]$Record.kind) {
    "api" { return @('python.exe', 'pythonw.exe', 'cmd.exe', 'conhost.exe') -contains $name }
    "web" { return @('node.exe', 'node', 'cmd.exe', 'conhost.exe') -contains $name }
    "pet" { return @('electron.exe', 'crashpad_handler.exe', 'chrome_crashpad_handler.exe') -contains $name }
    default { return $false }
  }
}

function Stop-ProcessDescendants([int]$ParentPid, [object[]]$Snapshot, $Record) {
  $children = @($Snapshot | Where-Object { [int]$_.ParentProcessId -eq $ParentPid })
  foreach ($child in $children) {
    Stop-ProcessDescendants ([int]$child.ProcessId) $Snapshot $Record
    if (Test-AllowedChildProcess $Record $child) {
      Stop-Process -Id ([int]$child.ProcessId) -Force -ErrorAction SilentlyContinue
    } else {
      Write-WarnLine "Preserving non-runtime child process pid=$($child.ProcessId) name=$($child.Name) under $($Record.kind)."
    }
  }
}

function Stop-TrackedProcessTree($Record) {
  if ($null -eq $Record) { return }
  $rootPid = [int]$Record.pid
  $root = Get-ProcessSnapshotById $rootPid
  if ($null -eq $root) {
    Write-WarnLine "$($Record.kind) process $rootPid is already stopped."
    return
  }
  if (-not (Test-CommandSignature $root $Record)) {
    throw "Refusing to stop pid=${rootPid}: tracked $($Record.kind) command identity no longer matches."
  }
  Stop-ProcessDescendants $rootPid (Get-ProcessSnapshot) $Record
  Stop-Process -Id $rootPid -Force -ErrorAction SilentlyContinue
  try { Wait-Process -Id $rootPid -Timeout 8 -ErrorAction SilentlyContinue } catch { }
  Write-Info "$($Record.kind) process stopped. pid=$rootPid"
}

function New-TrackedProcess(
  [string]$Kind, [string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory,
  [string]$LogOut, [string]$LogErr, [string]$CommandSignature, [string]$Url, [int]$Port,
  [string]$WindowStyle = "Hidden"
) {
  $startParameters = @{
    FilePath = $FilePath
    ArgumentList = $Arguments
    WorkingDirectory = $WorkingDirectory
    RedirectStandardOutput = $LogOut
    RedirectStandardError = $LogErr
    PassThru = $true
  }
  if ($WindowStyle) { $startParameters.WindowStyle = $WindowStyle }
  $process = Start-Process @startParameters
  return [ordered]@{
    kind = $Kind; pid = [int]$process.Id; process_name = [System.IO.Path]::GetFileName($FilePath); executable = $FilePath
    arguments = @($Arguments); working_directory = $WorkingDirectory; command_signature = $CommandSignature
    url = $Url; port = $Port; log_out = $LogOut; log_err = $LogErr; started_at = (Get-Date).ToString("o")
  }
}

function Get-RequiredReleaseArtifacts {
  return @(
    [ordered]@{ label = "Web BUILD_ID"; path = Join-Path $script:WebRoot "$script:WebDistDir\BUILD_ID" },
    [ordered]@{ label = "Pet main renderer"; path = Join-Path $script:PetRoot "dist\index.html" },
    [ordered]@{ label = "Pet menu renderer"; path = Join-Path $script:PetRoot "dist\menu.html" },
    [ordered]@{ label = "Pet notification renderer"; path = Join-Path $script:PetRoot "dist\notification.html" },
    [ordered]@{ label = "Pet Electron main"; path = Join-Path $script:PetRoot "dist-electron\main.js" }
  )
}

function Assert-RequiredReleaseArtifacts {
  $missing = @(Get-RequiredReleaseArtifacts | Where-Object { -not (Test-Path -LiteralPath $_.path) })
  if ($missing.Count -gt 0) {
    $details = ($missing | ForEach-Object { "$($_.label): $($_.path)" }) -join "; "
    throw "Release 产物缺失。请在源码根目录执行 .\\start-mmd.ps1 -Action package，或先完成 Release 构建。缺少：$details"
  }
}

function Assert-ApiEntry([string]$PythonExe, [string]$DataDir) {
  $probe = "import importlib, uvicorn; module = importlib.import_module('app.main'); assert getattr(module, 'app', None) is not None; print('api-entry-ok')"
  Invoke-WithEnvironment @{ API_DATA_DIR = $DataDir } {
    Invoke-CheckedCommand $PythonExe @('-c', $probe) $script:ApiRoot
  }
}

function Invoke-WebReleaseBuild([string]$NpmCommand, [string]$ResolvedApiBaseUrl) {
  $preservedFiles = @()
  foreach ($relativePath in @('web/next-env.d.ts', 'web/tsconfig.json')) {
    $filePath = Join-Path $script:ProjectRoot $relativePath
    if (Test-Path -LiteralPath $filePath) {
      $preservedFiles += [pscustomobject]@{
        path = $filePath
        existed = $true
        bytes = [System.IO.File]::ReadAllBytes($filePath)
      }
    } else {
      $preservedFiles += [pscustomobject]@{ path = $filePath; existed = $false; bytes = $null }
    }
  }
  try {
    Invoke-WithEnvironment @{
      NEXT_PUBLIC_API_BASE_URL = $ResolvedApiBaseUrl
      NEXT_DIST_DIR = $script:WebDistDir
      NODE_ENV = "production"
    } {
      Invoke-CheckedCommand $NpmCommand @('--prefix', $script:WebRoot, 'run', 'build') $script:ProjectRoot
    }
  } finally {
    foreach ($item in $preservedFiles) {
      if ($item.existed) {
        [System.IO.File]::WriteAllBytes($item.path, $item.bytes)
      } elseif (Test-Path -LiteralPath $item.path) {
        Remove-Item -LiteralPath $item.path -Force -ErrorAction SilentlyContinue
      }
    }
  }
}

function Invoke-ReleaseBuild([string]$ResolvedApiBaseUrl, [string]$ResolvedApiDataDir) {
  $python = Resolve-PythonExe
  $npm = Resolve-NpmCommand
  Write-Info "Checking API runtime dependencies and app.main:app entry."
  Assert-ApiEntry $python $ResolvedApiDataDir

  Write-Info "Building Web production bundle with NEXT_DIST_DIR=$script:WebDistDir."
  Invoke-WebReleaseBuild $npm $ResolvedApiBaseUrl

  Write-Info "Building desktop-pet production renderer and Electron main process."
  Invoke-WithEnvironment @{
    MMD_PET_API_BASE_URL = $ResolvedApiBaseUrl
    NEXT_PUBLIC_API_BASE_URL = $ResolvedApiBaseUrl
    NODE_ENV = "production"
  } {
    Invoke-CheckedCommand $npm @('--prefix', $script:PetRoot, 'run', 'build') $script:ProjectRoot
  }

  Assert-RequiredReleaseArtifacts
  Write-Info "Release build completed."
}

function Test-RendererFiles($Record) {
  foreach ($file in @($Record.renderer_files)) {
    if (-not (Test-Path -LiteralPath ([string]$file))) { return $false }
  }
  return $true
}

function Read-PetReadyMarker($Record) {
  $path = [string]$Record.ready_file
  $base = [ordered]@{
    exists = $false
    verified = $false
    path = $path
    renderer_url = ""
    renderer_file = ""
  }
  if (-not $path -or -not (Test-Path -LiteralPath $path)) { return [pscustomobject]$base }
  $base.exists = $true
  try {
    $marker = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    $rendererFile = [string]$marker.rendererFile
    $rendererUrl = [string]$marker.rendererUrl
    $base.renderer_url = $rendererUrl
    $base.renderer_file = $rendererFile
    $base.verified =
      ([int]$marker.pid -eq [int]$Record.pid) -and
      ([string]$marker.mode -eq "release") -and
      ($rendererUrl -like "file:*") -and
      ([bool]$marker.rendererShellReady) -and
      $rendererFile -and
      (Test-Path -LiteralPath $rendererFile)
  } catch { $base.verified = $false }
  return [pscustomobject]$base
}

function Wait-PetEvidence($Record, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastMarker = Read-PetReadyMarker $Record
  do {
    $process = Get-TrackedProcessState $Record
    $lastMarker = Read-PetReadyMarker $Record
    if (-not $process.running) { return [pscustomobject]@{ process = $process; marker = $lastMarker } }
    if ($lastMarker.verified) { return [pscustomobject]@{ process = $process; marker = $lastMarker } }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return [pscustomobject]@{ process = (Get-TrackedProcessState $Record); marker = $lastMarker }
}

function New-ReleaseState(
  [string]$BatchDirectory, [string]$ResolvedApiBaseUrl, [string]$ApiServerUrl, [string]$WebUrl,
  [string]$ResolvedApiDataDir, [string]$PetReadyFile, [string]$PetRendererRoot
) {
  return [ordered]@{
    schema_version = 1
    stack = "release"
    status = "starting"
    started_at = (Get-Date).ToString("o")
    project_root = $script:ProjectRoot
    api_base_url = $ResolvedApiBaseUrl
    api_data_dir = $ResolvedApiDataDir
    api_server_url = $ApiServerUrl
    web_url = $WebUrl
    batch_directory = $BatchDirectory
    artifacts = [ordered]@{
      web_dist_dir = Join-Path $script:WebRoot $script:WebDistDir
      pet_renderer_root = $PetRendererRoot
      pet_renderer_files = @(
        (Join-Path $PetRendererRoot "index.html"),
        (Join-Path $PetRendererRoot "menu.html"),
        (Join-Path $PetRendererRoot "notification.html")
      )
      pet_electron_main = Join-Path $script:PetRoot "dist-electron\main.js"
    }
    health = [ordered]@{}
    processes = [ordered]@{}
    pet = [ordered]@{
      ready_file = $PetReadyFile
      renderer_files = @(
        (Join-Path $PetRendererRoot "index.html"),
        (Join-Path $PetRendererRoot "menu.html"),
        (Join-Path $PetRendererRoot "notification.html")
      )
    }
  }
}

function Assert-NoActiveReleaseStack {
  $existing = Read-State
  if ($null -eq $existing) { return }
  $active = $false
  foreach ($kind in @('api', 'web', 'pet')) {
    $record = $existing.processes.$kind
    if ($record) {
      $process = Get-TrackedProcessState $record
      if ($process.running) {
        $active = $true
        Write-WarnLine "Existing release $kind process is still running. pid=$($record.pid)"
      }
    }
  }
  if ($active) { throw "A release stack is already running. Run start-release.ps1 -Action stop first." }
  Write-WarnLine "Removing stale release state file; existing batch logs are preserved."
  Remove-Item -LiteralPath $script:StateFile -Force
}

function Start-ReleaseStack(
  [string]$ResolvedApiBaseUrl, [string]$ResolvedApiDataDir, [string]$ApiServerUrl, [string]$WebUrl
) {
  Assert-NoActiveReleaseStack
  if (-not $SkipBuild) {
    Invoke-ReleaseBuild $ResolvedApiBaseUrl $ResolvedApiDataDir
  } else {
    Write-Info "Skipping release build by request."
    Assert-RequiredReleaseArtifacts
  }

  Assert-PortAvailable $ApiPort "API"
  Assert-PortAvailable $WebPort "Web"
  New-Item -ItemType Directory -Force -Path $script:RuntimeRoot | Out-Null
  $batchName = Get-Date -Format "yyyyMMdd-HHmmss-fff"
  $batchDirectory = Join-Path $script:RuntimeRoot $batchName
  New-Item -ItemType Directory -Force -Path $batchDirectory | Out-Null
  $apiOut = Join-Path $batchDirectory "api.out.log"
  $apiErr = Join-Path $batchDirectory "api.err.log"
  $webOut = Join-Path $batchDirectory "web.out.log"
  $webErr = Join-Path $batchDirectory "web.err.log"
  $petOut = Join-Path $batchDirectory "pet.out.log"
  $petErr = Join-Path $batchDirectory "pet.err.log"
  $petReadyFile = Join-Path $batchDirectory "pet-ready.json"
  $petRendererRoot = Join-Path $script:PetRoot "dist"

  $state = New-ReleaseState $batchDirectory $ResolvedApiBaseUrl $ApiServerUrl $WebUrl $ResolvedApiDataDir $petReadyFile $petRendererRoot
  Write-State $state
  $python = Resolve-PythonExe
  $node = Resolve-NodeExe
  $electron = Join-Path $script:PetRoot "node_modules\electron\dist\electron.exe"
  if (-not (Test-Path -LiteralPath $electron)) {
    throw "Electron 可执行文件缺失：$electron。请在源码目录执行 npm --prefix desktop-pet ci，或重新生成便携包。"
  }
  $webRunner = Join-Path $script:WebRoot "scripts\run-next.mjs"
  if (-not (Test-Path -LiteralPath $webRunner)) { throw "Web production runner 缺失：$webRunner。请重新生成便携包。" }
  $null = Resolve-NpmCommand
  if ($SkipBuild) {
    Assert-ApiEntry $python $ResolvedApiDataDir
  }

  try {
    Write-Info "Starting API on $ApiServerUrl ..."
    $state.processes.api = Invoke-WithEnvironment @{ API_DATA_DIR = $ResolvedApiDataDir } {
      New-TrackedProcess `
        "api" $python @('-m', 'uvicorn', 'app.main:app', '--host', $ApiHost, '--port', [string]$ApiPort) `
        $script:ApiRoot $apiOut $apiErr "app.main:app" $ApiServerUrl $ApiPort
    }
    Write-State $state
    if (-not (Wait-HttpReady "$ApiServerUrl/healthz" 60)) {
      throw "API did not become healthy at $ApiServerUrl/healthz. See $apiErr"
    }
    $state.health.api = $true
    Write-Info "API is healthy."

    Write-Info "Starting Web production server on $WebUrl ..."
    $webRunnerArgument = """$webRunner"""
    $state.processes.web = Invoke-WithEnvironment @{
      NEXT_DIST_DIR = $script:WebDistDir
      NEXT_PUBLIC_API_BASE_URL = $ResolvedApiBaseUrl
      NODE_ENV = "production"
    } {
      New-TrackedProcess `
        "web" $node @($webRunnerArgument, "start", "-p", [string]$WebPort, "-H", $WebHost) `
        $script:ProjectRoot $webOut $webErr "run-next.mjs" $WebUrl $WebPort
    }
    Write-State $state
    if (-not (Wait-HttpReady $WebUrl 90)) {
      throw "Web production server did not become healthy at $WebUrl. See $webErr"
    }
    $state.health.web = $true
    Write-Info "Web production server is healthy."

    Write-Info "Starting Electron production runtime from local dist files ..."
    $petEnvironment = @{
      MMD_PET_RELEASE = "1"
      MMD_PET_API_BASE_URL = $ResolvedApiBaseUrl
      MMD_PET_RENDERER_DIST_DIR = $petRendererRoot
      MMD_PET_READY_FILE = $petReadyFile
      MMD_PET_USER_ID = $UserId
      MMD_PET_RENDERER_URL = $null
      MMD_PET_DEBUG_EVENTS = if ($NoDebugEvents) { $null } else { "1" }
      MMD_PET_DEBUG_EVENTS_LOG = if ($NoDebugEvents) { $null } else { Join-Path $batchDirectory "pet-debug-events.ndjson" }
    }
    if ($WorkspacePath) { $petEnvironment.MMD_PET_WORKSPACE_PATH = $WorkspacePath }
    $state.processes.pet = Invoke-WithEnvironment $petEnvironment {
      New-TrackedProcess `
        "pet" $electron @('.') `
        $script:PetRoot $petOut $petErr "desktop-pet\node_modules\electron\dist\electron.exe" "" 0 "Normal"
    }
    $state.pet.ready_file = $petReadyFile
    $state.processes.pet.ready_file = $petReadyFile
    $state.processes.pet.renderer_files = $state.pet.renderer_files
    Write-State $state
    $petEvidence = Wait-PetEvidence $state.processes.pet $PetReadyTimeoutSeconds
    if (-not $petEvidence.process.running) {
      throw "Electron production runtime exited before readiness. See $petErr"
    }
    $state.health.pet_process = $petEvidence.process.identity_verified
    $state.health.pet_renderer_files = Test-RendererFiles $state.pet
    $state.health.pet_renderer_window = $petEvidence.marker.verified
    if (-not $petEvidence.marker.verified) {
      Write-WarnLine "Electron process is running and local renderer files exist, but the renderer window ready marker was not observed within $PetReadyTimeoutSeconds seconds. GUI window verification remains incomplete; see $petOut and $petErr."
    } else {
      Write-Info "Electron renderer loaded local file: $($petEvidence.marker.renderer_file)"
    }

    $state.status = "running"
    Write-State $state
    Write-Host "Release stack started."
    Write-Host "API: $ResolvedApiBaseUrl   pid=$($state.processes.api.pid)"
    Write-Host "WEB: $WebUrl   pid=$($state.processes.web.pid)"
    Write-Host "PET: local renderer=$petRendererRoot   pid=$($state.processes.pet.pid)"
    Write-Host "State: $script:StateFile"
    Write-Host "Logs:  $batchDirectory"
  } catch {
    $failure = $_.Exception.Message
    Write-ErrorLine "Release stack startup failed: $failure"
    foreach ($kind in @('pet', 'web', 'api')) {
      $record = $state.processes.$kind
      if ($record) {
        try { Stop-TrackedProcessTree $record } catch { Write-WarnLine "Cleanup for $kind failed: $($_.Exception.Message)" }
      }
    }
    $state.status = "failed"
    $state.failure = $failure
    $state.failed_at = (Get-Date).ToString("o")
    Write-State $state
    throw
  }
}

function Show-ReleaseStatus {
  $state = Read-State
  if ($null -eq $state) {
    Write-Host "status=stopped"
    Write-WarnLine "No release stack state found."
    return
  }

  $api = Get-TrackedProcessState $state.processes.api
  $web = Get-TrackedProcessState $state.processes.web
  $pet = Get-TrackedProcessState $state.processes.pet
  $apiHttp = if ($state.processes.api) { Test-HttpReady "$($state.processes.api.url)/healthz" } else { $false }
  $webHttp = if ($state.processes.web) { Test-HttpReady ([string]$state.processes.web.url) } else { $false }
  $petFiles = Test-RendererFiles $state.pet
  $petMarker = Read-PetReadyMarker $state.processes.pet
  $overall =
    $api.running -and $api.identity_verified -and $apiHttp -and
    $web.running -and $web.identity_verified -and $webHttp -and
    $pet.running -and $pet.identity_verified -and $petFiles
  $reportedStatus = if ($overall) { "running" } else { "partial" }

  Write-Host "status=$reportedStatus"
  Write-Host "stackState=$($state.status) startedAt=$($state.started_at)"
  Write-Host "API: pid=$($api.pid) process=$($api.running) identity=$($api.identity_verified) http=$apiHttp url=$($state.api_base_url)"
  Write-Host "WEB: pid=$($web.pid) process=$($web.running) identity=$($web.identity_verified) http=$webHttp url=$($state.web_url)"
  Write-Host "PET: pid=$($pet.pid) process=$($pet.running) identity=$($pet.identity_verified) rendererFiles=$petFiles rendererWindow=$($petMarker.verified) rendererUrl=$($petMarker.renderer_url)"
  Write-Host "PetRendererRoot: $($state.artifacts.pet_renderer_root)"
  Write-Host "State: $script:StateFile"
  Write-Host "Logs:  $($state.batch_directory)"
  if ($state.failure) { Write-Host "Failure: $($state.failure)" -ForegroundColor Red }
  if (-not $overall) { exit 1 }
}

function Stop-ReleaseStack {
  $state = Read-State
  if ($null -eq $state) {
    Write-Host "status=stopped"
    Write-WarnLine "No release stack state found. Nothing to stop."
    return
  }

  $errors = @()
  foreach ($kind in @('pet', 'web', 'api')) {
    $record = $state.processes.$kind
    if ($record) {
      try { Stop-TrackedProcessTree $record }
      catch { $errors += "${kind}: $($_.Exception.Message)" }
    }
  }
  Start-Sleep -Milliseconds 500

  $remaining = @()
  foreach ($kind in @('api', 'web', 'pet')) {
    $record = $state.processes.$kind
    if ($record) {
      $process = Get-TrackedProcessState $record
      if ($process.running) { $remaining += "${kind} pid=$($record.pid)" }
    }
  }
  if ($state.processes.api -and (Test-HttpReady "$($state.processes.api.url)/healthz")) { $remaining += "api http=$($state.processes.api.url)" }
  if ($state.processes.web -and (Test-HttpReady ([string]$state.processes.web.url))) { $remaining += "web http=$($state.processes.web.url)" }
  if ($errors.Count -gt 0 -or $remaining.Count -gt 0) {
    $details = @($errors + $remaining) -join "; "
    throw "Release stack stop did not prove all tracked services stopped: $details. State file was retained for recovery."
  }

  if ($state.pet.ready_file -and (Test-Path -LiteralPath ([string]$state.pet.ready_file))) {
    Remove-Item -LiteralPath ([string]$state.pet.ready_file) -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $script:StateFile -Force
  Write-Host "status=stopped"
  Write-Info "Release stack stopped. Logs were preserved at $($state.batch_directory)."
}

$apiBaseFallback = if ($env:MMD_PET_API_BASE_URL) { $env:MMD_PET_API_BASE_URL } else { New-LocalBaseUrl $ApiHost $ApiPort }
$resolvedApiBaseUrl = Normalize-BaseUrl $ApiBaseUrl $apiBaseFallback
$resolvedApiDataDir = $null
if ($Action -in @("build", "start")) {
  $resolvedApiDataDir = Resolve-ReleaseApiDataDir $ApiDataDir $PSBoundParameters.ContainsKey("ApiDataDir") ([string]$env:API_DATA_DIR)
}
$apiServerUrl = New-LocalBaseUrl $ApiHost $ApiPort
$webUrl = New-LocalBaseUrl $WebHost $WebPort

try {
  switch ($Action) {
    "build" { Invoke-ReleaseBuild $resolvedApiBaseUrl $resolvedApiDataDir }
    "start" { Start-ReleaseStack $resolvedApiBaseUrl $resolvedApiDataDir $apiServerUrl $webUrl }
    "stop" { Stop-ReleaseStack }
    "status" { Show-ReleaseStatus }
  }
} catch {
  Write-ErrorLine $_.Exception.Message
  exit 1
}
