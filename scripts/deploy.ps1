<#
.SYNOPSIS
  Deploy one or more services (build + restart). Reports correct exit codes.
.USAGE
  powershell -NoProfile -File scripts/deploy.ps1 forge
  powershell -NoProfile -File scripts/deploy.ps1 forge dashboard
  powershell -NoProfile -File scripts/deploy.ps1 forge -NoCache
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
    Write-Host "Usage: deploy.ps1 <service> [service2] [-NoCache]"
    exit 1
}

$serviceList = $services -join ", "

# ===== STEP 1: BUILD =====
Write-Host "=== BUILD: $serviceList$(if ($noCache) { ' (no-cache)' }) ===" -ForegroundColor Cyan

$buildArgs = @(
    "compose", "-f", "docker-compose.prod.yml",
    "--env-file", ".env.production",
    "build"
)
if ($noCache) { $buildArgs += "--no-cache" }
$buildArgs += $services

$startTime = Get-Date
$proc = Start-Process -FilePath "docker" -ArgumentList $buildArgs -NoNewWindow -PassThru -Wait
$buildTime = [math]::Round(((Get-Date) - $startTime).TotalSeconds)

if ($proc.ExitCode -ne 0) {
    Write-Host "BUILD FAILED (exit $($proc.ExitCode), ${buildTime}s)" -ForegroundColor Red
    exit $proc.ExitCode
}
Write-Host "Build complete (${buildTime}s)" -ForegroundColor Green

# ===== STEP 2: RESTART =====
Write-Host ""
Write-Host "=== DEPLOY: $serviceList ===" -ForegroundColor Cyan

$upArgs = @(
    "compose", "-f", "docker-compose.prod.yml",
    "--env-file", ".env.production",
    "up", "-d", "--no-deps"
) + $services

$proc = Start-Process -FilePath "docker" -ArgumentList $upArgs -NoNewWindow -PassThru -Wait

if ($proc.ExitCode -ne 0) {
    Write-Host "DEPLOY FAILED (exit $($proc.ExitCode))" -ForegroundColor Red
    exit $proc.ExitCode
}

# ===== STEP 3: VERIFY =====
Write-Host ""
Write-Host "=== VERIFY ===" -ForegroundColor Cyan
Start-Sleep -Seconds 5

$allHealthy = $true
foreach ($svc in $services) {
    $containerName = "askalf-$svc"
    $status = docker inspect --format '{{.State.Status}}' $containerName 2>$null
    $health = docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' $containerName 2>$null

    if ($status -eq "running") {
        Write-Host "  $svc : running ($health)" -ForegroundColor Green
    } else {
        Write-Host "  $svc : $status" -ForegroundColor Red
        $allHealthy = $false
    }
}

Write-Host ""
if ($allHealthy) {
    $totalTime = [math]::Round(((Get-Date) - $startTime).TotalSeconds)
    Write-Host "DEPLOY SUCCESS: $serviceList (${totalTime}s total)" -ForegroundColor Green
    exit 0
} else {
    Write-Host "DEPLOY WARNING: Some services not running" -ForegroundColor Yellow
    exit 1
}
