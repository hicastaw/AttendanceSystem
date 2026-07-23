#!/usr/bin/env bash
# Chạy TỪ máy phát triển (laptop) để đóng gói + đẩy code edge/ sang Orange Pi
# qua rsync/ssh, rồi cài đặt dependency + systemd service trên đó.
#
# Không xoá dữ liệu hiện có trên Orange Pi ngoài ý muốn: không dùng
# `rsync --delete`, không ghi đè .env nếu đã tồn tại trên thiết bị.
set -euo pipefail

ORANGE_PI_HOST="${ORANGE_PI_HOST:-orangepipc}"
ORANGE_PI_USER="${ORANGE_PI_USER:-orangepi}"
REMOTE_DIR="${REMOTE_DIR:-/opt/face-attendance-edge}"

# AIOT_DIR = thư mục AIOT/ (gói triển khai tự chứa, chính là những gì sẽ nằm
# trên Orange Pi). REPO_ROOT = repo gốc của project (thư mục cha của AIOT/),
# chỉ dùng để lấy 2 file model .onnx từ backend/ai/model — model KHÔNG được
# nhân bản sẵn trong AIOT/edge/model (tránh trùng file nhị phân lớn trong git).
AIOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$AIOT_DIR/.." && pwd)"
STAGING_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGING_DIR"' EXIT

echo "== [1/5] Chuẩn bị gói triển khai tại $STAGING_DIR =="
mkdir -p "$STAGING_DIR/edge/model"
cp "$AIOT_DIR"/edge/*.py "$STAGING_DIR/edge/"
cp -r "$AIOT_DIR/scripts" "$STAGING_DIR/"
cp -r "$AIOT_DIR/systemd" "$STAGING_DIR/"
[[ -f "$AIOT_DIR/.env.example" ]] && cp "$AIOT_DIR/.env.example" "$STAGING_DIR/"

MODEL_SRC="$REPO_ROOT/backend/ai/model"
for f in face_detection_yunet_2023mar.onnx w600k_mbf.onnx; do
  if [[ -f "$MODEL_SRC/$f" ]]; then
    cp "$MODEL_SRC/$f" "$STAGING_DIR/edge/model/"
    echo "  Đã đóng gói model: $f"
  else
    echo "  CẢNH BÁO: không tìm thấy $MODEL_SRC/$f — copy thủ công vào $REMOTE_DIR/edge/model/ trên Orange Pi trước khi chạy."
  fi
done

echo
echo "== [2/5] Tạo thư mục đích trên Orange Pi (không xoá dữ liệu cũ) =="
ssh "$ORANGE_PI_USER@$ORANGE_PI_HOST" "sudo mkdir -p '$REMOTE_DIR' && sudo chown \$(id -u):\$(id -g) '$REMOTE_DIR'"

echo
echo "== [3/5] Đồng bộ code (rsync, không --delete) =="
rsync -avz "$STAGING_DIR"/ "$ORANGE_PI_USER@$ORANGE_PI_HOST:$REMOTE_DIR/"

echo
echo "== [4/5] Cài dependency + virtualenv trên Orange Pi =="
ssh "$ORANGE_PI_USER@$ORANGE_PI_HOST" "cd '$REMOTE_DIR' && bash scripts/install_edge.sh"

echo
echo "== [5/5] Cài đặt systemd service (không tự start, không tự ghi đè .env) =="
ssh "$ORANGE_PI_USER@$ORANGE_PI_HOST" \
  "sudo cp '$REMOTE_DIR/systemd/face-attendance-edge.service' /etc/systemd/system/ && sudo systemctl daemon-reload"

echo
echo "== Hoàn tất. Các bước còn lại (chạy trực tiếp trên Orange Pi) =="
echo "  cd $REMOTE_DIR"
echo "  [[ -f .env ]] || cp .env.example .env   # rồi chỉnh sửa giá trị thật (KHÔNG ghi đè nếu đã có)"
echo "  sudo usermod -aG video \$(whoami)        # để user chạy service truy cập được /dev/video*"
echo "  sudo systemctl enable --now face-attendance-edge"
echo "  journalctl -u face-attendance-edge -f"
