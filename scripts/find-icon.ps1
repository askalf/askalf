$paths = @(
    "$env:LOCALAPPDATA\Programs\claude-desktop",
    "$env:LOCALAPPDATA\claude-desktop",
    "$env:LOCALAPPDATA\AnthropicClaude",
    "$env:PROGRAMFILES\Claude",
    "$env:LOCALAPPDATA\Programs\Claude"
)

foreach ($p in $paths) {
    if (Test-Path $p) {
        Write-Host "FOUND DIR: $p"
        Get-ChildItem -Recurse $p -Include '*.ico','*.exe' -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  FILE: $($_.FullName) ($($_.Length))" }
    }
}

# Check existing shortcuts for icon paths
$shortcuts = @(
    "$env:USERPROFILE\Desktop\Claude.lnk",
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Claude.lnk",
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\claude\Claude.lnk"
)
$WshShell = New-Object -ComObject WScript.Shell
foreach ($s in $shortcuts) {
    if (Test-Path $s) {
        $sc = $WshShell.CreateShortcut($s)
        Write-Host "SHORTCUT: $s"
        Write-Host "  Target: $($sc.TargetPath)"
        Write-Host "  Icon: $($sc.IconLocation)"
    }
}

# Broad search for claude icon
$icon = Get-ChildItem -Recurse "$env:LOCALAPPDATA" -Filter 'claude*.ico' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($icon) { Write-Host "ICO FOUND: $($icon.FullName)" }
