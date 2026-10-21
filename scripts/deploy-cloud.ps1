param(
  [ValidateSet("deploy", "api", "web", "status", "tunnel", "env")]
  [string]$Action = "deploy",
  [switch]$SkipBuild,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$CloudHost = "43.130.14.178"
$CloudUser = "root"
$SshKey = Join-Path $env:USERPROFILE ".ssh\mmd_cloud_deploy_ed25519"
$KnownHosts = Join-Path $env:USERPROFILE ".ssh\known_hosts_mmd_cloud"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ApiLocal = Join-Path $ProjectRoot "api"
$WebLocal = Join-Path $ProjectRoot "web"
$ApiRemote = "/srv/mmd-companion-api"
$WebRemote = "/srv/mmd-companion-web-full"
$ApiPort = 8100
$WebPort = 3000
$HomeMacSsh = "macCodex"

function Write-Info([string]$Msg) { Write-Host "[INFO]  $Msg" -ForegroundColor Cyan }
function Write-Ok([string]$Msg) { Write-Host "[OK]    $Msg" -ForegroundColor Green }
function Write-Warn2([string]$Msg) { Write-Host "[WARN]  $Msg" -ForegroundColor Yellow }
function Write-Err([string]$Msg) { Write-Host "[ERROR] $Msg" -ForegroundColor Red }
function Write-Step([string]$Msg) { Write-Host ""; Write-Host "=== $Msg ===" -ForegroundColor White }

function Invoke-CloudSsh([string]$Command) {
  $sshArgs = @(
    "-i", $SshKey,
    "-o", "UserKnownHostsFile=$KnownHosts",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    "$CloudUser@$CloudHost",
    $Command
  )
  $result = & ssh @sshArgs 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "SSH failed (exit=$LASTEXITCODE): $result"
  }
  return $result
}

function Invoke-CloudScp([string]$LocalPath, [string]$RemotePath) {
  $scpArgs = @(
    "-i", $SshKey,
    "-o", "UserKnownHostsFile=$KnownHosts",
    "-r",
    $LocalPath,
    "$CloudUser@${CloudHost}:$RemotePath"
  )
  & scp @scpArgs 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "SCP failed: $LocalPath to $RemotePath"
  }
}

function Sync-DirectoryTar([string]$LocalDir, [string[]]$Items, [string]$RemoteDir) {
  # 跨洋高延迟链路下 scp -r 逐文件传输会随机卡死；改为本地打包 -> 单文件 scp -> 远端解压。
  $tarFile = Join-Path ([System.IO.Path]::GetTempPath()) ("mmd-deploy-" + [guid]::NewGuid().ToString("N").Substring(0, 8) + ".tar.gz")
  try {
    Write-Info "Packing $($Items.Count) items from $LocalDir ..."
    $tarArgs = @("-czf", $tarFile, "-C", $LocalDir) + $Items
    & tar @tarArgs 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "tar pack failed" }
    $sizeMB = [math]::Round((Get-Item $tarFile).Length / 1MB, 2)
    Write-Info "Uploading tarball ($sizeMB MB) ..."
    Invoke-CloudScp $tarFile "/tmp/mmd-deploy.tar.gz"
    Invoke-CloudSsh "mkdir -p $RemoteDir && tar -xzf /tmp/mmd-deploy.tar.gz -C $RemoteDir && rm -f /tmp/mmd-deploy.tar.gz"
    Write-Ok "Synced $LocalDir -> $RemoteDir"
  } finally {
    Remove-Item $tarFile -ErrorAction SilentlyContinue
  }
}

