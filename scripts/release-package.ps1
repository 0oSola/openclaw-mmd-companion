[CmdletBinding()]
param(
  [ValidateSet("package")]
  [string]$Action = "package",
  [int]$ApiPort = 8200,
  [string]$ApiHost = "127.0.0.1",
  [string]$ApiBaseUrl = "",
  [string]$ApiDataDir = "",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$script:SourceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$script:ReleaseRoot = Join-Path $script:SourceRoot "release"
$script:ReleaseStackScript = Join-Path $script:SourceRoot "scripts\release-stack.ps1"

function Write-Info([string]$Message) { Write-Host "[INFO] $Message" }
function Write-WarnLine([string]$Message) { Write-Host "[WARN] $Message" -ForegroundColor Yellow }

function Resolve-Executable([string[]]$Names, [string]$Label, [string]$Hint) {
  foreach ($name in $Names) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) {
      $path = if ($command.Source) { $command.Source } else { $command.Path }
      if ($path) { return $path }
    }
  }
  throw "未找到$Label。$Hint"
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
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
    $candidates = @(Get-ChildItem -LiteralPath $root -Recurse -Filter python.exe -File -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notmatch "WindowsApps\\python(?:3)?(?:\.exe)?$" } |
      Sort-Object FullName -Descending)
    if ($candidates.Count -gt 0) { return $candidates[0].FullName }
  }

  throw "未找到可用 Python。请安装 Python 3.11+ 并加入 PATH，然后重新执行打包；API 依赖可用 python -m pip install -r api/requirements.txt 安装。"
}

function Invoke-CheckedCommand(
  [string]$FilePath,
  [string[]]$Arguments,
  [string]$WorkingDirectory,
  [string]$FailureHint
) {
  $displayArguments = ($Arguments | ForEach-Object { [string]$_ }) -join " "
  Write-Info "执行：$FilePath $displayArguments"
  Push-Location -LiteralPath $WorkingDirectory
  try {
    & $FilePath @Arguments
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
  } finally {
    Pop-Location
  }
  if ($exitCode -ne 0) {
    throw "命令失败（退出码 $exitCode）：$FilePath $displayArguments。$FailureHint"
  }
}

function Test-PathRelative([string]$Root, [string]$RelativePath, [string]$Kind = "Leaf") {
  $path = Join-Path $Root $RelativePath
  if ($Kind -eq "Container") { return Test-Path -LiteralPath $path -PathType Container }
  return Test-Path -LiteralPath $path -PathType Leaf
}

function Assert-PackageSourceLayout {
  $requiredFiles = @(
    "start-mmd.ps1",
    "scripts\release-stack.ps1",
    "api\app\main.py",
    "api\requirements.txt",
    "web\package.json",
    "web\package-lock.json",
    "web\scripts\run-next.mjs",
    "desktop-pet\package.json",
    "desktop-pet\package-lock.json"
  )
  $missing = @($requiredFiles | Where-Object { -not (Test-PathRelative $script:SourceRoot $_) })
  if ($missing.Count -gt 0) {
    throw "源码目录缺少打包所需文件：$($missing -join ', ')。"
  }
}

function Resolve-NodeModules([string]$ProjectRoot, [string]$Sentinel, [string]$Label, [string]$NpmCommand) {
  $sentinelPath = Join-Path $ProjectRoot $Sentinel
  if (Test-Path -LiteralPath $sentinelPath -PathType Leaf) { return }

  $lockPath = Join-Path $ProjectRoot "package-lock.json"
  if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
    throw "$Label 缺少 package-lock.json，无法安全执行 npm ci。"
  }
  Write-WarnLine "$Label 依赖未就绪，正在运行 npm ci；首次执行可能需要网络和较长时间。"
  Invoke-CheckedCommand $NpmCommand @("--prefix", $ProjectRoot, "ci", "--no-audit", "--no-fund") $script:SourceRoot "请确认 Node.js/npm 可用并检查 npm 输出。"
  if (-not (Test-Path -LiteralPath $sentinelPath -PathType Leaf)) {
    throw "$Label 依赖安装后仍缺少 $Sentinel。请检查 npm 输出并重试。"
  }
}

function Assert-PythonRuntime {
  $python = Resolve-PythonExe
  $probe = "import fastapi, multipart, uvicorn; print('api-runtime-ok')"
  & $python -c $probe *> $null
  $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
  if ($exitCode -ne 0) {
    throw "Python API 依赖未就绪。请在当前目标 Python 环境执行 python -m pip install -r api/requirements.txt，然后重新打包。"
  }
  return $python
}

