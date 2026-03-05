#!/usr/bin/env bash
# analyze-nginx-logs.sh — Parse nginx access logs for anomalies
# Run this from a container that has the nginx_logs volume mounted, or copy the log file first.
# Usage: ./scripts/analyze-nginx-logs.sh [log_file]
#
# Reports: top IPs, 4xx/5xx rates, slow requests (>1s), unusual user agents

set -euo pipefail

LOG_FILE="${1:-/var/log/nginx/access.log}"

if [ ! -f "${LOG_FILE}" ]; then
  echo "ERROR: Log file not found: ${LOG_FILE}" >&2
  echo "To access nginx logs, mount the 'substrate_prod_nginx_logs' volume or run from within the nginx container."
  exit 1
fi

TOTAL=$(wc -l < "${LOG_FILE}")
echo "=== Nginx Access Log Analysis ==="
echo "File: ${LOG_FILE}"
echo "Total requests: ${TOTAL}"
echo ""

echo "--- Top 10 IPs ---"
awk '{print $1}' "${LOG_FILE}" | sort | uniq -c | sort -rn | head -10

echo ""
echo "--- Status Code Distribution ---"
awk '{print $9}' "${LOG_FILE}" | sort | uniq -c | sort -rn | head -20

echo ""
echo "--- 4xx Error Rate ---"
errors_4xx=$(awk '$9 ~ /^4/ {count++} END {print count+0}' "${LOG_FILE}")
echo "4xx count: ${errors_4xx} / ${TOTAL} ($(awk "BEGIN {printf \"%.1f\", ${errors_4xx}*100/${TOTAL}}+0}%)"

echo ""
echo "--- 5xx Error Rate ---"
errors_5xx=$(awk '$9 ~ /^5/ {count++} END {print count+0}' "${LOG_FILE}")
echo "5xx count: ${errors_5xx} / ${TOTAL} ($(awk "BEGIN {printf \"%.1f\", ${errors_5xx}*100/${TOTAL}}+0}%)"

echo ""
echo "--- Top 10 Slow Requests (>1s, field \$NF is request_time in combined log format) ---"
# Nginx combined log format: $request_time is typically the last field when configured
awk '$NF > 1 {print $NF, $7, $9, $1}' "${LOG_FILE}" 2>/dev/null | sort -rn | head -10 || echo "(request_time field not in log format)"

echo ""
echo "--- Top 10 User Agents ---"
# User agent is between the last two quotes in combined format
awk -F'"' '{print $6}' "${LOG_FILE}" | sort | uniq -c | sort -rn | head -10

echo ""
echo "--- Unusual/Suspicious User Agents ---"
awk -F'"' '{print $6}' "${LOG_FILE}" | grep -iE "(sqlmap|nikto|nmap|masscan|zgrab|curl/|python-requests|go-http|wget/|scrapy|semrush|ahrefsbot|mj12bot)" | sort | uniq -c | sort -rn | head -10 || echo "(none detected)"

echo ""
echo "--- Top Requested Paths ---"
awk '{print $7}' "${LOG_FILE}" | cut -d'?' -f1 | sort | uniq -c | sort -rn | head -15

echo ""
echo "--- Recent 5xx Errors (last 20) ---"
grep ' 5[0-9][0-9] ' "${LOG_FILE}" | tail -20 || echo "(none)"

echo ""
echo "Analysis complete at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
