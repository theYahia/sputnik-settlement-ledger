param(
  [Parameter(Mandatory = $true)][string]$File,
  [Parameter(Mandatory = $true)][string]$Stage
)
# Runs every `near ...` line of one "# --- <stage>" block of a generated commands file,
# in order, and stops at the first failure. Prints each command before running it.
$ErrorActionPreference = "Stop"
$lines = Get-Content -LiteralPath $File -Encoding UTF8
$active = $false
$count = 0
foreach ($line in $lines) {
  if ($line -match '^# --- (.+)$') { $active = ($Matches[1] -eq $Stage); continue }
  if (-not $active -or $line -notmatch '^near ') { continue }
  $count++
  Write-Host ""
  Write-Host ">>> [$count] $line" -ForegroundColor Cyan
  Invoke-Expression $line
  if ($LASTEXITCODE -ne 0) { Write-Host "FAILED (exit $LASTEXITCODE): stopping" -ForegroundColor Red; exit 1 }
}
if ($count -eq 0) { Write-Host "no commands found for stage '$Stage'" -ForegroundColor Yellow; exit 2 }
Write-Host ""
Write-Host "stage '$Stage' done: $count command(s)" -ForegroundColor Green
