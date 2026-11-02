#!/usr/bin/env bash
# Kiểm tra CSI hoặc USB trong RAM; không chụp/lưu ảnh. Dừng live server trước.
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
BACKEND="${1:-rpicam}"
if [[ "$BACKEND" == rpicam ]]; then
  rpicam-hello --list-cameras
elif [[ "$BACKEND" == v4l2 ]]; then
  if command -v v4l2-ctl >/dev/null; then v4l2-ctl --list-devices; fi
else
  echo "Usage: bash scripts/test_camera.sh [rpicam|v4l2]" >&2
  exit 2
fi
./.venv/bin/python3 - "$BACKEND" <<'PY'
import signal
import sys
import time
import config
from camera import Camera

def stop(signum, frame):
    raise KeyboardInterrupt
signal.signal(signal.SIGTERM, stop)
camera = Camera(config.CAMERA_DEVICE, config.CAMERA_WIDTH, config.CAMERA_HEIGHT,
                config.CAMERA_FPS, config.CAMERA_FOURCC, backend=sys.argv[1],
                camera_index=config.CAMERA_INDEX)
try:
    if not camera.open():
        raise SystemExit('FAIL: không mở được camera')
    started = time.monotonic()
    count = 0
    while time.monotonic() - started < 5:
        ok, frame = camera.read()
        if not ok or frame is None:
            raise SystemExit('FAIL: không đọc được video thật')
        count += 1
    print(f'Đọc {count} frames thật; shape={frame.shape}; FPS={count/(time.monotonic()-started):.2f}')
    print('Không lưu ảnh/video. Chưa kiểm tra danh tính.')
finally:
    camera.release()
    print('Đã release camera')
PY
