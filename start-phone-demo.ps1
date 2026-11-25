# Starts the HALA server WITH the phone line, ready for the HALA Phone app.
#
#   .\start-phone-demo.ps1            start it (stops if something else is already on port 3005)
#   .\start-phone-demo.ps1 -Force     stop whatever is on port 3005 first (e.g. the older server without /api/phone)
#   .\start-phone-demo.ps1 -NoBuild   skip the 30 s build (only if nothing changed since the last build)
#   .\start-phone-demo.ps1 -Dev       the slow development server (UI work only, never for a robot test)
#
# It builds and runs the PRODUCTION server, then runs warm-up.ps1 (pre-flight check) automatically.
# The cloudflared tunnel you already run keeps working: it points at http://localhost:3005, which this serves.
# If scripts are blocked on this PC:  powershell -ExecutionPolicy Bypass -File .\start-phone-demo.ps1 -Force
param([switch]$Force, [switch]$NoBuild, [switch]$Dev)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$listener = Get-NetTCPConnection -LocalPort 3005 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  if (-not $Force) {
    Write-Host "Something is already listening on port 3005 (process $($listener.OwningProcess))." -ForegroundColor Yellow
    Write-Host "If it is an older HALA server it does not have the phone line. Re-run with -Force to replace it."
    exit 1
  }
  Stop-Process -Id $listener.OwningProcess -Force
  Start-Sleep -Seconds 2
}

if (-not (Test-Path node_modules)) { npm install }
if (-not (Test-Path .env.hala)) { Write-Host "Missing .env.hala (copy it from the main HALA checkout)." -ForegroundColor Red; exit 1 }

# Phone agent: create/update it once so its tools point at the current PUBLIC_BASE_URL.
if (-not (Select-String -Path .env.hala -Pattern '^HALA_AGENT_ID_PHONE=' -Quiet)) {
  Write-Host "Creating the phone agent..."
  npm run agent:sync -- --channel phone
}

Write-Host ""
Write-Host "Starting the HALA server on http://localhost:3005 ..." -ForegroundColor Green
Write-Host "  Robot page with the QR code:  http://localhost:3005"
Write-Host "  What is ready:                http://localhost:3005/api/phone/status"
Write-Host ""

# PRODUCTION build by default. `next dev` compiles every route the first time it is called (about 7 s for the tool route),
# which is longer than the agent's 8 s tool timeout: the first booking-related tool call of a fresh server failed twice
# on 24 Nov. A production server has no such compile step. -Dev brings the old behaviour back (hot reload for UI work).
if ($Dev) {
  Write-Host "DEV mode: the first call of each route is slow. Do not use this for the robot test." -ForegroundColor Yellow
  npm run agent:dev
  exit
}

if (-not $NoBuild) {
  Write-Host "Building the production server (about 30 seconds) ..."
  npm run build -w "@hala/talk-app"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "The build FAILED. Starting the dev server instead; then run .\warm-up.ps1 once before any test." -ForegroundColor Red
    npm run agent:dev
    exit
  }
}

$server = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "start", "-w", "@hala/talk-app" -NoNewWindow -PassThru
$ready = $false
for ($i = 0; $i -lt 60 -and -not $server.HasExited; $i++) {
  try { if ((Invoke-WebRequest -Uri "http://localhost:3005/api/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { $ready = $true; break } } catch { }
  Start-Sleep -Seconds 1
}
if ($ready) {
  & "$PSScriptRoot\warm-up.ps1"
  Write-Host "`nThe server keeps running in this window. Close it (or press Ctrl+C) to stop." -ForegroundColor Green
} else {
  Write-Host "The server did not answer within 60 seconds. Look at the messages above." -ForegroundColor Red
}
Wait-Process -Id $server.Id -ErrorAction SilentlyContinue
