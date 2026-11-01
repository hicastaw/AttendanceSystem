#!/usr/bin/env bash
# Chạy tiến trình edge thủ công (không qua systemd) — dùng khi phát triển/debug.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

ENV_FILE="${1:-.env}"
if [[ -f "$ENV_FILE" ]]; then
  echo "Nạp cấu hình từ $ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "Không tìm thấy $ENV_FILE — dùng giá trị mặc định khai báo trong config.py"
fi

PY="./.venv/bin/python3"
[[ -x "$PY" ]] || PY="python3"

echo "Chạy: $PY main.py"
exec "$PY" main.py
