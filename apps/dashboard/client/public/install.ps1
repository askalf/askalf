# AskAlf CLI Installer — Windows (PowerShell)
# Usage: irm https://askalf.org/install.ps1 | iex
$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "  ▸ " -ForegroundColor Magenta -NoNewline; Write-Host $msg }
function Write-Ok($msg) { Write-Host "  ✓ " -ForegroundColor Green -NoNewline; Write-Host $msg }
function Write-Fail($msg) { Write-Host "  ✗ " -ForegroundColor Red -NoNewline; Write-Host $msg; exit 1 }

Write-Host ""
Write-Host "  askalf" -ForegroundColor Magenta -NoNewline
Write-Host " — CLI installer" -ForegroundColor DarkGray
Write-Host ""

# ── Detect architecture ──
$arch = [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture
$archLabel = switch ($arch) {
    "X64"   { "x64" }
    "Arm64" { "arm64" }
    default { Write-Fail "Unsupported architecture: $arch" }
}

Write-Step "Detected Windows $archLabel"

# ── Check for Node.js ──
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $nodeVersion = & node -v
    $nodeMajor = [int]($nodeVersion -replace 'v','').Split('.')[0]
    if ($nodeMajor -lt 20) {
        Write-Fail "Node.js 20+ required (found $nodeVersion). Update at https://nodejs.org"
    }
    Write-Ok "Node.js $nodeVersion"
} else {
    Write-Step "Node.js not found — installing..."

    # Try winget first
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Step "Installing via winget..."
        winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements -e 2>$null
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    }

    # Try chocolatey
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        $choco = Get-Command choco -ErrorAction SilentlyContinue
        if ($choco) {
            Write-Step "Installing via Chocolatey..."
            choco install nodejs-lts -y 2>$null
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        }
    }

    # Verify
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Fail "Node.js installation failed. Install manually from https://nodejs.org"
    }
    Write-Ok "Node.js $(node -v) installed"
}

# ── Check for npm ──
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Fail "npm not found. Reinstall Node.js from https://nodejs.org"
}

# ── Install AskAlf CLI ──
Write-Step "Installing AskAlf CLI..."

$installed = $false

# Method 1: npm install -g from hosted tarball URL (fastest)
if (-not $installed) {
    Write-Step "Trying tarball install..."
    try {
        $output = npm install -g "https://askalf.org/releases/cli-latest.tar.gz" 2>&1
        if ($LASTEXITCODE -eq 0) { $installed = $true }
    } catch {}
}

# Method 2: download tarball, extract, install, link
if (-not $installed) {
    try {
        $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "askalf-cli-$(Get-Random)"
        New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
        Write-Step "Downloading CLI package..."
        Invoke-WebRequest -Uri "https://askalf.org/api/v1/cli/package" -OutFile "$tmpDir\cli.tar.gz"
        Push-Location $tmpDir
        tar xzf cli.tar.gz
        Set-Location package
        npm install --production 2>$null
        npm link 2>$null
        Pop-Location
        Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
        $installed = $true
    } catch {
        Pop-Location -ErrorAction SilentlyContinue
    }
}

# Method 3: npm registry (requires registry to be configured)
if (-not $installed) {
    Write-Step "Trying npm registry..."
    try {
        $output = npm install -g "@askalf/cli@latest" --registry=https://askalf.org/npm 2>&1
        if ($LASTEXITCODE -eq 0) { $installed = $true }
    } catch {}
}

if (-not $installed) {
    Write-Fail "All installation methods failed. Try manually: npm install -g `"https://askalf.org/releases/cli-latest.tar.gz`""
}

# Refresh PATH
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

# ── Verify installation ──
if (Get-Command o8r -ErrorAction SilentlyContinue) {
    Write-Ok "AskAlf CLI installed"
} else {
    $npmPrefix = npm config get prefix 2>$null
    if ($npmPrefix -and (Test-Path "$npmPrefix\o8r.cmd")) {
        Write-Ok "AskAlf CLI installed at $npmPrefix\o8r.cmd"
        Write-Step "You may need to restart your terminal for PATH changes"
    } else {
        Write-Fail "Installation failed. Try manually: npm install -g @askalf/cli"
    }
}

# ── Configure ──
Write-Step "Configuring..."
try { & o8r config set apiUrl https://askalf.org 2>$null } catch {}

Write-Host ""
Write-Host "  Ready." -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor DarkGray
Write-Host "  1." -ForegroundColor Magenta -NoNewline
Write-Host " Get your API key from " -NoNewline; Write-Host "https://askalf.org/settings/ai-keys" -ForegroundColor Magenta
Write-Host "  2." -ForegroundColor Magenta -NoNewline
Write-Host " Run: " -NoNewline; Write-Host "o8r config set apiKey <your-key>" -ForegroundColor White
Write-Host "  3." -ForegroundColor Magenta -NoNewline
Write-Host " Run: " -NoNewline; Write-Host "o8r agent list" -ForegroundColor White
Write-Host ""
Write-Host "  Docs: https://askalf.org/docs" -ForegroundColor DarkGray
Write-Host ""
