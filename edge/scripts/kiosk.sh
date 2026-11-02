#!/usr/bin/env bash
# Mở trang /kiosk của edge toàn màn hình trên màn hình gắn với Pi (Chromium
# --kiosk). Chạy trong phiên desktop (labwc/Wayland) — tự động qua
# ~/.config/labwc/autostart, hoặc chạy tay từ SSH (script tự gắn vào màn hình).
#
# Cần: sudo apt install -y chromium ; edge (main.py hoặc systemd service) đang chạy.
set -uo pipefail

PORT="${KIOSK_PORT:-5000}"
URL="http://localhost:$PORT/kiosk"

# Chạy từ SSH: gắn vào phiên Wayland của user đang đăng nhập trên màn hình.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"

BROWSER=$(command -v chromium || command -v chromium-browser || true)
if [[ -z "$BROWSER" ]]; then
  echo "Chưa có Chromium. Cài bằng: sudo apt install -y chromium" >&2
  exit 1
fi

# Chờ edge mở HTTP (khi khởi động máy, service edge có thể lên sau desktop).
for _ in $(seq 1 60); do
  curl -sf -o /dev/null "http://localhost:$PORT/health" && break
  sleep 2
done

# Chỉ giữ 1 cửa sổ kiosk.
pkill -f -- "--app=$URL" 2>/dev/null || true

exec "$BROWSER" \
  --kiosk --app="$URL" \
  --ozone-platform=wayland \
  --noerrdialogs --disable-infobars --no-first-run \
  --disable-session-crashed-bubble --disable-features=Translate \
  --password-store=basic \
  --user-data-dir="$HOME/.config/attendance-kiosk"
