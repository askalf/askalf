<#
.SYNOPSIS
  Build one or more services and report correct exit codes.
.USAGE
  powershell -NoProfile -File scripts/build.ps1 forge
  powershell -NoProfile -File scripts/build.ps1 forge dashboard
  powershell -NoProfile -File scripts/build.ps1 forge -NoCache
#>

param(
    [Parameter(Mandatory=$true, Position=0, ValueFromRemainingArguments=$true)]
    [string[]]$Args
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

# Separate flags from service names
$services = @()
$noCache = $false
foreach ($arg in $Args) {
    if ($arg -eq "-NoCache" -or $arg -eq "--no-cache") {
        $noCache = $true
    } else {
        $services += $arg
    }
}

if ($services.Count -eq 0) {
    Write-Host "ERROR: No services specified" -ForegroundColor Red
    Write-Host "Usage: build.ps1 <service> [service2] [-NoCache]"
    exit 1
}

$serviceList = $services -join ", "
Write-Host "Building: $serviceList$(if ($noCache) { ' (no-cache)' })" -ForegroundColor Cyan

$buildArgs = @(
    "compose", "-f", "docker-compose.prod.yml",
    "--env-file", ".env.production",
    "build"
)

if ($noCache) {
    $buildArgs += "--no-cache"
}

$buildArgs += $services

$startTime = Get-Date

# Run the build, streaming output
$process = Start-Process -FilePath "docker" -ArgumentList $buildArgs -NoNewWindow -PassThru -Wait
$duration = ((Get-Date) - $startTime).TotalSeconds

if ($process.ExitCode -eq 0) {
    Write-Host ""
    Write-Host "BUILD SUCCESS: $serviceList ($([math]::Round($duration))s)" -ForegroundColor Green
    exit 0
} else {
    Write-Host ""
    Write-Host "BUILD FAILED: $serviceList (exit code $($process.ExitCode), $([math]::Round($duration))s)" -ForegroundColor Red
    exit $process.ExitCode
}
