#!/bin/bash
# VPN Mode Switch — toggle between US and Secure Core (Switzerland)
#
# Usage:
#   ./scripts/vpn-switch.sh us          # US exit (default)
#   ./scripts/vpn-switch.sh secure-core # Switzerland Secure Core
#   ./scripts/vpn-switch.sh status      # Show current VPN status

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

case "${1:-status}" in
  us)
    echo "Switching to US VPN..."
    sed -i "s/^PROTON_WIREGUARD_PRIVATE_KEY=.*/PROTON_WIREGUARD_PRIVATE_KEY=$(grep PROTON_WIREGUARD_PRIVATE_KEY_US= "$ENV_FILE" | cut -d= -f2-)/" "$ENV_FILE"
    sed -i 's/^PROTON_SERVER_COUNTRIES=.*/PROTON_SERVER_COUNTRIES=United States/' "$ENV_FILE"
    sed -i 's/^VPN_MODE=.*/VPN_MODE=us/' "$ENV_FILE"
    docker compose -f "$SCRIPT_DIR/docker-compose.selfhosted.yml" up -d --force-recreate gluetun
    sleep 15
    docker logs askalf-gluetun --tail 3 2>&1
    ;;
  secure-core|ch|swiss)
    echo "Switching to Secure Core (Switzerland)..."
    sed -i "s/^PROTON_WIREGUARD_PRIVATE_KEY=.*/PROTON_WIREGUARD_PRIVATE_KEY=$(grep PROTON_WIREGUARD_PRIVATE_KEY_CH= "$ENV_FILE" | cut -d= -f2-)/" "$ENV_FILE"
    sed -i 's/^PROTON_SERVER_COUNTRIES=.*/PROTON_SERVER_COUNTRIES=Switzerland/' "$ENV_FILE"
    sed -i 's/^VPN_MODE=.*/VPN_MODE=secure-core/' "$ENV_FILE"
    docker compose -f "$SCRIPT_DIR/docker-compose.selfhosted.yml" up -d --force-recreate gluetun
    sleep 15
    docker logs askalf-gluetun --tail 3 2>&1
    ;;
  status)
    MODE=$(grep "^VPN_MODE=" "$ENV_FILE" | cut -d= -f2)
    COUNTRY=$(grep "^PROTON_SERVER_COUNTRIES=" "$ENV_FILE" | cut -d= -f2)
    echo "VPN Mode: ${MODE:-not set}"
    echo "Country: ${COUNTRY:-not set}"
    docker logs askalf-gluetun --tail 3 2>&1 | grep -E "Public IP|healthy|ERROR" || echo "Gluetun not running"
    ;;
  *)
    echo "Usage: $0 {us|secure-core|status}"
    exit 1
    ;;
esac
