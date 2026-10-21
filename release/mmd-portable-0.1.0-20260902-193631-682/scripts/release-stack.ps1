[CmdletBinding()]
param(
  [ValidateSet("build", "start", "stop", "status", "kill")]
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
$script:PackageRootNormalized = [System.IO.Path]::GetFullPath($script:ProjectRoot).TrimEnd('\', '/').ToLowerInvariant()

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

function Normalize-PathForComparison([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return "" }
  try {
    return [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/').ToLowerInvariant()
  } catch {
    return $Path.Trim().TrimEnd('\', '/').ToLowerInvariant()
  }
}

function Test-PathWithinRoot([string]$Path, [string]$Root) {
  $normalizedPath = Normalize-PathForComparison $Path
  $normalizedRoot = Normalize-PathForComparison $Root
  if (-not $normalizedPath -or -not $normalizedRoot) { return $false }
  return $normalizedPath -eq $normalizedRoot -or $normalizedPath.StartsWith("$normalizedRoot\", [StringComparison]::OrdinalIgnoreCase)
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
    Select-Object ProcessId, ParentProcessId, Name, CommandLine, ExecutablePath, CreationDate)
}

function Get-ProcessSnapshotById([int]$ProcessId) {
  if ($ProcessId -le 0) { return $null }
  return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
}

function Test-CommandSignature($Process, $Record) {
  if ($null -eq $Process) { return $false }
  $expectedProcessName = ([string]$Record.process_name).ToLowerInvariant()
  $actualProcessName = ([string]$Process.Name).ToLowerInvariant()
  if ($expectedProcessName -and $actualProcessName -and $expectedProcessName -ne $actualProcessName) { return $false }
  $recordPackageRoot = [string]$Record.package_root
  if ($recordPackageRoot -and (Normalize-PathForComparison $recordPackageRoot) -ne $script:PackageRootNormalized) { return $false }
  $signature = [string]$Record.command_signature
  if (-not $signature) { return $false }
  $commandLine = [string]$Process.CommandLine
  if ($commandLine.IndexOf($signature, [StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }

  $identityMarker = [string]$Record.identity_marker
  if (-not $identityMarker) { return $false }
  if (-not (Test-PathWithinRoot $identityMarker $script:ProjectRoot)) { return $false }
  if ($commandLine.IndexOf($identityMarker, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    return $false
  }

  $expectedExecutable = Normalize-PathForComparison ([string]$Record.executable)
  $actualExecutable = Normalize-PathForComparison ([string]$Process.ExecutablePath)
  if ($expectedExecutable -and $actualExecutable -and $expectedExecutable -ne $actualExecutable) {
    return $false
  }

  $port = [int]$Record.port
  if ($port -gt 0) {
    $portPattern = "(--port|-p)\s+$port(\s|$)"
    if ($commandLine -notmatch $portPattern) { return $false }
  }
  return $true
}

function Test-ProcessBelongsToCurrentPackage($Process, $Definition) {
  if ($null -eq $Process -or $null -eq $Definition) { return $false }
  $actualProcessName = ([string]$Process.Name).ToLowerInvariant()
  $expectedProcessNames = switch ([string]$Definition.kind) {
    "api" { @("python.exe", "pythonw.exe", "python") }
    "web" { @("node.exe", "node") }
    "pet" { @("electron.exe", "electron") }
    default { @() }
  }
  if ($expectedProcessNames.Count -eq 0 -or $expectedProcessNames -notcontains $actualProcessName) { return $false }
  $packageRoot = [string]$Definition.package_root
  if (-not $packageRoot -or (Normalize-PathForComparison $packageRoot) -ne $script:PackageRootNormalized) {
    return $false
  }

  $commandLine = [string]$Process.CommandLine
  $signature = [string]$Definition.command_signature
  if (-not $signature -or $commandLine.IndexOf($signature, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    return $false
  }
  $identityMarker = [string]$Definition.identity_marker
  if (-not $identityMarker -or $commandLine.IndexOf($identityMarker, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
    return $false
  }
  if ([string]$Definition.kind -eq "pet" -and $commandLine -match "(?i)--type=") { return $false }

  $expectedExecutable = Normalize-PathForComparison ([string]$Definition.executable)
  $actualExecutable = Normalize-PathForComparison ([string]$Process.ExecutablePath)
  if ($expectedExecutable -and $actualExecutable -and $expectedExecutable -ne $actualExecutable) {
    return $false
  }

  $port = [int]$Definition.port
  if ($port -gt 0) {
    $portPattern = "(--port|-p)\s+$port(\s|$)"
    if ($commandLine -notmatch $portPattern) { return $false }
  }
  return $true
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

function Get-ProcessAncestors([int]$ProcessId, [object[]]$Snapshot) {
  $byPid = @{}
  foreach ($process in $Snapshot) { $byPid[[int]$process.ProcessId] = $process }
  $currentPid = $ProcessId
  $seen = @{}
  $result = @()
  while ($currentPid -gt 0 -and $byPid.ContainsKey($currentPid) -and -not $seen.ContainsKey($currentPid)) {
    $seen[$currentPid] = $true
    $parentPid = [int]$byPid[$currentPid].ParentProcessId
    if ($parentPid -le 0 -or -not $byPid.ContainsKey($parentPid)) { break }
    $result += ,$byPid[$parentPid]
    $currentPid = $parentPid
  }
  return $result
}

function Get-TrackedProcessState($Record) {
  if ($null -eq $Record) {
    return [pscustomobject]@{ running = $false; identity_verified = $false; pid = 0; process_name = ""; command_line = ""; descendant_count = 0 }
  }
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

function Test-ChildProcessBelongsToRecord($Record, $Process) {
  if ($null -eq $Record -or $null -eq $Process) { return $false }
  $packageRoot = [string]$Record.package_root
  if (-not $packageRoot) { return $false }
  $commandLine = [string]$Process.CommandLine
  if ($commandLine.IndexOf($packageRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
  $executable = [string]$Process.ExecutablePath
  return $executable -and (Test-PathWithinRoot $executable $packageRoot)
}

function Stop-ProcessDescendants([int]$ParentPid, [object[]]$Snapshot, $Record) {
  $children = @($Snapshot | Where-Object { [int]$_.ParentProcessId -eq $ParentPid })
  foreach ($child in $children) {
    Stop-ProcessDescendants ([int]$child.ProcessId) $Snapshot $Record
    if ((Test-AllowedChildProcess $Record $child) -and (Test-ChildProcessBelongsToRecord $Record $child)) {
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
  [string]$LogOut, [string]$LogErr, [string]$CommandSignature, [string]$IdentityMarker,
  [string]$Url, [int]$Port,
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
  $snapshot = Get-ProcessSnapshotById ([int]$process.Id)
  return [ordered]@{
    kind = $Kind; pid = [int]$process.Id; process_name = [System.IO.Path]::GetFileName($FilePath); executable = $FilePath
    arguments = @($Arguments); working_directory = $WorkingDirectory; command_signature = $CommandSignature
    identity_marker = $IdentityMarker; package_root = $script:ProjectRoot
    url = $Url; port = $Port; log_out = $LogOut; log_err = $LogErr; started_at = (Get-Date).ToString("o")
    process_start_time = if ($snapshot) { [string]$snapshot.CreationDate } else { "" }
    component_action = "started"; reused = $false
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
  if ($null -eq $Record) { return $false }
  foreach ($file in @($Record.renderer_files)) {
    if (-not (Test-Path -LiteralPath ([string]$file))) { return $false }
  }
  return $true
}

function Test-RendererFileList([object[]]$Files) {
  if ($null -eq $Files -or $Files.Count -eq 0) { return $false }
  foreach ($file in $Files) {
    if (-not (Test-Path -LiteralPath ([string]$file))) { return $false }
  }
  return $true
}

function Read-PetReadyMarker($Record) {
  if ($null -eq $Record) {
    return [pscustomobject]@{ exists = $false; verified = $false; path = ""; renderer_url = ""; renderer_file = "" }
  }
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
    $rendererRoot = [string]$marker.rendererRoot
    $base.renderer_url = $rendererUrl
    $base.renderer_file = $rendererFile
    $base.verified =
      ([int]$marker.pid -eq [int]$Record.pid) -and
      ([string]$marker.mode -eq "release") -and
      $rendererRoot -and
      (Test-PathWithinRoot $rendererRoot $script:PetRoot) -and
      ($rendererUrl -like "file:*") -and
      ([bool]$marker.rendererShellReady) -and
      $rendererFile -and
      (Test-PathWithinRoot $rendererFile $script:PetRoot) -and
      (Test-Path -LiteralPath $rendererFile)
  } catch { $base.verified = $false }
  return [pscustomobject]$base
}

function Find-PetReadyMarkerForPid([int]$ProcessId) {
  if ($ProcessId -le 0 -or -not (Test-Path -LiteralPath $script:RuntimeRoot -PathType Container)) { return $null }
  $markerFiles = @(Get-ChildItem -LiteralPath $script:RuntimeRoot -Filter "pet-ready.json" -File -Recurse -ErrorAction SilentlyContinue)
  foreach ($markerFile in $markerFiles) {
    try {
      $marker = Get-Content -LiteralPath $markerFile.FullName -Raw | ConvertFrom-Json
      $rendererRoot = [string]$marker.rendererRoot
      $rendererFile = [string]$marker.rendererFile
      if (
        [int]$marker.pid -eq $ProcessId -and
        [string]$marker.mode -eq "release" -and
        $rendererRoot -and (Test-PathWithinRoot $rendererRoot $script:PetRoot) -and
        $rendererFile -and (Test-PathWithinRoot $rendererFile $script:PetRoot) -and
        (Test-Path -LiteralPath $rendererFile -PathType Leaf)
      ) {
        return $markerFile.FullName
      }
    } catch { }
  }
  return $null
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

function Test-ComponentHealthy($Definition, $Record) {
  if ($null -eq $Definition -or $null -eq $Record) { return $false }
  $tracked = Get-TrackedProcessState $Record
  if (-not $tracked.running -or -not $tracked.identity_verified) { return $false }

  switch ([string]$Definition.kind) {
    "api" { return Test-HttpReady ("$($Definition.url)/healthz") }
    "web" { return Test-HttpReady ([string]$Definition.url) }
    "pet" {
      $rendererFiles = @($Record.renderer_files)
      if ($rendererFiles.Count -eq 0) { $rendererFiles = @($Definition.renderer_files) }
      if (-not (Test-RendererFileList $rendererFiles)) { return $false }
      return (Read-PetReadyMarker $Record).verified
    }
    default { return $false }
  }
}

function New-ReleaseComponentDefinition(
  [string]$Kind, [string]$Url, [int]$Port, [string]$Executable,
  [string]$CommandSignature, [string]$IdentityMarker, [string]$WorkingDirectory,
  [string]$LogOut, [string]$LogErr, [object[]]$RendererFiles
) {
  return [pscustomobject]@{
    kind = $Kind
    url = $Url
    port = $Port
    executable = $Executable
    command_signature = $CommandSignature
    identity_marker = $IdentityMarker
    package_root = $script:ProjectRoot
    working_directory = $WorkingDirectory
    log_out = $LogOut
    log_err = $LogErr
    renderer_files = @($RendererFiles)
  }
}

function Get-ReleaseComponentCandidates($Definition, [object[]]$Snapshot) {
  if ($null -eq $Definition) { return @() }
  if ([int]$Definition.port -gt 0) {
    $ownerPid = Get-ListeningProcessId ([int]$Definition.port)
    if (-not $ownerPid) { return @() }
    $owner = @($Snapshot | Where-Object { [int]$_.ProcessId -eq [int]$ownerPid } | Select-Object -First 1)
    if ($owner.Count -eq 0) {
      return @([pscustomobject]@{
        kind = $Definition.kind
        process = $null
        pid = [int]$ownerPid
        owned = $false
        source = "port"
        reason = "监听端口的进程无法读取"
      })
    }
    $ownerProcess = $owner[0]
    $ownedProcess = $null
    foreach ($process in @($ownerProcess) + @(Get-ProcessAncestors ([int]$ownerProcess.ProcessId) $Snapshot)) {
      if (Test-ProcessBelongsToCurrentPackage $process $Definition) {
        $ownedProcess = $process
        break
      }
    }
    $owned = $null -ne $ownedProcess
    return @([pscustomobject]@{
      kind = $Definition.kind
      process = if ($ownedProcess) { $ownedProcess } else { $ownerProcess }
      pid = if ($ownedProcess) { [int]$ownedProcess.ProcessId } else { [int]$ownerProcess.ProcessId }
      listener_pid = [int]$ownerProcess.ProcessId
      owned = $owned
      source = "port"
      reason = if ($owned) { "current-package-tree" } else { "foreign-process" }
    })
  }

  return @($Snapshot |
    Where-Object {
      $name = ([string]$_.Name).ToLowerInvariant()
      @("electron.exe", "electron") -contains $name
    } |
    Where-Object { Test-ProcessBelongsToCurrentPackage $_ $Definition } |
    ForEach-Object {
      [pscustomobject]@{
        kind = $Definition.kind
        process = $_
        pid = [int]$_.ProcessId
        owned = $true
        source = "process-scan"
        reason = "current-package"
      }
    })
}

function New-ReusedProcessRecord($Definition, $Process, $ExistingRecord, [string]$ReadyFile) {
  $hasExistingIdentityMarker = $ExistingRecord -and ($ExistingRecord.PSObject.Properties.Name -contains "identity_marker")
  $hasExistingExecutable = $ExistingRecord -and [string]$ExistingRecord.executable
  $hasExistingSignature = $ExistingRecord -and [string]$ExistingRecord.command_signature
  $record = [ordered]@{
    kind = [string]$Definition.kind
    pid = [int]$Process.ProcessId
    process_name = [string]$Process.Name
    executable = if ($hasExistingExecutable) { [string]$ExistingRecord.executable } else { [string]$Definition.executable }
    arguments = if ($ExistingRecord) { @($ExistingRecord.arguments) } else { @() }
    working_directory = if ($ExistingRecord -and $ExistingRecord.working_directory) { [string]$ExistingRecord.working_directory } else { [string]$Definition.working_directory }
    command_signature = if ($hasExistingSignature) { [string]$ExistingRecord.command_signature } else { [string]$Definition.command_signature }
    identity_marker = if ($hasExistingIdentityMarker -and [string]$ExistingRecord.identity_marker) { [string]$ExistingRecord.identity_marker } else { [string]$Definition.identity_marker }
    package_root = $script:ProjectRoot
    url = if ($ExistingRecord -and $ExistingRecord.url) { [string]$ExistingRecord.url } else { [string]$Definition.url }
    port = if ($ExistingRecord -and [int]$ExistingRecord.port -gt 0) { [int]$ExistingRecord.port } else { [int]$Definition.port }
    log_out = if ($ExistingRecord) { [string]$ExistingRecord.log_out } else { "" }
    log_err = if ($ExistingRecord) { [string]$ExistingRecord.log_err } else { "" }
    started_at = if ($ExistingRecord) { [string]$ExistingRecord.started_at } else { [string]$Process.CreationDate }
    process_start_time = [string]$Process.CreationDate
    component_action = "reused"
    reused = $true
  }
  if ($ExistingRecord -and $ExistingRecord.ready_file) { $record.ready_file = [string]$ExistingRecord.ready_file }
  if ($ReadyFile) { $record.ready_file = $ReadyFile }
  if ($ExistingRecord -and $ExistingRecord.renderer_files) {
    $record.renderer_files = @($ExistingRecord.renderer_files)
  } elseif ($Definition.renderer_files.Count -gt 0) {
    $record.renderer_files = @($Definition.renderer_files)
  }
  return $record
}

function New-ReleaseBatchContext($ExistingState) {
  $batchDirectory = $null
  if ($ExistingState) {
    $candidate = [string]$ExistingState.batch_directory
    if ($candidate -and (Test-PathWithinRoot $candidate $script:RuntimeRoot)) {
      $batchDirectory = [System.IO.Path]::GetFullPath($candidate)
      New-Item -ItemType Directory -Force -Path $batchDirectory | Out-Null
    }
  }
  if (-not $batchDirectory) {
    New-Item -ItemType Directory -Force -Path $script:RuntimeRoot | Out-Null
    $batchDirectory = Join-Path $script:RuntimeRoot (Get-Date -Format "yyyyMMdd-HHmmss-fff")
    New-Item -ItemType Directory -Force -Path $batchDirectory | Out-Null
  }
  return [pscustomobject]@{
    directory = $batchDirectory
    api_out = Join-Path $batchDirectory "api.out.log"
    api_err = Join-Path $batchDirectory "api.err.log"
    web_out = Join-Path $batchDirectory "web.out.log"
    web_err = Join-Path $batchDirectory "web.err.log"
    pet_out = Join-Path $batchDirectory "pet.out.log"
    pet_err = Join-Path $batchDirectory "pet.err.log"
    pet_ready = Join-Path $batchDirectory "pet-ready.json"
  }
}

function New-ReleaseState(
  [string]$BatchDirectory, [string]$ResolvedApiBaseUrl, [string]$ApiServerUrl, [string]$WebUrl,
  [string]$ResolvedApiDataDir, [string]$PetReadyFile, [string]$PetRendererRoot
) {
  return [ordered]@{
    schema_version = 2
    stack = "release"
    status = "starting"
    started_at = (Get-Date).ToString("o")
    project_root = $script:ProjectRoot
    package_identity = $script:PackageRootNormalized
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
    component_actions = [ordered]@{}
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

function Test-StateBelongsToCurrentPackage($State) {
  if ($null -eq $State) { return $false }
  $projectRoot = [string]$State.project_root
  if (-not $projectRoot -or (Normalize-PathForComparison $projectRoot) -ne $script:PackageRootNormalized) { return $false }
  $packageIdentity = [string]$State.package_identity
  if ($packageIdentity -and (Normalize-PathForComparison $packageIdentity) -ne $script:PackageRootNormalized) { return $false }
  return $true
}

function Get-StateComponentRecord($State, [string]$Kind) {
  if ($null -eq $State -or $null -eq $State.processes) { return $null }
  return $State.processes.$Kind
}

function New-ReconciledReleaseState(
  $ExistingState, $BatchContext, [string]$ResolvedApiBaseUrl, [string]$ApiServerUrl,
  [string]$WebUrl, [string]$ResolvedApiDataDir, [string]$PetRendererRoot
) {
  $state = New-ReleaseState $BatchContext.directory $ResolvedApiBaseUrl $ApiServerUrl $WebUrl $ResolvedApiDataDir $BatchContext.pet_ready $PetRendererRoot
  if (Test-StateBelongsToCurrentPackage $ExistingState) {
    if ($ExistingState.started_at) { $state.started_at = [string]$ExistingState.started_at }
    foreach ($kind in @("api", "web", "pet")) {
      $record = Get-StateComponentRecord $ExistingState $kind
      if ($record) { $state.processes.$kind = $record }
    }
    if ($ExistingState.pet -and $ExistingState.pet.ready_file -and (Test-PathWithinRoot ([string]$ExistingState.pet.ready_file) $script:RuntimeRoot)) {
      $state.pet.ready_file = [string]$ExistingState.pet.ready_file
    }
  }
  return $state
}

function New-ComponentPlan($Definition, $ExistingState, [object[]]$Snapshot) {
  $existingRecord = if (Test-StateBelongsToCurrentPackage $ExistingState) {
    Get-StateComponentRecord $ExistingState ([string]$Definition.kind)
  } else { $null }

  if ($existingRecord) {
    $process = @(Get-ProcessSnapshotById ([int]$existingRecord.pid) | Select-Object -First 1)
    if ($process.Count -gt 0) {
      $process = $process[0]
      $verificationRecord = New-ReusedProcessRecord $Definition $process $existingRecord ([string]$existingRecord.ready_file)
      $tracked = Get-TrackedProcessState $verificationRecord
      if ($tracked.identity_verified) {
        if (Test-ComponentHealthy $Definition $verificationRecord) {
          return [pscustomobject]@{
            kind = $Definition.kind
            action = "reused"
            source = "state"
            record = $verificationRecord
            stop_record = $null
            conflict = ""
          }
        }

        $ownerPid = if ([int]$Definition.port -gt 0) { Get-ListeningProcessId ([int]$Definition.port) } else { $null }
        if (-not $ownerPid -or [int]$ownerPid -eq [int]$existingRecord.pid) {
          return [pscustomobject]@{
            kind = $Definition.kind
            action = "start"
            source = "state"
            record = $null
            stop_record = $verificationRecord
            conflict = ""
          }
        }
      }
    }
  }

  $candidates = @(Get-ReleaseComponentCandidates $Definition $Snapshot)
  if ($candidates.Count -gt 1 -and [string]$Definition.kind -eq "pet") {
    return [pscustomobject]@{
      kind = $Definition.kind
      action = "conflict"
      source = "process-scan"
      record = $null
      stop_record = $null
      conflict = "拒绝启动 Pet：发现多个属于当前 Release 包的 Electron 进程。请先执行当前包的 -Action kill，再重试。"
    }
  }
  if ($candidates.Count -gt 0) {
    $candidate = $candidates[0]
    if (-not $candidate.owned) {
      $label = ([string]$Definition.kind).ToUpperInvariant()
      return [pscustomobject]@{
        kind = $Definition.kind
        action = "conflict"
        source = $candidate.source
        record = $null
        stop_record = $null
        conflict = "拒绝启动 $label：端口 $($Definition.port) 已由 pid=$($candidate.pid) 占用，但该进程 not owned by current Release package $script:ProjectRoot；已保留该进程。请使用所属包的 kill，或选择其它端口。"
      }
    }

    $readyFile = if ([string]$Definition.kind -eq "pet") { Find-PetReadyMarkerForPid ([int]$candidate.pid) } else { "" }
    $record = New-ReusedProcessRecord $Definition $candidate.process $null $readyFile
    if (Test-ComponentHealthy $Definition $record) {
      return [pscustomobject]@{
        kind = $Definition.kind
        action = "reused"
        source = $candidate.source
        record = $record
        stop_record = $null
        conflict = ""
      }
    }
    return [pscustomobject]@{
      kind = $Definition.kind
      action = "start"
      source = $candidate.source
      record = $null
      stop_record = $record
      conflict = ""
    }
  }

  return [pscustomobject]@{
    kind = $Definition.kind
    action = "start"
    source = "missing"
    record = $null
    stop_record = $null
    conflict = ""
  }
}

function Start-ReleaseStack(
  [string]$ResolvedApiBaseUrl, [string]$ResolvedApiDataDir, [string]$ApiServerUrl, [string]$WebUrl
) {
  if (-not $SkipBuild) {
    Invoke-ReleaseBuild $ResolvedApiBaseUrl $ResolvedApiDataDir
  } else {
    Write-Info "Skipping release build by request."
    Assert-RequiredReleaseArtifacts
  }

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

  $existingState = Read-State
  if ($null -eq $existingState) {
    Write-Info "Release state file missing; discovering current-package API/Web/Pet processes before starting only missing components."
  } elseif (-not (Test-StateBelongsToCurrentPackage $existingState)) {
    Write-WarnLine "Release state file is incomplete or belongs to another path; process discovery will require an explicit current-package identity marker."
  }
  $batch = New-ReleaseBatchContext $existingState
  $petRendererRoot = Join-Path $script:PetRoot "dist"
  $state = New-ReconciledReleaseState $existingState $batch $ResolvedApiBaseUrl $ApiServerUrl $WebUrl $ResolvedApiDataDir $petRendererRoot
  $definitions = @(
    (New-ReleaseComponentDefinition "api" $ApiServerUrl $ApiPort $python "app.main:app" $script:ApiRoot $script:ApiRoot $batch.api_out $batch.api_err @()),
    (New-ReleaseComponentDefinition "web" $WebUrl $WebPort $node "run-next.mjs" $webRunner $script:ProjectRoot $batch.web_out $batch.web_err @()),
    (New-ReleaseComponentDefinition "pet" "" 0 $electron "desktop-pet\node_modules\electron\dist\electron.exe" $electron $script:PetRoot $batch.pet_out $batch.pet_err @(
      (Join-Path $petRendererRoot "index.html"),
      (Join-Path $petRendererRoot "menu.html"),
      (Join-Path $petRendererRoot "notification.html")
    ))
  )
  $snapshot = Get-ProcessSnapshot
  $plans = @()
  foreach ($definition in $definitions) {
    $plans += ,(New-ComponentPlan $definition $existingState $snapshot)
  }
  $conflicts = @($plans | Where-Object { $_.action -eq "conflict" } | ForEach-Object { $_.conflict })
  if ($conflicts.Count -gt 0) {
    throw ($conflicts -join [Environment]::NewLine)
  }

  $state.status = "starting"
  $state.failure = $null
  foreach ($plan in $plans) {
    $state.component_actions.($plan.kind) = if ($plan.action -eq "reused") { "reused" } else { "started" }
    if ($plan.action -eq "reused") {
      $state.processes.($plan.kind) = $plan.record
      if ($plan.kind -eq "pet" -and $plan.record.ready_file) {
        $state.pet.ready_file = [string]$plan.record.ready_file
      }
    } else {
      $state.processes.($plan.kind) = $null
    }
  }
  Write-State $state

  $startedRecords = @()
  try {
    foreach ($plan in $plans) {
      $definition = @($definitions | Where-Object { $_.kind -eq $plan.kind })[0]
      if ($plan.action -eq "reused") {
        Write-Info "$($plan.kind.ToUpperInvariant()) component reused. pid=$($plan.record.pid) source=$($plan.source)"
        switch ($plan.kind) {
          "api" { $state.health.api = $true }
          "web" { $state.health.web = $true }
          "pet" {
            $state.health.pet_process = $true
            $state.health.pet_renderer_files = Test-RendererFileList @($plan.record.renderer_files)
            $state.health.pet_renderer_window = (Read-PetReadyMarker $plan.record).verified
          }
        }
        Write-State $state
        continue
      }

      if ($plan.stop_record) {
        Write-WarnLine "Restarting unhealthy $($plan.kind) component owned by the current Release package."
        Stop-TrackedProcessTree $plan.stop_record
      }

      switch ($plan.kind) {
        "api" {
          $apiRootArgument = """$script:ApiRoot"""
          Write-Info "Starting API on $ApiServerUrl ..."
          $state.processes.api = Invoke-WithEnvironment @{ API_DATA_DIR = $ResolvedApiDataDir } { New-TrackedProcess "api" $python @('-m', 'uvicorn', 'app.main:app', '--app-dir', $apiRootArgument, '--host', $ApiHost, '--port', [string]$ApiPort) $script:ApiRoot $definition.log_out $definition.log_err "app.main:app" $script:ApiRoot $ApiServerUrl $ApiPort }
          $startedRecords += ,$state.processes.api
          Write-State $state
          if (-not (Wait-HttpReady "$ApiServerUrl/healthz" 60)) {
            throw "API did not become healthy at $ApiServerUrl/healthz. See $($definition.log_err)"
          }
          $state.health.api = $true
          Write-Info "API is healthy."
        }
        "web" {
          $webRunnerArgument = """$webRunner"""
          Write-Info "Starting Web production server on $WebUrl ..."
          $state.processes.web = Invoke-WithEnvironment @{
            NEXT_DIST_DIR = $script:WebDistDir
            NEXT_PUBLIC_API_BASE_URL = $ResolvedApiBaseUrl
            NODE_ENV = "production"
          } { New-TrackedProcess "web" $node @($webRunnerArgument, "start", "-p", [string]$WebPort, "-H", $WebHost) $script:ProjectRoot $definition.log_out $definition.log_err "run-next.mjs" $webRunner $WebUrl $WebPort }
          $startedRecords += ,$state.processes.web
          Write-State $state
          if (-not (Wait-HttpReady $WebUrl 90)) {
            throw "Web production server did not become healthy at $WebUrl. See $($definition.log_err)"
          }
          $state.health.web = $true
          Write-Info "Web production server is healthy."
        }
        "pet" {
          $petReadyFile = $batch.pet_ready
          $state.pet.ready_file = $petReadyFile
          Write-Info "Starting Electron production runtime from local dist files ..."
          $petEnvironment = @{
            MMD_PET_RELEASE = "1"
            MMD_PET_API_BASE_URL = $ResolvedApiBaseUrl
            MMD_PET_RENDERER_DIST_DIR = $petRendererRoot
            MMD_PET_READY_FILE = $petReadyFile
            MMD_PET_USER_ID = $UserId
            MMD_PET_RENDERER_URL = $null
            MMD_PET_DEBUG_EVENTS = if ($NoDebugEvents) { $null } else { "1" }
            MMD_PET_DEBUG_EVENTS_LOG = if ($NoDebugEvents) { $null } else { Join-Path $batch.directory "pet-debug-events.ndjson" }
          }
          if ($WorkspacePath) { $petEnvironment.MMD_PET_WORKSPACE_PATH = $WorkspacePath }
          $state.processes.pet = Invoke-WithEnvironment $petEnvironment { New-TrackedProcess "pet" $electron @('.') $script:PetRoot $definition.log_out $definition.log_err "desktop-pet\node_modules\electron\dist\electron.exe" $electron "" 0 "Normal" }
          $state.processes.pet.ready_file = $petReadyFile
          $state.processes.pet.renderer_files = $state.pet.renderer_files
          $startedRecords += ,$state.processes.pet
          Write-State $state
          $petEvidence = Wait-PetEvidence $state.processes.pet $PetReadyTimeoutSeconds
          if (-not $petEvidence.process.running) {
            throw "Electron production runtime exited before readiness. See $($definition.log_err)"
          }
          $state.health.pet_process = $petEvidence.process.identity_verified
          $state.health.pet_renderer_files = Test-RendererFiles $state.pet
          $state.health.pet_renderer_window = $petEvidence.marker.verified
          if (-not $petEvidence.marker.verified) {
            Write-WarnLine "Electron process is running and local renderer files exist, but the renderer window ready marker was not observed within $PetReadyTimeoutSeconds seconds. GUI window verification remains incomplete; see $($definition.log_out) and $($definition.log_err)."
          } else {
            Write-Info "Electron renderer loaded local file: $($petEvidence.marker.renderer_file)"
          }
        }
      }
      Write-State $state
    }

    $state.status = "running"
    Write-State $state
    Write-Host "Release stack is running."
    Write-Host "API: $ResolvedApiBaseUrl   pid=$($state.processes.api.pid)   action=$($state.component_actions.api)"
    Write-Host "WEB: $WebUrl   pid=$($state.processes.web.pid)   action=$($state.component_actions.web)"
    Write-Host "PET: local renderer=$petRendererRoot   pid=$($state.processes.pet.pid)   action=$($state.component_actions.pet)"
    Write-Host "State: $script:StateFile"
    Write-Host "Logs:  $($batch.directory)"
  } catch {
    $failure = $_.Exception.Message
    Write-ErrorLine "Release stack startup failed: $failure"
    foreach ($record in @($startedRecords | Sort-Object @{ Expression = { @('pet', 'web', 'api').IndexOf([string]$_.kind) } })) {
      if ($record) {
        try { Stop-TrackedProcessTree $record } catch { Write-WarnLine "Cleanup for $($record.kind) failed: $($_.Exception.Message)" }
      }
    }
    $state.status = "failed"
    $state.failure = $failure
    $state.failed_at = (Get-Date).ToString("o")
    Write-State $state
    throw
  }
}

function New-KillComponentDefinitions {
  $python = ""
  $node = ""
  try { $python = Resolve-PythonExe } catch { }
  try { $node = Resolve-NodeExe } catch { }
  $webRunner = Join-Path $script:WebRoot "scripts\run-next.mjs"
  $electron = Join-Path $script:PetRoot "node_modules\electron\dist\electron.exe"
  $petRendererRoot = Join-Path $script:PetRoot "dist"
  return @(
    (New-ReleaseComponentDefinition "api" (New-LocalBaseUrl $ApiHost $ApiPort) $ApiPort $python "app.main:app" $script:ApiRoot $script:ApiRoot "" "" @()),
    (New-ReleaseComponentDefinition "web" (New-LocalBaseUrl $WebHost $WebPort) $WebPort $node "run-next.mjs" $webRunner $script:ProjectRoot "" "" @()),
    (New-ReleaseComponentDefinition "pet" "" 0 $electron "desktop-pet\node_modules\electron\dist\electron.exe" $electron $script:PetRoot "" "" @(
      (Join-Path $petRendererRoot "index.html"),
      (Join-Path $petRendererRoot "menu.html"),
      (Join-Path $petRendererRoot "notification.html")
    ))
  )
}

function Remove-ReleaseReadyMarker([string]$Path, [int]$ProcessId) {
  if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  if (-not (Test-PathWithinRoot $Path $script:RuntimeRoot)) { return }
  try {
    $marker = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    $rendererRoot = [string]$marker.rendererRoot
    if (
      [int]$marker.pid -eq $ProcessId -and
      [string]$marker.mode -eq "release" -and
      $rendererRoot -and (Test-PathWithinRoot $rendererRoot $script:PetRoot)
    ) {
      Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    }
  } catch { }
}

function Kill-ReleaseStack {
  $state = Read-State
  if ($state -and -not (Test-StateBelongsToCurrentPackage $state)) {
    throw "Refusing to use release state from another package: $($state.project_root). Current package is $script:ProjectRoot."
  }

  $definitions = New-KillComponentDefinitions
  $snapshot = Get-ProcessSnapshot
  $targets = @()
  $targetPids = @{}
  $errors = @()
  $markerPaths = @()

  foreach ($definition in $definitions) {
    $stateRecord = Get-StateComponentRecord $state ([string]$definition.kind)
    if ($stateRecord) {
      $process = @(Get-ProcessSnapshotById ([int]$stateRecord.pid) | Select-Object -First 1)
      if ($process.Count -gt 0) {
        $process = $process[0]
        $record = New-ReusedProcessRecord $definition $process $stateRecord ([string]$stateRecord.ready_file)
        if (Test-CommandSignature $process $record) {
          if (-not $targetPids.ContainsKey([int]$record.pid)) {
            $targets += [pscustomobject]@{ record = $record; source = "state" }
            $targetPids[[int]$record.pid] = $true
          }
          if ($record.ready_file) { $markerPaths += ,([string]$record.ready_file) }
        } else {
          $errors += "$($definition.kind): refusing to stop pid=$($stateRecord.pid); tracked command identity no longer matches. The process was preserved."
        }
      }
    }

    $candidates = @(Get-ReleaseComponentCandidates $definition $snapshot)
    foreach ($candidate in $candidates) {
      if ($candidate.owned -and $candidate.process) {
        $readyFile = if ([string]$definition.kind -eq "pet") { Find-PetReadyMarkerForPid ([int]$candidate.pid) } else { "" }
        $record = New-ReusedProcessRecord $definition $candidate.process $null $readyFile
        if (-not $targetPids.ContainsKey([int]$record.pid)) {
          $targets += [pscustomobject]@{ record = $record; source = "discovery" }
          $targetPids[[int]$record.pid] = $true
        }
        if ($record.ready_file) { $markerPaths += ,([string]$record.ready_file) }
      } elseif ([int]$definition.port -gt 0) {
        Write-WarnLine "Preserving pid=$($candidate.pid) on $($definition.kind) port $($definition.port): it is not owned by the current Release package."
      }
    }
  }

  foreach ($target in @($targets | Sort-Object @{ Expression = { @("pet", "web", "api").IndexOf([string]$_.record.kind) } })) {
    try {
      Stop-TrackedProcessTree $target.record
    } catch {
      $errors += "$($target.record.kind): $($_.Exception.Message)"
    }
  }

  Start-Sleep -Milliseconds 500
  foreach ($target in $targets) {
    $tracked = Get-TrackedProcessState $target.record
    if ($tracked.running -and $tracked.identity_verified) {
      $errors += "$($target.record.kind) pid=$($target.record.pid) is still running after kill."
    }
  }

  if ($errors.Count -gt 0) {
    throw ($errors -join [Environment]::NewLine)
  }

  if ($state -and (Test-StateBelongsToCurrentPackage $state)) {
    $allMarkerPaths = @($markerPaths) + @($(if ($state.pet) { [string]$state.pet.ready_file } else { "" }))
    foreach ($path in $allMarkerPaths) {
      if ($path) {
        $markerPid = 0
        $markerRecord = @($targets | Where-Object { $_.record.ready_file -eq $path } | Select-Object -First 1)
        if ($markerRecord.Count -gt 0) { $markerPid = [int]$markerRecord[0].record.pid }
        Remove-ReleaseReadyMarker $path $markerPid
      }
    }
    Remove-Item -LiteralPath $script:StateFile -Force -ErrorAction SilentlyContinue
  }
  Write-Host "status=stopped"
  Write-Host "kill=complete"
  Write-Info "当前 Release 包的可验证 API/Web/Pet 进程已清理；其它包和不匹配命令保持不变。"
}

function Show-ReleaseStatus {
  $state = Read-State
  if ($null -eq $state) {
    Write-Host "status=stopped"
    Write-WarnLine "No release stack state found."
    return
  }

  $apiRecord = Get-StateComponentRecord $state "api"
  $webRecord = Get-StateComponentRecord $state "web"
  $petRecord = Get-StateComponentRecord $state "pet"
  $api = Get-TrackedProcessState $apiRecord
  $web = Get-TrackedProcessState $webRecord
  $pet = Get-TrackedProcessState $petRecord
  $apiHttp = if ($apiRecord) { Test-HttpReady "$($apiRecord.url)/healthz" } else { $false }
  $webHttp = if ($webRecord) { Test-HttpReady ([string]$webRecord.url) } else { $false }
  $petFiles = Test-RendererFiles $state.pet
  $petMarker = Read-PetReadyMarker $petRecord
  $apiAction = if ($state.component_actions) { [string]$state.component_actions.api } else { "" }
  $webAction = if ($state.component_actions) { [string]$state.component_actions.web } else { "" }
  $petAction = if ($state.component_actions) { [string]$state.component_actions.pet } else { "" }
  $overall =
    $api.running -and $api.identity_verified -and $apiHttp -and
    $web.running -and $web.identity_verified -and $webHttp -and
    $pet.running -and $pet.identity_verified -and $petFiles
  $reportedStatus = if ($overall) { "running" } else { "partial" }

  Write-Host "status=$reportedStatus"
  Write-Host "stackState=$($state.status) startedAt=$($state.started_at)"
  Write-Host "API: pid=$($api.pid) process=$($api.running) identity=$($api.identity_verified) http=$apiHttp action=$apiAction url=$($state.api_base_url)"
  Write-Host "WEB: pid=$($web.pid) process=$($web.running) identity=$($web.identity_verified) http=$webHttp action=$webAction url=$($state.web_url)"
  Write-Host "PET: pid=$($pet.pid) process=$($pet.running) identity=$($pet.identity_verified) rendererFiles=$petFiles rendererWindow=$($petMarker.verified) action=$petAction rendererUrl=$($petMarker.renderer_url)"
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
  if (-not (Test-StateBelongsToCurrentPackage $state)) {
    throw "Refusing to stop a release state that is not owned by the current package: $($state.project_root)"
  }

  $errors = @()
  foreach ($kind in @("pet", "web", "api")) {
    $record = Get-StateComponentRecord $state $kind
    if ($record) {
      if (-not ($record.PSObject.Properties.Name -contains "package_root")) {
        $record | Add-Member -NotePropertyName package_root -NotePropertyValue ([string]$state.project_root)
      }
      try { Stop-TrackedProcessTree $record }
      catch { $errors += "${kind}: $($_.Exception.Message)" }
    }
  }
  Start-Sleep -Milliseconds 500

  $remaining = @()
  foreach ($kind in @("api", "web", "pet")) {
    $record = Get-StateComponentRecord $state $kind
    if ($record) {
      $process = Get-TrackedProcessState $record
      if ($process.running -and $process.identity_verified) { $remaining += "${kind} pid=$($record.pid)" }
    }
  }
  if ($errors.Count -gt 0 -or $remaining.Count -gt 0) {
    $details = @($errors + $remaining) -join "; "
    throw "Release stack stop did not prove all tracked services stopped: $details. State file was retained for recovery."
  }

  if ($state.pet -and $state.pet.ready_file) {
    $petRecord = Get-StateComponentRecord $state "pet"
    $petPid = if ($petRecord) { [int]$petRecord.pid } else { 0 }
    Remove-ReleaseReadyMarker ([string]$state.pet.ready_file) $petPid
  }
  Remove-Item -LiteralPath $script:StateFile -Force -ErrorAction SilentlyContinue
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
    "kill" { Kill-ReleaseStack }
  }
} catch {
  Write-ErrorLine $_.Exception.Message
  exit 1
}
