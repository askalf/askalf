$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\Alf.lnk")
$Shortcut.TargetPath = "C:\Program Files\Git\bin\bash.exe"
$Shortcut.Arguments = '-l "C:/Users/masterm1nd.DOCK/Desktop/recover/substrate/scripts/claude-with-memory.sh"'
$Shortcut.WorkingDirectory = "C:\Users\masterm1nd.DOCK\Desktop\recover\substrate"
$Shortcut.Description = "Alf - Autonomous AI Platform"
$Shortcut.IconLocation = "$env:USERPROFILE\.local\bin\claude-real.exe,0"
$Shortcut.Save()
Write-Host "Shortcut updated with Claude icon"
