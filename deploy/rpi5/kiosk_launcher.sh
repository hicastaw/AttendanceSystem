#!/usr/bin/env bash
set -euo pipefail
KIOSK_URL="${KIOSK_URL:-http://127.0.0.1:3001/kiosk.html}"
if [[ -z "${WAYLAND_DISPLAY:-}" ]]; then
    echo "No Wayland session; start this user service from labwc autostart." >&2
    exit 1
fi
until curl --fail --silent --max-time 3 http://127.0.0.1:3001/api/health >/dev/null; do
    sleep 2
done
exec /usr/bin/chromium --ozone-platform=wayland --kiosk --no-first-run \
    --noerrdialogs --disable-session-crashed-bubble \
    --user-data-dir="${XDG_CONFIG_HOME:-$HOME/.config}/attendance-chromium" "$KIOSK_URL"
