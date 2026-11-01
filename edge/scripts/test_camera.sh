#!/usr/bin/env bash
# Kiểm tra camera USB (Logitech C920) trên Orange Pi trước khi chạy edge app.
set -uo pipefail

echo "== USB devices (lsusb) =="
if command -v lsusb >/dev/null 2>&1; then
  lsusb
  lsusb | grep -i "046d:08e5" && echo "-> Đã thấy Logitech C920 PRO (046d:08e5)" || echo "-> KHÔNG thấy 046d:08e5 trong danh sách USB"
else
  echo "lsusb không có sẵn (cài package 'usbutils')"
fi

echo
echo "== v4l2-ctl --list-devices =="
if command -v v4l2-ctl >/dev/null 2>&1; then
  v4l2-ctl --list-devices
else
  echo "v4l2-ctl không có sẵn — cài: sudo apt install v4l-utils"
fi

echo
echo "== Danh sách /dev/video* =="
ls -la /dev/video* 2>/dev/null || echo "Không có node /dev/video* nào"

echo
echo "== Kiểm tra từng node có hỗ trợ Video Capture không =="
for dev in /dev/video0 /dev/video1 /dev/video2; do
  [[ -e "$dev" ]] || continue
  echo "--- $dev ---"
  if command -v v4l2-ctl >/dev/null 2>&1; then
    if v4l2-ctl -d "$dev" --all 2>/dev/null | grep -qi "Video Capture"; then
      echo "  -> $dev hỗ trợ Video Capture"
      v4l2-ctl -d "$dev" --list-formats-ext 2>/dev/null | head -20
    else
      echo "  -> $dev KHÔNG phải Video Capture node (có thể là Metadata Capture của UVC)"
    fi
  fi
done

echo
read -rp "Chụp thử 1 ảnh từ node nào? (vd /dev/video1, Enter để bỏ qua): " TESTDEV
if [[ -n "${TESTDEV:-}" ]]; then
  PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  PY="$PROJECT_DIR/.venv/bin/python3"
  [[ -x "$PY" ]] || PY="python3"
  OUT="/tmp/camera_test_$(date +%s).jpg"

  "$PY" - "$TESTDEV" "$OUT" <<'PYEOF'
import sys
import cv2

dev, out = sys.argv[1], sys.argv[2]
cap = cv2.VideoCapture(dev, cv2.CAP_V4L2)
if not cap.isOpened():
    print(f"Không mở được {dev}")
    sys.exit(1)
ok, frame = cap.read()
cap.release()
if not ok:
    print(f"Không đọc được frame từ {dev}")
    sys.exit(1)
cv2.imwrite(out, frame)
print(f"Đã lưu ảnh thử: {out}  ({frame.shape[1]}x{frame.shape[0]})")
PYEOF
fi
