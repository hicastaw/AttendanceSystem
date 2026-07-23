"""Cấu hình cho tiến trình edge, đọc từ biến môi trường / file .env.

Không phụ thuộc python-dotenv (tránh thêm dependency chưa chắc có trên
Orange Pi) — tự nạp file .env dạng KEY=VALUE bằng vài dòng thuần Python.
"""
import os


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
STREAM_HOST = os.environ.get("STREAM_HOST", "0.0.0.0")
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
# Không còn khái niệm phiên/session — chỉ cần định kỳ đồng bộ lại embeddings
# (vd khi có người mới đăng ký khuôn mặt qua trang quản lý).
FACE_DATA_REFRESH_SECONDS = _get_int("FACE_DATA_REFRESH_SECONDS", 300)

# --- Nghiệp vụ ra/vào (check-in/check-out) ---
ATTENDANCE_COOLDOWN_SECONDS = _get_int("ATTENDANCE_COOLDOWN_SECONDS", 60)
SIMILARITY_THRESHOLD = _get_float("SIMILARITY_THRESHOLD", 0.60)

# "cv2dnn" (mặc định, khuyến nghị thử trước — dùng nguyên model w600k_mbf.onnx qua
# module cv2.dnn, không cần onnxruntime) hoặc "remote" (fallback: gửi ảnh mặt đã
# align sang AI Service trên laptop, giữ nguyên onnxruntime ở đó).
EMBEDDING_BACKEND = os.environ.get("EMBEDDING_BACKEND", "cv2dnn").strip().lower()

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")

DETECTOR_MODEL_PATH = os.path.join(MODEL_DIR, "face_detection_yunet_2023mar.onnx")
RECOGNIZER_MODEL_PATH = os.path.join(MODEL_DIR, "w600k_mbf.onnx")
