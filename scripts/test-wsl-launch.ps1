$ErrorActionPreference = "Continue"
$projectRoot = "D:\workspace\MMD project"
$runtimeDir = Join-Path $projectRoot ".runtime"
$reportPath = Join-Path $runtimeDir "wsl-launch-test-report.txt"
$devStack = Join-Path $projectRoot "scripts\dev-stack.ps1"

# Clean any old state
if (Test-Path (Join-Path $runtimeDir "dev-stack.json")) {
  & powershell -ExecutionPolicy Bypass -File $devStack -Action stop -RunEnv wsl 2>&1 | Out-Null
  Start-Sleep -Seconds 2
}

"=== WSL Launch Test Report ===" | Out-File -FilePath $reportPath -Encoding UTF8

# Start dev-stack in background
$job = Start-Job -ScriptBlock {
  param($devStack, $runtimeDir)
  & powershell -ExecutionPolicy Bypass -File $devStack -Action start -RunEnv wsl -ApiPort 8140 -WebPort 3140 2>&1
} -ArgumentList $devStack, $runtimeDir

# Wait for API (should be fast, ~5s)
Start-Sleep -Seconds 10
"--- API check (port 8140) ---" | Out-File -FilePath $reportPath -Encoding UTF8 -Append
try {
  $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8140/healthz" -UseBasicParsing -TimeoutSec 5
  "API: $($resp.StatusCode) $($resp.Content)" | Out-File -FilePath $reportPath -Encoding UTF8 -Append
} catch {
  "API: FAILED $($_.Exception.Message)" | Out-File -FilePath $reportPath -Encoding UTF8 -Append
}

# Wait for Web (first compile ~30-50s total)
Start-Sleep -Seconds 50
"--- Web check (port 3140) ---" | Out-File -FilePath $reportPath -Encoding UTF8 -Append
for ($i = 0; $i -lt 10; $i++) {
  try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:3140" -UseBasicParsing -TimeoutSec 10
    "Web: $($resp.StatusCode) (attempt $($i+1))" | Out-File -FilePath $reportPath -Encoding UTF8 -Append
    break
  } catch {
    "Web attempt $($i+1): $($_.Exception.Message)" | Out-File -FilePath $reportPath -Encoding UTF8 -Append
    Start-Sleep -Seconds 5
  }
}

# Read dev-stack output
Start-Sleep -Seconds 2
"--- dev-stack job output ---" | Out-File -FilePath $reportPath -Encoding UTF8 -Append
$jobOutput = Receive-Job -Job $job 2>&1
$jobOutput | Out-File -FilePath $reportPath -Encoding UTF8 -Append
Stop-Job -Job $job -ErrorAction SilentlyContinue
Remove-Job -Job $job -Force -ErrorAction SilentlyContinue

# Read state file
"--- State ---" | Out-File -FilePath $reportPath -Encoding UTF8 -Append
$stateFile = Join-Path $runtimeDir "dev-stack.json"
if (Test-Path $stateFile) {
  Get-Content $stateFile | Out-File -FilePath $reportPath -Encoding UTF8 -Append
} else {
  "No state file found" | Out-File -FilePath $reportPath -Encoding UTF8 -Append
}

# Read latest logs
"--- Latest API err ---" | Out-File -FilePath $reportPath -Encoding UTF8 -Append
$apiErr = Get-ChildItem (Join-Path $runtimeDir "api.*.err.log") | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($apiErr) { Get-Content $apiErr.FullName | Out-File -FilePath $reportPath -Encoding UTF8 -Append }

"--- Latest Web out ---" | Out-File -FilePath $reportPath -Encoding UTF8 -Append
$webOut = Get-ChildItem (Join-Path $runtimeDir "web.*.out.log") | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($webOut) { Get-Content $webOut.FullName | Out-File -FilePath $reportPath -Encoding UTF8 -Append }

"--- Latest Web err ---" | Out-File -FilePath $reportPath -Encoding UTF8 -Append
$webErr = Get-ChildItem (Join-Path $runtimeDir "web.*.err.log") | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($webErr) { Get-Content $webErr.FullName | Out-File -FilePath $reportPath -Encoding UTF8 -Append }

# Stop
& powershell -ExecutionPolicy Bypass -File $devStack -Action stop -RunEnv wsl 2>&1 | Out-Null

Write-Host "Done."
