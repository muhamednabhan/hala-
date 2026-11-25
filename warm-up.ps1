# Pre-flight check AND warm-up for the HALA server. Run it any time, and always right before the robot test.
#
#   .\warm-up.ps1
#
# It writes no data: it only reads, and sends six tool calls with deliberately empty input that those tools reject as
# "invalid_input" before they touch the database (verified: no rows are created). It checks, in this order:
#   1. the server answers on this laptop and uses the Supabase store
#   2. the public tunnel (PUBLIC_BASE_URL) reaches this server  -> this is the path ElevenLabs uses for tools
#   3. every agent tool route accepts our secret through the tunnel and answers fast
#   4. the robot's status (online? bridge version? how long ago did it check in?)
# A line that says PROBLEM tells you what to fix. Exit code 1 when anything is wrong.
param([int]$Port = 3005)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path .env.hala)) { Write-Host "Missing .env.hala" -ForegroundColor Red; exit 1 }

$cfg = @{}
foreach ($line in Get-Content .env.hala) {
  if ($line -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$') { $cfg[$Matches[1]] = $Matches[2].Trim('"') }
}
$local = "http://localhost:$Port"
$tunnel = "$($cfg['PUBLIC_BASE_URL'])".TrimEnd('/')
$script:bad = 0

function Call([string]$url, [string]$method = 'GET', $headers = @{}, [string]$body = $null) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $status = 0; $text = ''
  try {
    $args2 = @{ Uri = $url; Method = $method; Headers = $headers; UseBasicParsing = $true; TimeoutSec = 20 }
    if ($body) { $args2.Body = $body; $args2.ContentType = 'application/json' }
    $r = Invoke-WebRequest @args2
    $status = [int]$r.StatusCode; $text = $r.Content
  } catch {
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      try { $text = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch { }
    } else { $text = $_.Exception.Message }
  }
  [pscustomobject]@{ Status = $status; Ms = [int]$sw.ElapsedMilliseconds; Text = $text }
}
function Report([string]$what, $r, [bool]$ok, [string]$fix) {
  $line = '{0,-44} http {1,3}  {2,5} ms' -f $what, $r.Status, $r.Ms
  if ($ok -and $r.Ms -le 1500) { Write-Host "  OK       $line" -ForegroundColor Green }
  elseif ($ok) { Write-Host "  SLOW     $line" -ForegroundColor Yellow }
  else { Write-Host "  PROBLEM  $line" -ForegroundColor Red; Write-Host "           $fix" -ForegroundColor Red; $script:bad++ }
}

Write-Host "HALA pre-flight" -ForegroundColor Cyan

# 1. the server on this laptop
$h = Call "$local/api/health"
$store = ''
try { $store = ($h.Text | ConvertFrom-Json).store } catch { }
Report 'server on this laptop' $h ($h.Status -eq 200) "Nothing answers on port $Port. Start it with .\start-phone-demo.ps1"
if ($h.Status -eq 200 -and $store -ne 'supabase') { Write-Host "  PROBLEM  the server uses the '$store' store, not Supabase (bookings will not reach the dashboard)" -ForegroundColor Red; $script:bad++ }

# 2. the tunnel
if (-not $tunnel) { Write-Host "  PROBLEM  PUBLIC_BASE_URL is empty in .env.hala" -ForegroundColor Red; $script:bad++ }
else {
  $t = Call "$tunnel/api/health"
  Report 'public tunnel -> this server' $t ($t.Status -eq 200) "The tunnel does not reach the server (a 502 means the server is down, 530/1033 means cloudflared stopped or the URL changed). If the URL changed: put the new one in .env.hala and run agent:sync for web, robot and phone, and change HALA_URL on the robot."
}

# 3. every tool route, through the tunnel, with our secret and empty input
if ($tunnel -and $cfg['HALA_TOOL_SECRET']) {
  # Only tools that REQUIRE input, plus get_linked_phone (a pure read: it also builds the phone service, ~1 s, so the first
  # QR or booking of a session does not pay for it). request_phone_link accepts an empty call and would create a link
  # code and a "QR on screen" event, so it is never called here.
  $r = Call "$tunnel/api/tools/get_linked_phone" 'POST' @{ 'x-hala-secret' = $cfg['HALA_TOOL_SECRET'] } '{"conversation_id":"preflight"}'
  Report 'tool get_linked_phone (also warms phone)' $r (($r.Status -eq 200) -and ($r.Text -match '"found":false')) 'Unexpected answer from get_linked_phone.'
  foreach ($tool in 'find_service', 'list_slots', 'lookup_fact', 'service_process', 'book_appointment', 'handover_to_human') {
    $r = Call "$tunnel/api/tools/$tool" 'POST' @{ 'x-hala-secret' = $cfg['HALA_TOOL_SECRET'] } '{"conversation_id":"preflight"}'
    $good = ($r.Status -eq 200) -and ($r.Text -match 'invalid_input')
    Report "tool $tool (through the tunnel)" $r $good $(if ($r.Status -eq 401) { 'The server rejected the tool secret: HALA_TOOL_SECRET changed after the agents were synced. Run agent:sync.' } else { 'Unexpected answer: ' + $r.Text.Substring(0, [Math]::Min(120, $r.Text.Length)) })
  }
}

# 4. the robot
if ($cfg['HALA_ADMIN_KEY']) {
  $rb = Call "$local/api/robots" 'GET' @{ 'x-hala-admin-key' = $cfg['HALA_ADMIN_KEY'] }
  Report 'robot list (database read)' $rb ($rb.Status -eq 200) 'The robots list failed: check the Supabase settings in .env.hala.'
  if ($rb.Status -eq 200) {
    $list = ($rb.Text | ConvertFrom-Json).robots
    if (-not $list) { Write-Host "  NOTE     no robot is paired yet (add one on the Robot page)" -ForegroundColor Yellow }
    foreach ($x in $list) {
      $seen = if ($x.lastSeen) { [int]((Get-Date).ToUniversalTime() - ([datetime]$x.lastSeen).ToUniversalTime()).TotalSeconds } else { -1 }
      $col = if ($x.status -eq 'online') { 'Green' } else { 'Yellow' }
      Write-Host ("  ROBOT    {0}: {1}, bridge {2}, last seen {3}s ago, wants: {4}" -f $x.name, $x.status, $x.bridgeVersion, $seen, $x.desired) -ForegroundColor $col
    }
  }
}

if ($cfg['PUBLIC_BASE_URL']) { Write-Host "  Tunnel URL in .env.hala: $tunnel (the robot's HALA_URL must be exactly this)" }
if (Get-Process cloudflared -ErrorAction SilentlyContinue) { Write-Host "  OK       cloudflared is running" -ForegroundColor Green }
else { Write-Host "  PROBLEM  cloudflared is not running" -ForegroundColor Red; $script:bad++ }

if ($script:bad) { Write-Host "`n$($script:bad) problem(s). Fix them before the test." -ForegroundColor Red; exit 1 }
Write-Host "`nAll good. The server is warm." -ForegroundColor Green
