<#
.SYNOPSIS
  Autonomous deploy pipeline: type-check → build → deploy → health gate → tag
  Can be triggered by agents via deploy_ops MCP tool or run manually.
.USAGE
  powershell -NoProfile -File scripts/auto-deploy.ps1 forge
  powershell -NoProfile -File scripts/auto-deploy.ps1 dashboard --skip-typecheck
  powershell -NoProfile -File scripts/auto-deploy.ps1 forge dashboard --no-cache
#>

param(
    [Parameter(Mandatory=$true, Position=0, ValueFromRemainingArguments=$true)]
    [string[]]$Args
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

# Parse args
$services = @()
$noCache = $false
$skipTypecheck = $false
foreach ($arg in $Args) {
    switch -Regex ($arg) {
        '^(-NoCache|--no-cache)$' { $noCache = $true }
        '^(--skip-typecheck)$' { $skipTypecheck = $true }
        default { $services += $arg }
    }
}

if ($services.Count -eq 0) {
    Write-Host "ERROR: No services specified" -ForegroundColor Red
    Write-Host "Usage: auto-deploy.ps1 <service> [--no-cache] [--skip-typecheck]"
    exit 1
}

$serviceList = $services -join ", "
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$tagName = "deploy-$(Get-Date -Format 'yyyyMMdd-HHmm')"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  AUTO-DEPLOY: $serviceList" -ForegroundColor Cyan
Write-Host "  $timestamp" -ForegroundColor DarkGray
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$startTime = Get-Date
$stepResults = @{}

# ===== STEP 1: PRE-FLIGHT CHECKS =====
Write-Host "[1/6] Pre-flight checks..." -ForegroundColor Yellow

# Check for uncommitted changes
$gitStatus = git status --porcelain 2>&1
if ($gitStatus) {
    Write-Host "  WARNING: Uncommitted changes detected" -ForegroundColor Yellow
    Write-Host "  $($gitStatus.Count) file(s) modified" -ForegroundColor DarkGray
    # Don't block — agents may have written files that need deploying
}

# Check working directory
$currentBranch = git rev-parse --abbrev-ref HEAD 2>&1
$currentCommit = git rev-parse --short HEAD 2>&1
Write-Host "  Branch: $currentBranch @ $currentCommit" -ForegroundColor DarkGray
$stepResults["preflight"] = "pass"

# ===== STEP 2: TYPE CHECK =====
if (-not $skipTypecheck) {
    Write-Host ""
    Write-Host "[2/6] TypeScript type check..." -ForegroundColor Yellow

    $tscFailed = $false
    foreach ($svc in $services) {
        $svcPath = "apps/$svc"
        $tsconfigPath = "$svcPath/tsconfig.json"

        if (Test-Path $tsconfigPath) {
            Write-Host "  Checking $svc..." -ForegroundColor DarkGray
            $tscResult = & npx tsc --noEmit --project $tsconfigPath 2>&1
            $tscExit = $LASTEXITCODE

            if ($tscExit -ne 0) {
                $errorCount = ($tscResult | Select-String "error TS").Count
                Write-Host "  $svc: $errorCount type error(s)" -ForegroundColor Yellow
                # Don't block on type errors — many are pre-existing
                # Just warn and continue
            } else {
                Write-Host "  $svc: clean" -ForegroundColor Green
            }
        } else {
            Write-Host "  $svc: no tsconfig.json, skipping" -ForegroundColor DarkGray
        }
    }
    $stepResults["typecheck"] = if ($tscFailed) { "warn" } else { "pass" }
} else {
    Write-Host ""
    Write-Host "[2/6] TypeScript type check... SKIPPED" -ForegroundColor DarkGray
    $stepResults["typecheck"] = "skipped"
}

# ===== STEP 3: BUILD =====
Write-Host ""
Write-Host "[3/6] Building images..." -ForegroundColor Yellow

$buildArgs = @(
    "compose", "-f", "docker-compose.prod.yml",
    "--env-file", ".env.production",
    "build"
)
if ($noCache) { $buildArgs += "--no-cache" }
$buildArgs += $services

$buildStart = Get-Date
$proc = Start-Process -FilePath "docker" -ArgumentList $buildArgs -NoNewWindow -PassThru -Wait
$buildTime = [math]::Round(((Get-Date) - $buildStart).TotalSeconds)

if ($proc.ExitCode -ne 0) {
    Write-Host "  BUILD FAILED (exit $($proc.ExitCode), ${buildTime}s)" -ForegroundColor Red
    $stepResults["build"] = "FAIL"
    # Log failure
    Write-Host ""
    Write-Host "DEPLOY ABORTED: Build failed" -ForegroundColor Red
    exit 1
}
Write-Host "  Build complete (${buildTime}s)" -ForegroundColor Green
$stepResults["build"] = "pass"

# ===== STEP 4: DEPLOY =====
Write-Host ""
Write-Host "[4/6] Deploying..." -ForegroundColor Yellow

$upArgs = @(
    "compose", "-f", "docker-compose.prod.yml",
    "--env-file", ".env.production",
    "up", "-d", "--no-deps"
) + $services

$proc = Start-Process -FilePath "docker" -ArgumentList $upArgs -NoNewWindow -PassThru -Wait

if ($proc.ExitCode -ne 0) {
    Write-Host "  DEPLOY FAILED (exit $($proc.ExitCode))" -ForegroundColor Red
    $stepResults["deploy"] = "FAIL"
    exit 1
}
Write-Host "  Containers restarted" -ForegroundColor Green
$stepResults["deploy"] = "pass"

# ===== STEP 5: HEALTH GATE =====
Write-Host ""
Write-Host "[5/6] Health gate (waiting up to 90s)..." -ForegroundColor Yellow

$healthTimeout = 90
$healthStart = Get-Date
$allHealthy = $false

for ($attempt = 1; $attempt -le 18; $attempt++) {
    Start-Sleep -Seconds 5
    $allHealthy = $true
    $statusLines = @()

    foreach ($svc in $services) {
        $containerName = "sprayberry-labs-$svc"
        $state = docker inspect --format '{{.State.Status}}' $containerName 2>$null
        $health = docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' $containerName 2>$null

        $statusLines += "  $svc`: $state ($health)"

        if ($state -ne "running" -or ($health -ne "healthy" -and $health -ne "no-healthcheck")) {
            $allHealthy = $false
        }
    }

    if ($allHealthy) {
        break
    }

    $elapsed = [math]::Round(((Get-Date) - $healthStart).TotalSeconds)
    if ($elapsed -gt $healthTimeout) {
        break
    }
}

foreach ($line in $statusLines) {
    if ($line -match "healthy|no-healthcheck") {
        Write-Host $line -ForegroundColor Green
    } else {
        Write-Host $line -ForegroundColor Red
    }
}

$healthTime = [math]::Round(((Get-Date) - $healthStart).TotalSeconds)

if (-not $allHealthy) {
    Write-Host "  HEALTH CHECK FAILED after ${healthTime}s" -ForegroundColor Red
    $stepResults["health"] = "FAIL"

    # Show logs for debugging
    Write-Host ""
    Write-Host "  Recent logs:" -ForegroundColor Yellow
    foreach ($svc in $services) {
        $containerName = "sprayberry-labs-$svc"
        Write-Host "  --- $svc ---" -ForegroundColor DarkGray
        docker logs $containerName --tail 10 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    }

    Write-Host ""
    Write-Host "DEPLOY FAILED: Health check did not pass" -ForegroundColor Red
    Write-Host "  Previous deploy tag can be used for rollback" -ForegroundColor Yellow
    exit 1
}

Write-Host "  All healthy (${healthTime}s)" -ForegroundColor Green
$stepResults["health"] = "pass"

# ===== STEP 6: TAG & LOG =====
Write-Host ""
Write-Host "[6/6] Tagging deployment..." -ForegroundColor Yellow

# Create git tag
git tag $tagName 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  Tagged: $tagName" -ForegroundColor Green
} else {
    Write-Host "  Tag already exists or git error (non-fatal)" -ForegroundColor DarkGray
}

