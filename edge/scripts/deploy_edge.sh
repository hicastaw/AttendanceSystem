#!/usr/bin/env bash
# Chạy TỪ máy phát triển (laptop) để đẩy thư mục edge/ sang Raspberry Pi qua
# ssh (tar stream — không cần rsync trên laptop), rồi cài dependency trên đó.
#
# Không xoá dữ liệu hiện có trên Pi ngoài ý muốn: chỉ ghi đè file code, không
# đụng tới .venv/ và .env đã có trên thiết bị.
#
# Biến môi trường tuỳ chọn: EDGE_HOST, EDGE_USER, REMOTE_DIR, SSH_KEY.
set -euo pipefail

EDGE_HOST="${EDGE_HOST:-10.115.62.222}"
EDGE_USER="${EDGE_USER:-raspberrypi}"
REMOTE_DIR="${REMOTE_DIR:-/home/$EDGE_USER/face-attendance-edge}"
SSH_OPTS=()
[[ -n "${SSH_KEY:-}" ]] && SSH_OPTS=(-i "$SSH_KEY" -o IdentitiesOnly=yes)

# EDGE_DIR = thư mục edge/ (gói triển khai tự chứa: code + model/ + scripts/ +
# systemd/), được đồng bộ nguyên trạng sang REMOTE_DIR trên Pi.
EDGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$EDGE_USER@$EDGE_HOST"

echo "== [1/3] Đồng bộ code + model sang $TARGET:$REMOTE_DIR =="
tar -C "$EDGE_DIR" \
  --exclude='./.venv' --exclude='__pycache__' --exclude='./.env' \
  -czf - . \
  | ssh "${SSH_OPTS[@]}" "$TARGET" "mkdir -p '$REMOTE_DIR' && tar -xzf - -C '$REMOTE_DIR'"

echo
echo "== [2/3] Cài dependency + virtualenv trên Pi =="
ssh "${SSH_OPTS[@]}" "$TARGET" "cd '$REMOTE_DIR' && bash scripts/install_edge.sh"

echo
echo "== [3/3] Tạo .env nếu chưa có (không ghi đè) =="
ssh "${SSH_OPTS[@]}" "$TARGET" \
  "cd '$REMOTE_DIR' && if [ -f .env ]; then echo '.env đã có, giữ nguyên.'; else cp .env.example .env && echo 'Đã tạo .env từ .env.example — nhớ sửa SERVER_BASE_URL, EDGE_DEVICE_KEY.'; fi"

echo
echo "== Hoàn tất. Cài service chạy nền (cần sudo, chạy trực tiếp trên Pi) =="
echo "  sudo cp $REMOTE_DIR/systemd/face-attendance-edge.service /etc/systemd/system/"
echo "  sudo systemctl daemon-reload && sudo systemctl enable --now face-attendance-edge"
echo "  journalctl -u face-attendance-edge -f"
