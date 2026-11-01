#!/usr/bin/env bash
# Cài dependency cho tiến trình edge trên Raspberry Pi 5 (Raspberry Pi OS /
# Debian, arm64). OpenCV, numpy... cài vào .venv qua pip — PyPI có sẵn wheel
# aarch64 nên không cần build từ source, cũng không cần sudo.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo "== [1/4] Kiểm tra môi trường =="
ARCH=$(dpkg --print-architecture 2>/dev/null || uname -m)
echo "Kiến trúc: $ARCH — $(python3 --version)"
if [[ "$ARCH" != "arm64" && "$ARCH" != "aarch64" && "$ARCH" != "amd64" && "$ARCH" != "x86_64" ]]; then
  echo "CẢNH BÁO: PyPI có thể không có wheel opencv/numpy cho $ARCH — pip sẽ phải build từ source."
fi
if ! python3 -c "import venv, ensurepip" 2>/dev/null; then
  echo "LỖI: thiếu python3-venv. Cài bằng: sudo apt install -y python3-venv"
  exit 1
fi
command -v v4l2-ctl >/dev/null || echo "Gợi ý: sudo apt install -y v4l-utils (để dùng scripts/test_camera.sh)"

echo
echo "== [2/4] Tạo virtual environment =="
if [[ ! -d ".venv" ]]; then
  python3 -m venv .venv
  echo "Đã tạo .venv"
else
  echo ".venv đã tồn tại, bỏ qua bước tạo."
fi

echo
echo "== [3/4] Cài dependency Python (requirements.txt) =="
./.venv/bin/pip install --upgrade pip --quiet
./.venv/bin/pip install -r requirements.txt

echo
echo "== [4/4] Kiểm tra OpenCV + model =="
./.venv/bin/python3 - <<'PYEOF'
import os
import cv2

print("OpenCV version:", cv2.__version__)
print("Có cv2.FaceDetectorYN:", hasattr(cv2, "FaceDetectorYN"))
for name in ("face_detection_yunet_2023mar.onnx", "w600k_mbf.onnx"):
    path = os.path.join("model", name)
    print(f"Model {name}:", "OK" if os.path.exists(path) else "THIẾU")
net = cv2.dnn.readNetFromONNX(os.path.join("model", "w600k_mbf.onnx"))
print("cv2.dnn load w600k_mbf.onnx: OK")
PYEOF

echo
echo "Tiếp theo:"
echo "  1. cp .env.example .env   # rồi chỉnh SERVER_BASE_URL, EDGE_DEVICE_KEY, CAMERA_DEVICE..."
echo "  2. .venv/bin/python3 recognize_image.py <ảnh|thư mục>   # thử nhận diện từ ảnh"
echo "  3. bash scripts/test_camera.sh    # khi đã cắm camera"
echo "  4. bash scripts/run_edge.sh        # chạy thử thủ công với camera"