function Test-CloudConnection {
  try {
    Invoke-CloudSsh "echo CONNECTED" | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Assert-Prerequisites {
  if (-not (Test-Path $SshKey)) { throw "SSH key not found: $SshKey" }
  if (-not (Test-Path $ApiLocal)) { throw "API dir not found: $ApiLocal" }
  if (-not (Test-Path $WebLocal)) { throw "Web dir not found: $WebLocal" }
  Write-Ok "Prerequisites OK"
}

function Sync-ApiCode {
  Write-Step "Syncing API code"
  Invoke-CloudSsh "mkdir -p $ApiRemote/api/app $ApiRemote/api/data"
  Sync-DirectoryTar $ApiLocal @("app", "pyproject.toml", "requirements.txt") "$ApiRemote/api"
  Write-Ok "API code synced"
}

function Sync-WebCode {
  Write-Step "Syncing Web code"
  Invoke-CloudSsh "mkdir -p $WebRemote"
  $items = @("src", "public", "scripts", "package.json", "package-lock.json", "next.config.mjs", "tsconfig.json", "next-env.d.ts")
  Sync-DirectoryTar $WebLocal $items $WebRemote
  Write-Ok "Web code synced"
}

function Sync-EnvConfig {
  Write-Step "Syncing .env config"
  $envFile = Join-Path $ApiLocal ".env.cloud"
  if (-not (Test-Path $envFile)) {
    $envFile = Join-Path $ApiLocal ".env"
    Write-Warn2 "No .env.cloud found, using local .env"
  }
  Invoke-CloudScp $envFile "$ApiRemote/api/.env"
  Write-Ok ".env synced"
}

function Build-WebRemote {
  Write-Step "Building frontend on cloud"
  Write-Info "Installing dependencies..."
  Invoke-CloudSsh "cd $WebRemote && npm install --production=false 2>&1 | tail -3"
  Write-Info "Building..."
  Invoke-CloudSsh "cd $WebRemote && npm run build 2>&1 | tail -10"
  Write-Ok "Frontend built"
}

function Restart-ApiService {
  Write-Step "Restarting FastAPI"
  $cmd = "pkill -f 'uvicorn app.main:app' || true; sleep 2; cd $ApiRemote/api && . ../venv/bin/activate && nohup python -m uvicorn app.main:app --host 127.0.0.1 --port $ApiPort > /var/log/mmd-api.log 2>&1 & sleep 5; ss -lntp | grep $ApiPort"
  Invoke-CloudSsh $cmd
  Write-Ok "FastAPI restarted on 127.0.0.1:$ApiPort"
}

function Restart-WebService {
  Write-Step "Restarting Next.js"
  $cmd = "pkill -f 'next-server' || true; sleep 2; cd $WebRemote && NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:$ApiPort nohup npm start > /var/log/next-serve.log 2>&1 & sleep 8; ss -lntp | grep $WebPort"
  Invoke-CloudSsh $cmd
  Write-Ok "Next.js restarted on 127.0.0.1:$WebPort"
}

function Rebuild-Tunnel {
  Write-Step "Rebuilding reverse SSH tunnel"

  $tunnelRunning = $false
  try {
    $checkResult = ssh $HomeMacSsh 'ps aux | grep "ssh.*18789" | grep -v grep' 2>$null
    $tunnelRunning = ($LASTEXITCODE -eq 0 -and $checkResult)
  } catch {}

  if ($tunnelRunning) {
    Write-Info "Killing old tunnel..."
    ssh $HomeMacSsh 'pkill -f "ssh.*-R.*18789.*43.130.14.178" || true' 2>$null
    Start-Sleep -Seconds 2
  }

  Write-Info "Starting tunnel from home Mac..."
  ssh $HomeMacSsh 'nohup ssh -i ~/.ssh/tencent_cloud -N -R 127.0.0.1:18789:127.0.0.1:18789 -R 127.0.0.1:5555:127.0.0.1:5555 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new root@43.130.14.178 > /tmp/mmd-tunnel.log 2>&1 &'
  Start-Sleep -Seconds 5

  $verifyResult = ssh $HomeMacSsh 'ps aux | grep "ssh.*18789" | grep -v grep' 2>$null
  if ($LASTEXITCODE -eq 0 -and $verifyResult) {
    Write-Ok "Reverse tunnel established"
  } else {
    Write-Err "Tunnel failed - check home Mac SSH key and network"
  }
}

function Test-Deployment {
  Write-Step "Verifying deployment"

  $checks = @(
    @{ Name = "HTTPS Home"; Url = "https://${CloudHost}/"; Expect = 200 },
    @{ Name = "Companion Page"; Url = "https://${CloudHost}/companion"; Expect = 200 },
    @{ Name = "API Health"; Url = "https://${CloudHost}/api/healthz"; Expect = 200 },
    @{ Name = "OpenClaw"; Url = "https://${CloudHost}/api/healthz/openclaw"; Expect = 200 },
    @{ Name = "MMD Models"; Url = "https://${CloudHost}/api/assets/mmd/models"; Expect = 200 },
    @{ Name = "Static Assets"; Url = "https://${CloudHost}/images/loginV2/aether-mark-crop.png"; Expect = 200 }
  )

  $allOk = $true
  foreach ($check in $checks) {
    $status = 0
    $body = ""
    try {
      $response = Invoke-WebRequest -Uri $check.Url -Method GET -SkipCertificateCheck -TimeoutSec 15 -ErrorAction Stop
      $status = [int]$response.StatusCode
      $body = $response.Content
    } catch {
      if ($_.Exception.Response) {
        $status = [int]($_.Exception.Response.StatusCode)
      }
      try { $body = $_.ErrorDetails.Message } catch {}
    }

    $pass = ($status -eq $check.Expect)
    if ($pass) {
      Write-Ok "$($check.Name) -- HTTP $status"
    } else {
      Write-Err "$($check.Name) -- HTTP $status (expected $($check.Expect))"
      $allOk = $false
    }
  }

  Write-Host ""
  if ($allOk) {
    Write-Ok "All checks passed! Visit https://${CloudHost}/"
  } else {
    Write-Warn2 "Some checks failed"
  }
  return $allOk
}

function Show-Status {
  Write-Step "Cloud service status"

  $services = Invoke-CloudSsh "ps aux | grep -E 'uvicorn|next-server|nginx' | grep -v grep; echo '---'; ss -lntp | grep -E '${ApiPort}|${WebPort}|443|80'; echo '---'; systemctl is-active nginx; echo '---'; df -h / | tail -1; echo '---'; free -h | grep Mem"
  Write-Host $services

  Write-Info "Checking tunnel..."
  try {
    $tunnelCheck = ssh $HomeMacSsh 'ps aux | grep "ssh.*18789" | grep -v grep' 2>$null
    if ($LASTEXITCODE -eq 0 -and $tunnelCheck) {
      Write-Ok "Reverse tunnel running"
    } else {
      Write-Warn2 "Reverse tunnel NOT running"
    }
  } catch {
    Write-Warn2 "Cannot reach home Mac"
  }
}

Write-Host ""
Write-Host "  MMD Companion Cloud Deploy" -ForegroundColor Cyan
Write-Host "  Target: $CloudHost" -ForegroundColor Cyan
Write-Host ""

Assert-Prerequisites

if (-not (Test-CloudConnection)) {
  Write-Err "Cannot connect to $CloudHost"
  Write-Info "Check: 1) network  2) SSH key  3) Tencent Cloud security group port 22"
  exit 1
}
Write-Ok "Cloud connection OK"

switch ($Action) {
  "deploy" {
    Sync-ApiCode
    Sync-WebCode
    Sync-EnvConfig
    if (-not $SkipBuild) { Build-WebRemote }
    Restart-ApiService
    Restart-WebService
    Rebuild-Tunnel
    Test-Deployment
  }
  "api" {
    Sync-ApiCode
    Sync-EnvConfig
    Restart-ApiService
    Test-Deployment
  }
  "web" {
    Sync-WebCode
    if (-not $SkipBuild) { Build-WebRemote }
    Restart-WebService
    Test-Deployment
  }
  "env" {
    Sync-EnvConfig
    Restart-ApiService
    Write-Ok "Config updated and API restarted"
  }
  "tunnel" {
    Rebuild-Tunnel
  }
  "status" {
    Show-Status
  }
}

Write-Host ""
