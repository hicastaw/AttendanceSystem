#!/usr/bin/env bash
# Chạy TỪ máy phát triển (laptop) để đẩy thư mục edge/ sang Raspberry Pi
# qua rsync/ssh, rồi cài đặt dependency + systemd service trên đó.
#
# Không xoá dữ liệu hiện có trên Pi ngoài ý muốn: không dùng
# `rsync --delete`, không ghi đè .env nếu đã tồn tại trên thiết bị.
set -euo pipefail

EDGE_HOST="${EDGE_HOST:-10.115.62.222}"
EDGE_USER="${EDGE_USER:-raspberrypi}"
REMOTE_DIR="${REMOTE_DIR:-/opt/face-attendance-edge}"

# EDGE_DIR = thư mục edge/ (gói triển khai tự chứa: code + model/ + scripts/ +
# systemd/), được đồng bộ nguyên trạng sang REMOTE_DIR trên Pi.
EDGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== [1/4] Tạo thư mục đích trên Pi (không xoá dữ liệu cũ) =="
ssh "$EDGE_USER@$EDGE_HOST" "sudo mkdir -p '$REMOTE_DIR' && sudo chown \$(id -u):\$(id -g) '$REMOTE_DIR'"

echo
echo "== [2/4] Đồng bộ code + model (rsync, không --delete) =="
rsync -avz \
  --exclude '.venv/' --exclude '__pycache__/' --exclude '.env' \
  "$EDGE_DIR"/ "$EDGE_USER@$EDGE_HOST:$REMOTE_DIR/"

echo
echo "== [3/4] Cài dependency + virtualenv trên Pi =="
ssh "$EDGE_USER@$EDGE_HOST" "cd '$REMOTE_DIR' && bash scripts/install_edge.sh"

echo
echo "== [4/4] Cài đặt systemd service (không tự start, không tự ghi đè .env) =="
ssh "$EDGE_USER@$EDGE_HOST" \
  "sudo cp '$REMOTE_DIR/systemd/face-attendance-edge.service' /etc/systemd/system/ && sudo systemctl daemon-reload"

echo
echo "== Hoàn tất. Các bước còn lại (chạy trực tiếp trên Pi) =="
echo "  cd $REMOTE_DIR"
echo "  [[ -f .env ]] || cp .env.example .env   # rồi chỉnh sửa giá trị thật (KHÔNG ghi đè nếu đã có)"
echo "  sudo usermod -aG video \$(whoami)        # để user chạy service truy cập được /dev/video*"
echo "  sudo systemctl enable --now face-attendance-edge"
echo "  journalctl -u face-attendance-edge -f"
