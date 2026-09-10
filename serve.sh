#!/usr/bin/env bash
# Start 2020Tok so phones on the same Wi‑Fi can reach it.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-5173}"

# Stop any old server on this port.
pkill -f "python3 -m http.server ${PORT}" 2>/dev/null || true
sleep 0.3

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -z "$LAN_IP" ]; then
  LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") print $(i+1)}')"
fi

echo ""
echo "2020Tok server starting on port ${PORT}"
echo ""
echo "  On THIS computer:  http://127.0.0.1:${PORT}/"
if [ -n "$LAN_IP" ]; then
  echo "  On your PHONE:     http://${LAN_IP}:${PORT}/"
  echo "                     (phone must be on the same Wi‑Fi, not mobile data)"
else
  echo "  On your PHONE:     http://<this-computer-ip>:${PORT}/"
fi
echo ""
echo "If your phone still says \"site can't be reached\", open the firewall:"
echo "  sudo ufw allow ${PORT}/tcp"
echo "  # or: sudo iptables -I INPUT -p tcp --dport ${PORT} -j ACCEPT"
echo ""
echo "Press Ctrl+C to stop."
echo ""

exec python3 -m http.server "$PORT" --bind 0.0.0.0
