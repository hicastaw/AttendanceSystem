"""Cấu hình cho tiến trình edge, đọc từ biến môi trường / file .env.

Không phụ thuộc python-dotenv (tránh thêm dependency chưa chắc có trên
Orange Pi) — tự nạp file .env dạng KEY=VALUE bằng vài dòng thuần Python.
"""
import os
import math
from urllib.parse import urlsplit


def _load_dotenv(path):
    if not path or not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


_load_dotenv(os.environ.get("EDGE_ENV_FILE", ".env"))


def _get_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _get_float(name, default):
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.environ.get("MODEL_DIR", os.path.join(BASE_DIR, "model"))

# --- Camera ---
CAMERA_BACKEND = os.environ.get('CAMERA_BACKEND','v4l2')
CAMERA_DEVICE = os.environ.get("CAMERA_DEVICE", "/dev/video0")
CAMERA_WIDTH = _get_int("CAMERA_WIDTH", 640)
CAMERA_HEIGHT = _get_int("CAMERA_HEIGHT", 480)
CAMERA_FPS = _get_int("CAMERA_FPS", 10)
CAMERA_FOURCC = os.environ.get("CAMERA_FOURCC", "MJPG")

# --- Xử lý AI ---
PROCESS_EVERY_N_FRAMES = max(1, _get_int("PROCESS_EVERY_N_FRAMES", 3))
DETECT_WIDTH = _get_int("DETECT_WIDTH", 320)  # resize trước khi detect để nhẹ CPU
DETECTION_SCORE_THRESHOLD = _get_float("DETECTION_SCORE_THRESHOLD", 0.80)

# --- Stream debug ---
JPEG_QUALITY = _get_int("JPEG_QUALITY", 70)
STREAM_HOST = os.environ.get("STREAM_HOST", "127.0.0.1")
STREAM_PORT = _get_int("STREAM_PORT", 5000)
STREAM_FPS = _get_float("STREAM_FPS", 10.0)

# --- Kết nối tới laptop/server ---
# 3001 là port của AIOT/server (Node/Express + SQLite, xem AIOT/server/src/index.js).
SERVER_BASE_URL = os.environ.get("SERVER_BASE_URL", "http://192.168.137.1:3001")
# AI_SERVICE_URL chỉ dùng khi EMBEDDING_BACKEND=remote (fallback), trỏ tới AI Service
# FastAPI rút gọn chạy trên laptop (AIOT/server/ai/main.py, port 8001).
AI_SERVICE_URL = os.environ.get("AI_SERVICE_URL", "http://192.168.137.1:8001")
DEVICE_ID = os.environ.get("DEVICE_ID", "ORANGE_PI_PC_01")
EDGE_DEVICE_KEY = os.environ.get("EDGE_DEVICE_KEY", "")

HTTP_TIMEOUT_SECONDS = _get_float("HTTP_TIMEOUT_SECONDS", 3)
# Stable absolute path; keep it outside replaceable release directories on Pi.
# Runtime metadata contains attendance identities, not biometric images/embeddings.
EDGE_OUTBOX_PATH = os.environ.get(
    "EDGE_OUTBOX_PATH", os.path.join(os.path.expanduser("~"), ".aiot", "edge-outbox.db"))
OUTBOX_RETRY_BASE_SECONDS = _get_float("OUTBOX_RETRY_BASE_SECONDS", 1)
OUTBOX_RETRY_MAX_SECONDS = _get_float("OUTBOX_RETRY_MAX_SECONDS", 60)
# Gallery refresh is separate from the event calendar's minute refresh.
# (vd khi có người mới đăng ký khuôn mặt qua trang quản lý).
FACE_DATA_REFRESH_SECONDS = _get_int("FACE_DATA_REFRESH_SECONDS", 300)
MEMBER_GALLERY_CACHE_PATH = os.environ.get(
    "MEMBER_GALLERY_CACHE_PATH", os.path.join(os.path.expanduser("~"), ".aiot", "member-gallery.json"))
GALLERY_CACHE_MAX_AGE_SECONDS = _get_float("GALLERY_CACHE_MAX_AGE_SECONDS", 86400)

# --- Check-in only; cooldown applies outside scheduled events ---
ATTENDANCE_COOLDOWN_SECONDS = _get_int("ATTENDANCE_COOLDOWN_SECONDS", 60)
SIMILARITY_THRESHOLD = _get_float("SIMILARITY_THRESHOLD", 0.60)

# "cv2dnn" (mặc định, khuyến nghị thử trước — dùng nguyên model w600k_mbf.onnx qua
# module cv2.dnn, không cần onnxruntime) hoặc "remote" (fallback: gửi ảnh mặt đã
# align sang AI Service trên laptop, giữ nguyên onnxruntime ở đó).
EMBEDDING_BACKEND = os.environ.get("EMBEDDING_BACKEND", "cv2dnn").strip().lower()

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")

DETECTOR_MODEL_PATH = os.path.join(MODEL_DIR, "face_detection_yunet_2023mar.onnx")
RECOGNIZER_MODEL_PATH = os.path.join(MODEL_DIR, "w600k_mbf.onnx")


def validate_runtime():
    if len(EDGE_DEVICE_KEY)<24 or EDGE_DEVICE_KEY.startswith('change-me'):
        raise ValueError('Provision EDGE_DEVICE_KEY (24+ characters, not an example)')
    if STREAM_HOST not in ('127.0.0.1','::1'):
        raise ValueError('Worker API must bind loopback; use authenticated backend proxy')
    if not all(type(value) is int and 0<value<=4096 for value in (CAMERA_WIDTH,CAMERA_HEIGHT,CAMERA_FPS)):
        raise ValueError('Invalid camera dimensions/rate')
    if not math.isfinite(SIMILARITY_THRESHOLD) or not -1<=SIMILARITY_THRESHOLD<=1:
        raise ValueError('Invalid configured similarity threshold')
    if not math.isfinite(HTTP_TIMEOUT_SECONDS) or not 0<HTTP_TIMEOUT_SECONDS<=30:
        raise ValueError('HTTP timeout must be finite, 0..30 seconds')
    for value in (SERVER_BASE_URL,AI_SERVICE_URL):
        url=urlsplit(value)
        if url.scheme not in ('http','https') or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError('Service URL must not contain credentials/query/fragment')