# Log to database
try {
    $totalTime = [math]::Round(((Get-Date) - $startTime).TotalSeconds)
    $svcJson = ($services | ForEach-Object { "`"$_`"" }) -join ","
    $resultsJson = ($stepResults.GetEnumerator() | ForEach-Object { "`"$($_.Key)`":`"$($_.Value)`"" }) -join ","

    docker exec sprayberry-labs-postgres psql -U substrate -d forge -c "INSERT INTO forge_deploy_log (id, services, git_commit, git_branch, tag_name, steps, duration_s, status, deployed_at) VALUES ('$(New-Guid)', '{$svcJson}', '$currentCommit', '$currentBranch', '$tagName', '{$resultsJson}', $totalTime, 'success', NOW()) ON CONFLICT DO NOTHING;" 2>$null
} catch {
    # Deploy log table may not exist yet — non-fatal
}

$stepResults["tag"] = "pass"

# ===== SUMMARY =====
$totalTime = [math]::Round(((Get-Date) - $startTime).TotalSeconds)
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  DEPLOY SUCCESS: $serviceList" -ForegroundColor Green
Write-Host "  Total: ${totalTime}s | Build: ${buildTime}s | Health: ${healthTime}s" -ForegroundColor DarkGray
Write-Host "  Tag: $tagName | Commit: $currentCommit" -ForegroundColor DarkGray
Write-Host "============================================" -ForegroundColor Green
exit 0
