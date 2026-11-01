"""Trạng thái dùng chung giữa main.py (vòng lặp camera) và stream_server.py
(Flask, chạy ở thread khác) — để tránh copy/giữ nhiều frame trong RAM, chỉ
lưu ĐÚNG 1 frame JPEG mới nhất, bảo vệ bằng 1 lock nhỏ.
"""
import threading


class AppState:
    def __init__(self, camera_device=""):
        self.camera_device = camera_device
        self.camera_opened = False
        self.model_loaded = False
        self.server_reachable = False
        self.fps_estimate = 0.0

        self._lock = threading.Lock()
        self._last_frame_jpeg = None

    def update_frame(self, jpeg_bytes):
        with self._lock:
            self._last_frame_jpeg = jpeg_bytes

    def get_frame(self):
        with self._lock:
            return self._last_frame_jpeg

    def to_health_dict(self):
        return {
            "status": "running",
            "camera_device": self.camera_device,
            "camera_opened": self.camera_opened,
            "server_reachable": self.server_reachable,
            "model_loaded": self.model_loaded,
            "fps_estimate": round(self.fps_estimate, 1),
        }