function Invoke-ReleaseBuild([bool]$ApiDataDirWasProvided) {
  $arguments = @("-Action", "build", "-ApiPort", [string]$ApiPort, "-ApiHost", $ApiHost)
  if ($ApiBaseUrl) { $arguments += @("-ApiBaseUrl", $ApiBaseUrl) }
  if ($ApiDataDirWasProvided) { $arguments += @("-ApiDataDir", $ApiDataDir) }
  $commandArguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $script:ReleaseStackScript) + $arguments
  Invoke-CheckedCommand "powershell.exe" $commandArguments $script:SourceRoot "请检查 API/Python、Web/npm 和 desktop-pet 构建输出。"
}

function Copy-FileChecked([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "待复制文件不存在：$Source"
  }
  $parent = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

function Copy-DirectoryChecked([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    throw "待复制目录不存在：$Source"
  }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $robocopy = Get-Command robocopy.exe -ErrorAction SilentlyContinue
  if (-not $robocopy) {
    Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
    return
  }
  $arguments = @(
    $Source, $Destination,
    "/E", "/COPY:DAT", "/DCOPY:DAT", "/R:1", "/W:1", "/XJ",
    "/NFL", "/NDL", "/NJH", "/NJS", "/NP"
  )
  & $robocopy.Source @arguments | Out-Null
  $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
  if ($exitCode -gt 7) {
    throw "复制目录失败（robocopy 退出码 $exitCode）：$Source -> $Destination"
  }
}

function Copy-OptionalDirectory([string]$Source, [string]$Destination) {
  if (Test-Path -LiteralPath $Source -PathType Container) {
    Copy-DirectoryChecked $Source $Destination
    return $true
  }
  return $false
}

function Get-JsonFile([string]$Path) {
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Get-ProjectVersion {
  $candidates = @(
    (Join-Path $script:SourceRoot "desktop-pet\package.json"),
    (Join-Path $script:SourceRoot "web\package.json")
  )
  foreach ($path in $candidates) {
    try {
      $version = [string](Get-JsonFile $path).version
      if ($version) { return $version }
    } catch { }
  }
  return "0.0.0"
}

function Get-TreeStats([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    return [ordered]@{ files = 0; bytes = [int64]0 }
  }
  $files = @(Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue)
  $bytes = [int64]0
  foreach ($file in $files) { $bytes += [int64]$file.Length }
  return [ordered]@{ files = $files.Count; bytes = $bytes }
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Write-JsonFile([string]$Path, $Value) {
  $json = $Value | ConvertTo-Json -Depth 12
  Write-Utf8NoBom $Path ($json + "`n")
}

function New-UniquePackageRoot([string]$PackageName) {
  New-Item -ItemType Directory -Force -Path $script:ReleaseRoot | Out-Null
  $candidate = Join-Path $script:ReleaseRoot $PackageName
  $suffix = 1
  while (Test-Path -LiteralPath $candidate) {
    $suffix += 1
    $candidate = Join-Path $script:ReleaseRoot "$PackageName-$suffix"
  }
  New-Item -ItemType Directory -Force -Path $candidate | Out-Null
  return $candidate
}

function New-ReleaseReadme([string]$PackageName, [bool]$MmdAssetsIncluded) {
  $assetDescription = if ($MmdAssetsIncluded) {
    "本包检测到并复制了源码 MMD/ 下的本地资源。模型、贴图、动作和音频可能属于第三方，未经授权不得再分发。"
  } else {
    "当前源码包只包含 MMD/README.md，没有检测到可复制的模型、贴图、动作或音频；请按授权把本地资源放入包根目录 MMD/。"
  }
  return @"
# MMD Companion 便携 Release 包

包名：$PackageName

这是 ZIP 便携包，不是安装器，也不包含 NSIS/注册表安装流程。包内已包含 Web production 产物、desktop-pet production renderer/Electron 产物和可直接运行的 Node 依赖目录；当前仍要求目标机已有 Python、Node.js/npm，以及 API 所需的 Python 依赖。

## 启动

在本目录执行：

```powershell
.\start-mmd.ps1 -Action start
.\start-mmd.ps1 -Action status
.\start-mmd.ps1 -Action stop
.\start-mmd.ps1 -Action kill
```

默认 API 端口为 `8200`，Web 端口为 `3200`。可用 `-ApiPort`、`-WebPort`、`-ApiHost`、`-WebHost`、`-ApiBaseUrl`、`-ApiDataDir`、`-UserId`、`-WorkspacePath` 和 `-PetReadyTimeoutSeconds` 覆盖。

`-ApiDataDir` 或环境变量 `API_DATA_DIR` 一旦显式设置就严格使用；路径或 SQLite 不可用时直接失败，不会静默改写。两者均未设置时，包内默认 `api/data` 不可用会安全回退到 `.runtime/release-stack/data`。运行状态和批次日志分别保留在 `.runtime/release-stack.json` 与 `.runtime/release-stack/<批次>/`。

`start` 按 API、Web、Pet 分别复用当前包中健康且身份匹配的组件，只启动缺失或不健康的组件；状态文件缺失或不完整时，只要能通过当前包路径、命令身份、端口父进程树和 Pet ready marker 证明归属，就会恢复并写回状态。其它包或其它命令占用端口时会保留进程并报告冲突。`kill` 只清理能由状态记录或严格当前包身份证明确认的进程树和状态/ready 文件，不会按端口、进程名或 PID 泛杀。

## 运行前提

- Windows PowerShell 5.1 或 PowerShell 7。
- Python 3.11+，并在目标环境执行 `python -m pip install -r api/requirements.txt`。
- Node.js/npm；包内的 Web 依赖可直接运行，但 Node.js 运行时不随包提供。
- Electron 可执行文件随 `desktop-pet/node_modules/electron` 提供；启动仍需要 Node/npm 及 Windows 图形环境。

## MMD 资源

$assetDescription

## 故障排查

先执行 `-Action status` 查看 API/Web/Pet 的进程身份、HTTP 健康状态、renderer 文件和 renderer ready marker。需要清理当前包残留时执行 `-Action kill`；详细 stdout/stderr、Pet ready marker 和 debug event 日志在 `.runtime/release-stack/<批次>/`，`stop`/`kill` 只处理本入口记录或严格证明属于当前包且命令身份仍匹配的进程。

如果启动提示 Python、npm、Electron 或产物缺失，请按错误中的中文命令补齐环境；源码根目录的 `.\start-mmd.ps1 -Action package` 会重新生成一个带时间戳的包。
"@
}

function Assert-NoForbiddenEntries([string]$PackageRoot) {
  $forbidden = @(Get-ChildItem -LiteralPath $PackageRoot -Recurse -Force -ErrorAction SilentlyContinue | Where-Object {
      $_.FullName -match "\\.git(\\|$)" -or
      $_.FullName -match "\\.runtime(\\|$)" -or
      $_.Name -in @("trace.db", "trace.db-shm", "trace.db-wal") -or
      $_.Name -eq "desktop-pet-debug-events.ndjson"
    })
  if ($forbidden.Count -gt 0) {
    $paths = ($forbidden | ForEach-Object { $_.FullName }) -join "; "
    throw "便携包包含被禁止的缓存/运行时/数据库文件：$paths"
  }
}

function Assert-PackageLayout([string]$PackageRoot) {
  $required = @(
    "start-mmd.ps1",
    "manifest.json",
    "README-release.md",
    "scripts\release-stack.ps1",
    "api\app\main.py",
    "api\requirements.txt",
    "web\.next-codex-release\BUILD_ID",
    "web\scripts\run-next.mjs",
    "desktop-pet\dist\index.html",
    "desktop-pet\dist\menu.html",
    "desktop-pet\dist\notification.html",
    "desktop-pet\dist-electron\main.js",
    "desktop-pet\node_modules\electron\dist\electron.exe"
  )
  $missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $PackageRoot $_) -PathType Leaf) })
  if ($missing.Count -gt 0) {
    throw "便携包布局不完整，缺少：$($missing -join ', ')"
  }
  Assert-NoForbiddenEntries $PackageRoot
}

