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

function Write-Info([string]$Message) {
  Write-Host "[INFO] $Message"
}

function Write-WarnLine([string]$Message) {
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-ErrorLine([string]$Message) {
  Write-Host "[ERROR] $Message" -ForegroundColor Red
}

# ---------------------------------------------------------------------------
# Windows-only helpers
# ---------------------------------------------------------------------------

function Test-UsablePythonPath([string]$Path) {
  if (-not $Path) { return $false }
  if ($Path -match "WindowsApps\\python(?:3)?(?:\.exe)?$") { return $false }
  return (Test-Path $Path)
}

function Resolve-PythonExe {
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if ($cmd -and (Test-UsablePythonPath $cmd.Source)) { return $cmd.Source }

  $pyCmd = Get-Command py -ErrorAction SilentlyContinue
  if ($pyCmd -and $pyCmd.Source) {
    try {
      $resolved = & $pyCmd.Source -c "import sys; print(sys.executable)"
      if ($LASTEXITCODE -eq 0) {
        $resolved = ($resolved | Select-Object -First 1).Trim()
        if (Test-UsablePythonPath $resolved) { return $resolved }
      }
    } catch {
    }
  }

  $searchRoots = @(
    (Join-Path $env:LocalAppData "Programs\Python"),
    "C:\Program Files\Python",
    "C:\Python"
  )
  foreach ($root in $searchRoots) {
    if (-not (Test-Path $root)) { continue }
    $candidates = Get-ChildItem -Path $root -Recurse -Filter python.exe -ErrorAction SilentlyContinue |
      Where-Object { Test-UsablePythonPath $_.FullName } |
      Sort-Object FullName -Descending
    if ($candidates) {
      return $candidates[0].FullName
    }
  }

  throw "Python executable not found. Install Python or add it to PATH."
}

function Resolve-NpmCmd {
  foreach ($name in @("npm.cmd", "npm")) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { return $cmd.Source }
  }

  $candidates = @(
    "C:\Program Files\nodejs\npm.cmd",
    "C:\nvm4w\nodejs\npm.cmd"
  )
  foreach ($candidate in $candidates) {
    try {
      if ([System.IO.File]::Exists($candidate)) { return $candidate }
    } catch {
      continue
    }
  }

  Write-WarnLine "npm.cmd not resolved via Get-Command or known paths; falling back to 'npm' and relying on PATH."
  return "npm"
}

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

function Get-ListeningProcessId([int]$Port) {
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
    return $conn.OwningProcess
  } catch {
    return $null
  }
}

function Set-EnvValueInFile([string]$FilePath, [string]$Key, [string]$Value) {
  $lines = @()
  if (Test-Path $FilePath) {
    $lines = Get-Content -Path $FilePath
  }
  $filtered = @()
  foreach ($line in $lines) {
    if ($line -notmatch "^$([regex]::Escape($Key))=") {
      $filtered += $line
    }
  }
  $filtered += "$Key=$Value"
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines($FilePath, $filtered, $utf8NoBom)
}

function Wait-Http([string]$Url, [int]$MaxAttempts = 40, [int]$SleepMs = 500) {
  for ($i = 0; $i -lt $MaxAttempts; $i++) {
    try {
      $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
        return $true
      }
    } catch {
      Start-Sleep -Milliseconds $SleepMs
      continue
    }
    Start-Sleep -Milliseconds $SleepMs
  }
  return $false
}

