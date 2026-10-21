[CmdletBinding()]
param(
  [ValidateSet("package", "start", "status", "stop", "kill")]
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

$script:EntryRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$script:ApiDataDirWasProvided = $PSBoundParameters.ContainsKey("ApiDataDir")
$script:ApiBaseUrlWasProvided = $PSBoundParameters.ContainsKey("ApiBaseUrl")
$script:WorkspacePathWasProvided = $PSBoundParameters.ContainsKey("WorkspacePath")

function Write-Info([string]$Message) { Write-Host "[INFO] $Message" }
function Write-WarnLine([string]$Message) { Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-ErrorLine([string]$Message) { Write-Host "[ERROR] $Message" -ForegroundColor Red }

function Read-PortableManifest([string]$Root) {
  $manifestPath = Join-Path $Root "manifest.json"
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { return $null }
  try { return Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json }
  catch { throw "便携包 manifest.json 无法解析：$manifestPath。请重新生成 Release 包。" }
}

$script:PortableManifest = Read-PortableManifest $script:EntryRoot
$script:IsPortablePackage = $false
if ($null -ne $script:PortableManifest) {
  $portablePackageType = [string]$script:PortableManifest.package_type
  $script:IsPortablePackage = $portablePackageType -eq "mmd-portable-release"
}

function Resolve-ExplicitPath([string]$Value, [string]$BaseRoot) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $Value }
  if ([System.IO.Path]::IsPathRooted($Value)) { return [System.IO.Path]::GetFullPath($Value) }
  return [System.IO.Path]::GetFullPath((Join-Path $BaseRoot $Value))
}

function Get-LatestPackageRoot {
  $releaseRoot = Join-Path $script:EntryRoot "release"
  if (-not (Test-Path -LiteralPath $releaseRoot -PathType Container)) {
    throw "未找到 release 目录。请先在源码根目录执行 .\start-mmd.ps1 -Action package 或 start。"
  }

  $pointerPath = Join-Path $releaseRoot "latest.json"
  if (Test-Path -LiteralPath $pointerPath -PathType Leaf) {
    try {
      $pointer = Get-Content -LiteralPath $pointerPath -Raw | ConvertFrom-Json
      $candidate = [string]$pointer.package_directory
      if ($candidate -and (Test-Path -LiteralPath (Join-Path $candidate "manifest.json") -PathType Leaf)) {
        return [System.IO.Path]::GetFullPath($candidate)
      }
    } catch {
      Write-WarnLine "latest.json 无法使用，将按目录时间选择最近的便携包。"
    }
  }

  $candidates = @(Get-ChildItem -LiteralPath $releaseRoot -Directory -Force -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "manifest.json") -PathType Leaf } |
    Sort-Object LastWriteTime -Descending)
  if ($candidates.Count -eq 0) {
    throw "release 目录中没有可用的便携包。请先执行 .\start-mmd.ps1 -Action package。"
  }
  return $candidates[0].FullName
}

function Invoke-ChildPowerShell([string]$ScriptPath, [string[]]$Arguments) {
  if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) {
    throw "缺少启动脚本：$ScriptPath"
  }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments
  $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
  if ($exitCode -ne 0) {
    throw "子脚本失败，退出码为 $exitCode：$ScriptPath"
  }
}

function New-StackArguments([string]$StackAction, [bool]$ForceSkipBuild) {
  $arguments = @(
    "-Action", $StackAction,
    "-ApiPort", [string]$ApiPort,
    "-WebPort", [string]$WebPort,
    "-ApiHost", $ApiHost,
    "-WebHost", $WebHost,
    "-UserId", $UserId,
    "-PetReadyTimeoutSeconds", [string]$PetReadyTimeoutSeconds
  )
  if ($script:ApiBaseUrlWasProvided) { $arguments += @("-ApiBaseUrl", $ApiBaseUrl) }
  if ($script:ApiDataDirWasProvided) {
    $dataRoot = if ($script:IsPortablePackage) { $script:EntryRoot } else { $script:EntryRoot }
    $arguments += @("-ApiDataDir", (Resolve-ExplicitPath $ApiDataDir $dataRoot))
  }
  if ($script:WorkspacePathWasProvided) {
    $arguments += @("-WorkspacePath", (Resolve-ExplicitPath $WorkspacePath $script:EntryRoot))
  }
  if ($ForceSkipBuild -or $SkipBuild) { $arguments += "-SkipBuild" }
  if ($NoDebugEvents) { $arguments += "-NoDebugEvents" }
  return $arguments
}