function Assert-ZipLayout([string]$ZipPath) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $badEntries = @($archive.Entries | Where-Object {
        $_.FullName -match "(^|/)\.git(/|$)" -or
        $_.FullName -match "(^|/)\.runtime(/|$)" -or
        [System.IO.Path]::GetFileName($_.FullName) -in @("trace.db", "trace.db-shm", "trace.db-wal") -or
        [System.IO.Path]::GetFileName($_.FullName) -eq "desktop-pet-debug-events.ndjson"
      })
    if ($badEntries.Count -gt 0) {
      throw "ZIP 包含被禁止的文件：$($badEntries.FullName -join ', ')"
    }
  } finally {
    $archive.Dispose()
  }
}

try {
  Assert-PackageSourceLayout

  $npm = Resolve-Executable @("npm.cmd", "npm") "npm" "请安装 Node.js（含 npm）并将其加入 PATH。"
  $null = Assert-PythonRuntime
  Resolve-NodeModules (Join-Path $script:SourceRoot "web") "node_modules\next\package.json" "Web" $npm
  Resolve-NodeModules (Join-Path $script:SourceRoot "desktop-pet") "node_modules\electron\dist\electron.exe" "desktop-pet" $npm

  if ($SkipBuild) {
    Write-Info "按请求跳过源码构建，直接校验已有 Release 产物。"
  } else {
    Write-Info "开始构建源码 Release 产物；可能包含超过 20 分钟的 npm/TypeScript 构建，请保留当前终端输出。"
    Invoke-ReleaseBuild $PSBoundParameters.ContainsKey("ApiDataDir")
  }

  $version = Get-ProjectVersion
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
  $packageName = "mmd-portable-$version-$timestamp"
  $packageRoot = New-UniquePackageRoot $packageName
  Write-Info "组装便携包：$packageRoot"

  Copy-FileChecked (Join-Path $script:SourceRoot "start-mmd.ps1") (Join-Path $packageRoot "start-mmd.ps1")
  Copy-FileChecked $script:ReleaseStackScript (Join-Path $packageRoot "scripts\release-stack.ps1")
  Copy-FileChecked (Join-Path $script:SourceRoot "LICENSE") (Join-Path $packageRoot "LICENSE")
  Copy-FileChecked (Join-Path $script:SourceRoot "api\requirements.txt") (Join-Path $packageRoot "api\requirements.txt")
  Copy-FileChecked (Join-Path $script:SourceRoot "api\pytest.ini") (Join-Path $packageRoot "api\pytest.ini")
  Copy-FileChecked (Join-Path $script:SourceRoot "api\.env.example") (Join-Path $packageRoot "api\.env.example")
  Copy-DirectoryChecked (Join-Path $script:SourceRoot "api\app") (Join-Path $packageRoot "api\app")

  Copy-FileChecked (Join-Path $script:SourceRoot "web\package.json") (Join-Path $packageRoot "web\package.json")
  Copy-FileChecked (Join-Path $script:SourceRoot "web\package-lock.json") (Join-Path $packageRoot "web\package-lock.json")
  Copy-FileChecked (Join-Path $script:SourceRoot "web\next.config.mjs") (Join-Path $packageRoot "web\next.config.mjs")
  Copy-FileChecked (Join-Path $script:SourceRoot "web\.env.example") (Join-Path $packageRoot "web\.env.example")
  Copy-DirectoryChecked (Join-Path $script:SourceRoot "web\scripts") (Join-Path $packageRoot "web\scripts")
  Copy-DirectoryChecked (Join-Path $script:SourceRoot "web\.next-codex-release") (Join-Path $packageRoot "web\.next-codex-release")
  Copy-DirectoryChecked (Join-Path $script:SourceRoot "web\node_modules") (Join-Path $packageRoot "web\node_modules")
  $null = Copy-OptionalDirectory (Join-Path $script:SourceRoot "web\public") (Join-Path $packageRoot "web\public")

  Copy-FileChecked (Join-Path $script:SourceRoot "desktop-pet\package.json") (Join-Path $packageRoot "desktop-pet\package.json")
  Copy-FileChecked (Join-Path $script:SourceRoot "desktop-pet\package-lock.json") (Join-Path $packageRoot "desktop-pet\package-lock.json")
  Copy-DirectoryChecked (Join-Path $script:SourceRoot "desktop-pet\dist") (Join-Path $packageRoot "desktop-pet\dist")
  Copy-DirectoryChecked (Join-Path $script:SourceRoot "desktop-pet\dist-electron") (Join-Path $packageRoot "desktop-pet\dist-electron")
  Copy-DirectoryChecked (Join-Path $script:SourceRoot "desktop-pet\node_modules") (Join-Path $packageRoot "desktop-pet\node_modules")

  $mmdAssetsIncluded = $false
  $mmdRoot = Join-Path $script:SourceRoot "MMD"
  if (Test-Path -LiteralPath $mmdRoot -PathType Container) {
    Copy-DirectoryChecked $mmdRoot (Join-Path $packageRoot "MMD")
    $mmdAssetsIncluded = @(Get-ChildItem -LiteralPath $mmdRoot -Recurse -File -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -ne "README.md" }).Count -gt 0
  }
  $stageRoot = Join-Path $script:SourceRoot "MMD_stage"
  if (Test-Path -LiteralPath $stageRoot -PathType Container) {
    Copy-DirectoryChecked $stageRoot (Join-Path $packageRoot "MMD_stage")
  }

  $readmePath = Join-Path $packageRoot "README-release.md"
  Write-Utf8NoBom $readmePath (New-ReleaseReadme $packageName $mmdAssetsIncluded)

  $manifest = [ordered]@{
    schema_version = 1
    package_type = "mmd-portable-release"
    package_name = $packageName
    version = $version
    created_at = (Get-Date).ToString("o")
    source_commit = ""
    entrypoint = "start-mmd.ps1"
    runtime = [ordered]@{
      mode = "portable-source-plus-node-runtime"
      requires_python = $true
      requires_node = $true
      requires_npm = $true
      api_dependencies = "api/requirements.txt must be installed on the target machine"
      state_file = ".runtime/release-stack.json"
      logs = ".runtime/release-stack/<batch>/"
      fallback_data_dir = ".runtime/release-stack/data"
    }
    contents = [ordered]@{
      api = "api/app + api/requirements.txt + api/.env.example"
      web = "web/.next-codex-release + web/node_modules + web/scripts/run-next.mjs"
      desktop_pet = "desktop-pet/dist + desktop-pet/dist-electron + desktop-pet/node_modules"
      mmd = if ($mmdAssetsIncluded) { "MMD/ copied, including local assets" } else { "MMD/ copied without local model assets" }
      mmd_stage = if (Test-Path -LiteralPath (Join-Path $packageRoot "MMD_stage") -PathType Container) { "MMD_stage/ copied" } else { "MMD_stage/ absent" }
    }
    exclusions = @(
      ".git/",
      "source .runtime history/",
      "api/data/ and trace.db/SQLite user data",
      "desktop-pet-debug-events.ndjson",
      "test results and temporary files"
    )
    third_party_asset_notice = "MMD local model, texture, motion and audio assets may be third-party; package redistribution requires permission."
    stats = [ordered]@{
      api = Get-TreeStats (Join-Path $packageRoot "api")
      web = Get-TreeStats (Join-Path $packageRoot "web")
      desktop_pet = Get-TreeStats (Join-Path $packageRoot "desktop-pet")
      mmd = Get-TreeStats (Join-Path $packageRoot "MMD")
      mmd_stage = Get-TreeStats (Join-Path $packageRoot "MMD_stage")
    }
  }
  try {
    $manifest.source_commit = (& git -C $script:SourceRoot rev-parse HEAD 2>$null | Select-Object -First 1).Trim()
  } catch { }
  $manifestPath = Join-Path $packageRoot "manifest.json"
  Write-JsonFile $manifestPath $manifest

  Assert-PackageLayout $packageRoot

  $zipPath = Join-Path $script:ReleaseRoot "$packageName.zip"
  $entries = @(Get-ChildItem -LiteralPath $packageRoot -Force | ForEach-Object { $_.FullName })
  Write-Info "创建 ZIP：$zipPath"
  Compress-Archive -Path $entries -DestinationPath $zipPath -CompressionLevel Optimal -Force
  Assert-ZipLayout $zipPath

  $latestPath = Join-Path $script:ReleaseRoot "latest.json"
  Write-JsonFile $latestPath ([ordered]@{
      schema_version = 1
      package_type = "mmd-portable-release-pointer"
      package_name = $packageName
      package_directory = [System.IO.Path]::GetFullPath($packageRoot)
      zip_file = [System.IO.Path]::GetFullPath($zipPath)
      updated_at = (Get-Date).ToString("o")
    })

  Write-Host "Portable Release package created."
  Write-Host "目录：$packageRoot"
  Write-Host "ZIP： $zipPath"
  Write-Output "package_path=$([System.IO.Path]::GetFullPath($packageRoot))"
  Write-Output "package_zip=$([System.IO.Path]::GetFullPath($zipPath))"
} catch {
  Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
