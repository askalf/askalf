#!/bin/bash
# nginx-stats.sh — Parse persistent nginx logs for daily usage stats
# Usage: ./scripts/nginx-stats.sh [domain]
# Examples:
#   ./scripts/nginx-stats.sh                  # all sites
#   ./scripts/nginx-stats.sh amnesia.tax      # amnesia.tax only
#   ./scripts/nginx-stats.sh integration.tax  # integration.tax only

DOMAIN="${1:-}"
CONTAINER="sprayberry-labs-nginx"
LOG="/var/log/nginx/access.log"

echo "=== nginx stats ==="
echo "Domain: ${DOMAIN:-all}"
echo ""

# Pull logs from container using sh -c to avoid Git Bash path mangling
if [ -n "$DOMAIN" ]; then
  LOGS=$(docker exec "$CONTAINER" sh -c "grep '\"$DOMAIN\"' $LOG 2>/dev/null")
else
  LOGS=$(docker exec "$CONTAINER" sh -c "cat $LOG 2>/dev/null")
fi

if [ -z "$LOGS" ]; then
  echo "No log data found."
  exit 0
fi

echo "--- Daily Requests ---"
echo "$LOGS" | grep -oP '\[\K[0-9]+/[A-Za-z]+/[0-9]+' | sort | uniq -c | \
  awk '{printf "  %s  %6d requests\n", $2, $1}'

echo ""
echo "--- Searches per Day ---"
SEARCH_LINES=$(echo "$LOGS" | grep "/search?q=")
if [ -n "$SEARCH_LINES" ]; then
  echo "$SEARCH_LINES" | grep -oP '\[\K[0-9]+/[A-Za-z]+/[0-9]+' | sort | uniq -c | \
    awk '{printf "  %s  %6d searches\n", $2, $1}'
else
  echo "  (none)"
fi

echo ""
echo "--- Unique IPs per Day ---"
echo "$LOGS" | awk '{
  # Extract date: between [ and :
  idx1 = index($0, "[")
  idx2 = index($0, ":")
  if (idx1 > 0 && idx2 > idx1) {
    day = substr($0, idx1+1, idx2-idx1-1)
    print day, $1
  }
}' | sort -u | awk '{print $1}' | sort | uniq -c | \
  awk '{printf "  %s  %6d unique IPs\n", $2, $1}'

echo ""
echo "--- Top Search Queries ---"
QUERIES=$(echo "$LOGS" | grep -oP '/search\?q=\K[^ &"]+' 2>/dev/null | \
  sed 's/%20/ /g; s/%2B/+/g; s/%26/\&/g; s/%3D/=/g; s/%2F/\//g' | \
  sort | uniq -c | sort -rn | head -15)
if [ -n "$QUERIES" ]; then
  echo "$QUERIES" | awk '{printf "  %4d  ", $1; $1=""; print substr($0,2)}'
else
  echo "  (none)"
fi

echo ""
echo "--- Top Referrers ---"
REFS=$(echo "$LOGS" | awk -F'"' '{if($6 != "" && $6 != "-") print $6}' | \
  sort | uniq -c | sort -rn | head -10)
if [ -n "$REFS" ]; then
  echo "$REFS" | awk '{printf "  %4d  ", $1; $1=""; print substr($0,2)}'
else
  echo "  (none)"
fi