function Invoke-PackageAction {
  $packageScript = Join-Path $script:EntryRoot "scripts\release-package.ps1"
  $arguments = @(
    "-Action", "package",
    "-ApiPort", [string]$ApiPort,
    "-ApiHost", $ApiHost
  )
  if ($script:ApiBaseUrlWasProvided) { $arguments += @("-ApiBaseUrl", $ApiBaseUrl) }
  if ($script:ApiDataDirWasProvided) {
    $arguments += @("-ApiDataDir", (Resolve-ExplicitPath $ApiDataDir $script:EntryRoot))
  }
  if ($SkipBuild) { $arguments += "-SkipBuild" }

  $output = @(
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $packageScript @arguments
  )
  $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
  if ($exitCode -ne 0) { throw "便携 Release 打包失败，退出码为 $exitCode。" }

  $packageLine = $output | ForEach-Object { [string]$_ } | Where-Object { $_ -like "package_path=*" } | Select-Object -Last 1
  if (-not $packageLine) {
    return Get-LatestPackageRoot
  }
  $packageRoot = ([string]$packageLine).Substring("package_path=".Length).Trim()
  if (-not (Test-Path -LiteralPath (Join-Path $packageRoot "manifest.json") -PathType Leaf)) {
    throw "打包脚本返回的目录不是有效便携包：$packageRoot"
  }
  return [System.IO.Path]::GetFullPath($packageRoot)
}

function Invoke-PackageEntry([string]$PackageRoot, [string]$PackageAction) {
  $entryPath = Join-Path $PackageRoot "start-mmd.ps1"
  $arguments = @(
    "-Action", $PackageAction,
    "-ApiPort", [string]$ApiPort,
    "-WebPort", [string]$WebPort,
    "-ApiHost", $ApiHost,
    "-WebHost", $WebHost,
    "-UserId", $UserId,
    "-PetReadyTimeoutSeconds", [string]$PetReadyTimeoutSeconds
  )
  if ($script:ApiBaseUrlWasProvided) { $arguments += @("-ApiBaseUrl", $ApiBaseUrl) }
  if ($script:ApiDataDirWasProvided) {
    $arguments += @("-ApiDataDir", (Resolve-ExplicitPath $ApiDataDir $script:EntryRoot))
  }
  if ($script:WorkspacePathWasProvided) {
    $arguments += @("-WorkspacePath", (Resolve-ExplicitPath $WorkspacePath $script:EntryRoot))
  }
  if ($PackageAction -eq "start" -or $SkipBuild) { $arguments += "-SkipBuild" }
  if ($NoDebugEvents) { $arguments += "-NoDebugEvents" }
  Invoke-ChildPowerShell $entryPath $arguments
}

try {
  if ($script:IsPortablePackage) {
    if ($Action -eq "package") {
      throw "当前目录已经是便携 Release 包；请回到源码根目录执行 -Action package。"
    }
    $stackScript = Join-Path $script:EntryRoot "scripts\release-stack.ps1"
    $stackArguments = New-StackArguments $Action ($Action -eq "start")
    Write-Info "使用包内发布脚本：$stackScript"
    Invoke-ChildPowerShell $stackScript $stackArguments
    exit 0
  }

  $packageScript = Join-Path $script:EntryRoot "scripts\release-package.ps1"
  if (-not (Test-Path -LiteralPath $packageScript -PathType Leaf)) {
    throw "当前目录既不是便携包，也缺少源码打包脚本：$packageScript"
  }

  switch ($Action) {
    "package" {
      $packageRoot = Invoke-PackageAction
      Write-Host "便携 Release 包已生成：$packageRoot"
      exit 0
    }
    "start" {
      $packageRoot = Invoke-PackageAction
      Write-Info "从新生成的包启动三端：$packageRoot"
      Invoke-PackageEntry $packageRoot "start"
      exit 0
    }
    "status" {
      $packageRoot = Get-LatestPackageRoot
      Write-Info "使用最近的便携包：$packageRoot"
      Invoke-PackageEntry $packageRoot "status"
      exit 0
    }
    "stop" {
      $packageRoot = Get-LatestPackageRoot
      Write-Info "使用最近的便携包：$packageRoot"
      Invoke-PackageEntry $packageRoot $Action
      exit 0
    }
    "kill" {
      $packageRoot = Get-LatestPackageRoot
      Write-Info "使用最近的便携包：$packageRoot"
      Invoke-PackageEntry $packageRoot $Action
      exit 0
    }
  }
} catch {
  Write-ErrorLine $_.Exception.Message
  exit 1
}