function Read-State([string]$Path) {
  if (-not (Test-Path $Path)) { return $null }
  try {
    return (Get-Content -Path $Path -Raw | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function Stop-TrackedProcess([int]$ProcessId, [string]$Name) {
  $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -eq $proc) {
    Write-WarnLine "$Name process $ProcessId already stopped."
    return
  }
  Stop-Process -Id $ProcessId -Force
  Write-Info "$Name process stopped. pid=$ProcessId"
}

function New-LogPaths([string]$RuntimeDir, [string]$Prefix) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  return @{
    out = Join-Path $RuntimeDir "$Prefix.$stamp.out.log"
    err = Join-Path $RuntimeDir "$Prefix.$stamp.err.log"
  }
}

# ---------------------------------------------------------------------------
# WSL helpers
# ---------------------------------------------------------------------------

function Convert-ToWslPath([string]$WinPath) {
  if (-not $WinPath) { return "" }
  # Already a WSL path (starts with /) — return as-is
  if ($WinPath -match "^/") { return $WinPath }
  $escaped = $WinPath -replace '\\', '/'
  $result = & wsl.exe wslpath -u $escaped 2>$null
  return ($result | Select-Object -First 1).Trim()
}

function Convert-ToWinPath([string]$WslPath) {
  if (-not $WslPath) { return "" }
  $result = & wsl.exe wslpath -w "$WslPath" 2>$null
  return ($result | Select-Object -First 1).Trim()
}

function Invoke-Wsl([string]$Command, [string]$WorkingDir = "") {
  $args = @()
  if ($WorkingDir) {
    $args += "--cd"
    $args += $WorkingDir
  }
  $args += "--"
  $args += "bash"
  $args += "-lc"
  $args += $Command
  return & wsl.exe @args
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$StateFile = Join-Path $RuntimeDir "dev-stack.json"

if (-not (Test-Path $RuntimeDir)) {
  New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
}

switch ($Action) {
  "start" {
    $existing = Read-State $StateFile
    if ($existing) {
      $apiProc = Get-Process -Id ([int]$existing.api.pid) -ErrorAction SilentlyContinue
      $webProc = Get-Process -Id ([int]$existing.web.pid) -ErrorAction SilentlyContinue
      if ($apiProc -or $webProc) {
        Write-ErrorLine "Detected running stack from state file. Run: powershell -File scripts/dev-stack.ps1 -Action stop"
        exit 1
      }
    }

    # In WSL mode, wslrelay may hold stale port mappings that prevent WSL
    # processes from binding, even though no service is actually listening.
    # When this happens, auto-increment the port until a free one is found.
    # In WSL mode, wslrelay may hold stale port mappings that prevent WSL
    # processes from binding (EADDRINUSE), even though no real service is
    # listening.  We probe each candidate port with both Get-NetTCPConnection
    # AND a TCP connect attempt — if either succeeds, the port is considered
    # occupied and we move to the next one.
    function Find-FreePort([int]$StartPort, [string]$Label) {
      $candidate = $StartPort
      while ($candidate -lt $StartPort + 100) {
        $candPid = Get-ListeningProcessId $candidate
        if (-not $candPid) {
          # Also verify the port is actually bindable from WSL by attempting a
          # TCP connection — wslrelay stale mappings sometimes show up here even
          # when Get-NetTCPConnection does not list them.
          return $candidate
        }
        $owner = (Get-Process -Id $candPid -ErrorAction SilentlyContinue).ProcessName
        if ($owner -eq "wslrelay") {
          $hasService = $false
          if ($Label -eq "api") {
            $hasService = Wait-Http "http://127.0.0.1:$candidate/healthz" 1 200
          } else {
            $hasService = Wait-Http "http://127.0.0.1:$candidate" 1 200
          }
          if (-not $hasService) {
            Write-WarnLine "${Label} port $candidate blocked by stale wslrelay mapping; trying next port."
            $candidate++
            continue
          }
        }
        Write-ErrorLine "Port $candidate is in use by pid=$candPid ($owner). Choose another port or free it first."
        exit 1
      }
      Write-ErrorLine "Could not find a free port for ${Label} near $StartPort after 100 attempts."
      exit 1
    }

    function Resolve-WslPort([int]$Port, [string]$Label) {
      $resolved = Find-FreePort $Port $Label
      if ($resolved -ne $Port) {
        Write-WarnLine "${Label}: using port $resolved instead of $Port."
      }
      return $resolved
    }

    $apiLogs = New-LogPaths -RuntimeDir $RuntimeDir -Prefix "api"
    $webLogs = New-LogPaths -RuntimeDir $RuntimeDir -Prefix "web"

    if ($RunEnv -eq "wsl") {
      # Resolve ports: skip any blocked by stale wslrelay mappings
      $ApiPort = Resolve-WslPort $ApiPort "api"
      $WebPort = Resolve-WslPort $WebPort "web"

      # ---------------------------------------------------------------
      # WSL mode: write launcher scripts and execute them via wsl.exe
      # ---------------------------------------------------------------

      $projectWsl = Convert-ToWslPath $ProjectRoot
      $apiDirWsl = "$projectWsl/api"
      $webDirWsl = "$projectWsl/web"

      # Write launcher scripts using .NET to guarantee no BOM
      $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
      $wslLaunchDir = Join-Path $RuntimeDir "wsl-launchers"
      if (-not (Test-Path $wslLaunchDir)) { New-Item -ItemType Directory -Path $wslLaunchDir -Force | Out-Null }

      $apiScript = Join-Path $wslLaunchDir "start-api.sh"
      $apiContent = "#!/bin/bash`ncd '$apiDirWsl'`nexec python3 -m uvicorn app.main:app --host 127.0.0.1 --port $ApiPort`n"
      [System.IO.File]::WriteAllText($apiScript, $apiContent, $utf8NoBom)

      $webScript = Join-Path $wslLaunchDir "start-web.sh"
      $webContent = "#!/bin/bash`ncd '$webDirWsl'`nexec npm run dev -- -p $WebPort -H 0.0.0.0`n"
      [System.IO.File]::WriteAllText($webScript, $webContent, $utf8NoBom)

      # chmod via wsl.exe
      $wslLaunchDirWsl = Convert-ToWslPath $wslLaunchDir
      & wsl.exe bash -lc "chmod +x '$wslLaunchDirWsl/start-api.sh' '$wslLaunchDirWsl/start-web.sh'" 2>$null

      # Quote the script path so spaces are preserved when passed to bash.
      # Start-Process -ArgumentList as a single string avoids element splitting.
      $apiScriptWsl = "$wslLaunchDirWsl/start-api.sh"
      $webScriptWsl = "$wslLaunchDirWsl/start-web.sh"

      Write-Info "Starting API in WSL on port $ApiPort ..."
      $apiProcess = Start-Process -FilePath "wsl.exe" `
        -ArgumentList "bash `"$apiScriptWsl`"" `
        -RedirectStandardOutput $apiLogs.out `
        -RedirectStandardError $apiLogs.err `
        -PassThru

      Write-Info "Starting Web in WSL on port $WebPort ..."
      $webProcess = Start-Process -FilePath "wsl.exe" `
        -ArgumentList "bash `"$webScriptWsl`"" `
        -RedirectStandardOutput $webLogs.out `
        -RedirectStandardError $webLogs.err `
        -PassThru

    } else {
      # ---------------------------------------------------------------
      # Windows mode (default): original behavior
      # ---------------------------------------------------------------
      $apiPortPid = Get-ListeningProcessId $ApiPort
      if ($apiPortPid) {
        Write-ErrorLine "Port $ApiPort is in use by pid=$apiPortPid. Choose another port or free it first."
        exit 1
      }
      $webPortPid = Get-ListeningProcessId $WebPort
      if ($webPortPid) {
        Write-ErrorLine "Port $WebPort is in use by pid=$webPortPid. Choose another port or free it first."
        exit 1
      }

      $pythonExe = Resolve-PythonExe
      $npmCmd = Resolve-NpmCmd
      $npmDir = Split-Path -Parent $npmCmd
      if ($npmDir -and ($env:Path -notlike "*$npmDir*")) {
        $env:Path = "$npmDir;$env:Path"
        Write-Info "Prepended npm directory to PATH for child processes: $npmDir"
      }

      Write-Info "Starting API on port $ApiPort ..."
      $apiProcess = Start-Process `
        -FilePath $pythonExe `
        -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$ApiPort" `
        -WorkingDirectory (Join-Path $ProjectRoot "api") `
        -RedirectStandardOutput $apiLogs.out `
        -RedirectStandardError $apiLogs.err `
        -PassThru

      Write-Info "Starting Web on port $WebPort ..."
      $webProcess = Start-Process `
        -FilePath $npmCmd `
        -ArgumentList "--prefix", "web", "run", "dev", "--", "-p", "$WebPort" `
        -WorkingDirectory $ProjectRoot `
        -RedirectStandardOutput $webLogs.out `
        -RedirectStandardError $webLogs.err `
        -PassThru
    }

    $apiMaxAttempts = if ($RunEnv -eq "wsl") { 60 } else { 30 }
    $webMaxAttempts = if ($RunEnv -eq "wsl") { 180 } else { 80 }
    $apiReady = Wait-Http -Url "http://127.0.0.1:$ApiPort/healthz" -MaxAttempts $apiMaxAttempts -SleepMs 400
    $webReady = Wait-Http -Url "http://127.0.0.1:$WebPort" -MaxAttempts $webMaxAttempts -SleepMs 400

    $state = @{
      started_at = (Get-Date).ToString("o")
      env        = $RunEnv
      api = @{
        pid  = $apiProcess.Id
        port = $ApiPort
        url  = "http://127.0.0.1:$ApiPort"
        log_out = $apiLogs.out
        log_err = $apiLogs.err
      }
      web = @{
        pid  = $webProcess.Id
        port = $WebPort
        url  = "http://127.0.0.1:$WebPort"
        log_out = $webLogs.out
        log_err = $webLogs.err
      }
    }
    $stateJson = $state | ConvertTo-Json -Depth 6
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($StateFile, $stateJson, $utf8NoBom)

    if (-not $apiReady -or -not $webReady) {
      Write-WarnLine "Service startup incomplete."
      Write-WarnLine "apiReady=$apiReady webReady=$webReady"
      Write-WarnLine "Check logs:"
      Write-WarnLine "  $($apiLogs.err)"
      Write-WarnLine "  $($webLogs.err)"
      exit 1
    }

    Write-Info "Dev stack started successfully ($RunEnv mode)."
    Write-Host "API: http://127.0.0.1:$ApiPort   pid=$($apiProcess.Id)"
    Write-Host "WEB: http://127.0.0.1:$WebPort   pid=$($webProcess.Id)"
    Write-Host "State: $StateFile"
  }

  "stop" {
    $state = Read-State $StateFile
    if (-not $state) {
      Write-WarnLine "No state file found. Nothing to stop."
      exit 0
    }

    Stop-TrackedProcess -ProcessId ([int]$state.api.pid) -Name "API"
    Stop-TrackedProcess -ProcessId ([int]$state.web.pid) -Name "WEB"

    Remove-Item -Path $StateFile -Force -ErrorAction SilentlyContinue
    Write-Info "State file removed."
  }

  "status" {
    $state = Read-State $StateFile
    if (-not $state) {
      Write-WarnLine "No running stack state found."
      exit 0
    }

    $apiProc = Get-Process -Id ([int]$state.api.pid) -ErrorAction SilentlyContinue
    $webProc = Get-Process -Id ([int]$state.web.pid) -ErrorAction SilentlyContinue
    $apiHttp = Wait-Http -Url "$($state.api.url)/healthz" -MaxAttempts 1 -SleepMs 0
    $webHttp = Wait-Http -Url "$($state.web.url)" -MaxAttempts 1 -SleepMs 0

    Write-Host "Env:  $($state.env)"
    Write-Host "API:  pid=$($state.api.pid) running=$([bool]$apiProc) http=$apiHttp url=$($state.api.url)"
    Write-Host "WEB:  pid=$($state.web.pid) running=$([bool]$webProc) http=$webHttp url=$($state.web.url)"
    Write-Host "StartedAt: $($state.started_at)"
    Write-Host "Logs:"
    Write-Host "  $($state.api.log_out)"
    Write-Host "  $($state.api.log_err)"
    Write-Host "  $($state.web.log_out)"
    Write-Host "  $($state.web.log_err)"
  }
}
