#!/usr/bin/env bash
# Cài dependency cho tiến trình edge trên Orange Pi PC (Armbian/Debian Trixie, armhf).
#
# Nguyên tắc: ưu tiên apt cho mọi package nặng (OpenCV, numpy...) vì
# opencv-python/onnxruntime trên PyPI KHÔNG có wheel cho armv7l (đã kiểm
# chứng qua PyPI JSON API) — pip install sẽ thất bại hoặc cố build từ
# source, không phù hợp với thiết bị ~1GB RAM. Không tự ý pip install
# opencv-python trước khi biết chắc điều này.
set -euo pipefail

echo "== [1/5] Kiểm tra hệ điều hành =="
if [[ -f /etc/os-release ]] && grep -qiE "debian|armbian" /etc/os-release; then
  echo "OK: phát hiện Debian/Armbian."
else
  echo "CẢNH BÁO: không phát hiện Debian/Armbian trong /etc/os-release."
  read -rp "Vẫn tiếp tục? [y/N] " ans
  [[ "${ans:-N}" =~ ^[Yy]$ ]] || exit 1
fi

ARCH=$(dpkg --print-architecture 2>/dev/null || uname -m)
echo "Kiến trúc: $ARCH"
if [[ "$ARCH" != "armhf" && "$ARCH" != "armv7l" ]]; then
  echo "CẢNH BÁO: script này được kiểm chứng cho armhf (Orange Pi PC, ARMv7 32-bit)."
fi

echo
echo "== [2/5] Cài dependency hệ thống qua apt =="
sudo apt update
sudo apt install -y \
  python3 \
  python3-opencv \
  python3-flask \
  python3-requests \
  python3-venv \
  python3-numpy \
  v4l-utils

echo
echo "== [3/5] Tạo virtual environment (kế thừa package hệ thống) =="
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

if [[ ! -d ".venv" ]]; then
  python3 -m venv --system-site-packages .venv
  echo "Đã tạo .venv (kế thừa cv2, numpy, flask, requests từ apt qua --system-site-packages)."
else
  echo ".venv đã tồn tại, bỏ qua bước tạo."
fi

echo
echo "== [4/5] Kiểm tra cv2 import được, có FaceDetectorYN và cv2.dnn =="
./.venv/bin/python3 - <<'PYEOF'
import cv2
print("OpenCV version:", cv2.__version__)
print("Có cv2.FaceDetectorYN:", hasattr(cv2, "FaceDetectorYN"))
print("Có cv2.dnn.readNetFromONNX:", hasattr(cv2.dnn, "readNetFromONNX"))
PYEOF

echo
echo "== [5/5] Hoàn tất cài đặt =="
echo "Tiếp theo:"
echo "  1. Copy 2 file model .onnx (yunet + w600k_mbf) vào edge/model/ — xem edge/model/README.md"
echo "  2. cp .env.example .env   # rồi chỉnh sửa CAMERA_DEVICE, SERVER_BASE_URL, EDGE_DEVICE_KEY..."
echo "  3. bash scripts/test_camera.sh    # kiểm tra camera trước"
echo "  4. bash scripts/run_edge.sh        # chạy thử thủ công"
