# Starts the HALA server WITH the phone line, ready for the HALA Phone app.
#
#   .\start-phone-demo.ps1            start it (stops if something else is already on port 3005)
#   .\start-phone-demo.ps1 -Force     stop whatever is on port 3005 first (e.g. the older server without /api/phone)
#
# The cloudflared tunnel you already run keeps working: it points at http://localhost:3005, which this serves.
param([switch]$Force)

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
npm run agent:dev
