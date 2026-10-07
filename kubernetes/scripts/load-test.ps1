# Zero-downtime test: sends a request every 200 ms and counts results,
# while you run a rolling update in another terminal.
#
#   .\load-test.ps1 -BaseUrl http://<nlb-hostname> -Seconds 120
#
# Reports server errors (5xx) separately from client-side timeouts:
# a timeout is not a server error.
param(
  [Parameter(Mandatory = $true)][string]$BaseUrl,
  [string]$Path = "/api/health",
  [int]$Seconds = 120
)

$end = (Get-Date).AddSeconds($Seconds)
$ok = 0; $serverErrors = 0; $otherHttp = 0; $timeouts = 0
$versions = @{}
$lastVersion = ""

while ((Get-Date) -lt $end) {
  try {
    $r = Invoke-WebRequest -Uri "$BaseUrl$Path" -UseBasicParsing -TimeoutSec 5
    $ok++
    if ($Path -eq "/api/health") {
      $v = ($r.Content | ConvertFrom-Json).version
      $versions[$v] = 1 + [int]$versions[$v]
      if ($v -ne $lastVersion) {
        Write-Host ("{0:HH:mm:ss}  now serving {1}" -f (Get-Date), $v)
        $lastVersion = $v
      }
    }
  } catch {
    $resp = $_.Exception.Response
    if ($resp -ne $null) {
      $code = [int]$resp.StatusCode
      if ($code -ge 500) { $serverErrors++ } else { $otherHttp++ }
      Write-Host ("{0:HH:mm:ss}  HTTP {1}" -f (Get-Date), $code)
    } else {
      $timeouts++
      Write-Host ("{0:HH:mm:ss}  no response: {1}" -f (Get-Date), $_.Exception.Message)
    }
  }
  Start-Sleep -Milliseconds 200
}

$total = $ok + $serverErrors + $otherHttp + $timeouts
Write-Host ""
Write-Host "Requests: $total   OK: $ok   5xx: $serverErrors   other HTTP errors: $otherHttp   timeouts: $timeouts"
if ($versions.Count -gt 0) {
  Write-Host "Responses by version:"
  $versions.GetEnumerator() | Sort-Object Name | ForEach-Object { Write-Host ("  {0}: {1}" -f $_.Name, $_.Value) }
}
