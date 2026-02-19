# nginx-stats.ps1 — Parse persistent nginx logs for daily usage stats
# Usage: powershell -NoProfile -File scripts/nginx-stats.ps1 [domain]
# Examples:
#   powershell -NoProfile -File scripts/nginx-stats.ps1                  # all sites
#   powershell -NoProfile -File scripts/nginx-stats.ps1 amnesia.tax      # amnesia.tax only
#   powershell -NoProfile -File scripts/nginx-stats.ps1 integration.tax  # integration.tax only

param([string]$Domain = "")

$Container = "sprayberry-labs-nginx"
$Log = "/var/log/nginx/access.log"

Write-Host "=== nginx stats ===" -ForegroundColor Cyan
Write-Host "Domain: $(if ($Domain) { $Domain } else { 'all' })"
Write-Host ""

# Get logs from container
if ($Domain) {
    $lines = docker exec $Container sh -c "grep '""$Domain""' $Log 2>/dev/null"
} else {
    $lines = docker exec $Container sh -c "cat $Log 2>/dev/null"
}

if (-not $lines -or $lines.Count -eq 0) {
    Write-Host "No log data found."
    exit 0
}

# Ensure $lines is an array
if ($lines -is [string]) { $lines = @($lines) }

Write-Host "--- Daily Requests ---" -ForegroundColor Yellow
$dailyCounts = @{}
$dailySearches = @{}
$dailyIPs = @{}

foreach ($line in $lines) {
    # Extract date: [19/Feb/2026:21:58:26
    if ($line -match '\[(\d+/\w+/\d+):') {
        $day = $Matches[1]

        if (-not $dailyCounts.ContainsKey($day)) { $dailyCounts[$day] = 0 }
        $dailyCounts[$day]++

        # Count searches
        if ($line -match '/search\?q=') {
            if (-not $dailySearches.ContainsKey($day)) { $dailySearches[$day] = 0 }
            $dailySearches[$day]++
        }

        # Track unique IPs
        $ip = ($line -split ' ')[0]
        $key = "$day|$ip"
        if (-not $dailyIPs.ContainsKey($day)) { $dailyIPs[$day] = @{} }
        $dailyIPs[$day][$ip] = $true
    }
}

foreach ($day in ($dailyCounts.Keys | Sort-Object)) {
    $reqs = $dailyCounts[$day]
    $searches = if ($dailySearches.ContainsKey($day)) { $dailySearches[$day] } else { 0 }
    $ips = if ($dailyIPs.ContainsKey($day)) { $dailyIPs[$day].Count } else { 0 }
    Write-Host ("  {0}  {1,6} requests  {2,5} searches  {3,4} unique IPs" -f $day, $reqs, $searches, $ips)
}

# Totals
$totalReqs = ($dailyCounts.Values | Measure-Object -Sum).Sum
$totalSearches = ($dailySearches.Values | Measure-Object -Sum).Sum
$allIPs = @{}
foreach ($day in $dailyIPs.Keys) {
    foreach ($ip in $dailyIPs[$day].Keys) { $allIPs[$ip] = $true }
}
Write-Host ""
Write-Host ("  TOTAL:     {0,6} requests  {1,5} searches  {2,4} unique IPs" -f $totalReqs, $totalSearches, $allIPs.Count) -ForegroundColor Green

Write-Host ""
Write-Host "--- Top Search Queries ---" -ForegroundColor Yellow
$queries = @{}
foreach ($line in $lines) {
    if ($line -match '/search\?q=([^ &"]+)') {
        $q = $Matches[1]
        $q = [System.Uri]::UnescapeDataString($q)
        if (-not $queries.ContainsKey($q)) { $queries[$q] = 0 }
        $queries[$q]++
    }
}
if ($queries.Count -gt 0) {
    $queries.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 15 | ForEach-Object {
        Write-Host ("  {0,4}  {1}" -f $_.Value, $_.Key)
    }
} else {
    Write-Host "  (none)"
}

Write-Host ""
Write-Host "--- Top Referrers ---" -ForegroundColor Yellow
$refs = @{}
foreach ($line in $lines) {
    # Log format: ... "referer" "user-agent" ...
    # With host field: ip - user [time] "host" "request" status bytes "referer" "user-agent" ...
    $parts = $line -split '"'
    # parts[1]=host, parts[3]=request, parts[5]=referer, parts[7]=ua
    if ($parts.Count -ge 6) {
        $ref = $parts[5]
        if ($ref -and $ref -ne "-") {
            if (-not $refs.ContainsKey($ref)) { $refs[$ref] = 0 }
            $refs[$ref]++
        }
    }
}
if ($refs.Count -gt 0) {
    $refs.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 10 | ForEach-Object {
        Write-Host ("  {0,4}  {1}" -f $_.Value, $_.Key)
    }
} else {
    Write-Host "  (none)"
}
