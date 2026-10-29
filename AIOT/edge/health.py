"""Trạng thái dùng chung giữa main.py (vòng lặp camera) và stream_server.py
(Flask, chạy ở thread khác) — để tránh copy/giữ nhiều frame trong RAM, chỉ
lưu ĐÚNG 1 frame JPEG mới nhất, bảo vệ bằng 1 lock nhỏ.
"""
import threading
import time
from capture_session import CaptureSession


class AppState:
    def __init__(self, camera_device="", *, max_age=5, clock=None):
        if not 0 < max_age < float('inf'):
            raise ValueError('Frame freshness budget must be finite and positive')
        self.clock, self.max_age = clock or time.monotonic, max_age
        self.camera_device = camera_device
        self.camera_opened = False
        self.model_loaded = False
        self.server_reachable = False
        self.fps_estimate = 0.0
        self.gallery_status = {"origin": "none", "member_count": 0}

        self._lock = threading.Lock()
        self._last_frame_jpeg = None
        self._last_frame_at = None
        self._captured_at = None
        self._inference_at = None
        self.storage_ok = True
        self.error = None
        self.capture = CaptureSession(clock=self.clock)

    def captured(self):
        with self._lock:
            self._captured_at = self.clock()

    def inferred(self):
        with self._lock:
            self._inference_at = self.clock()
            self.model_loaded = True
            self.error = None

    def failed(self, component):
        with self._lock:
            self.error = component + '_unavailable'
            self._inference_at = None
            self._last_frame_jpeg = None
            if component == 'camera':
                self.camera_opened = False
                self._captured_at = None
            elif component == 'model':
                self.model_loaded = False
            elif component == 'storage':
                self.storage_ok = False

    def frame_fresh(self):
        return self._captured_at is not None and 0 <= self.clock() - self._captured_at <= self.max_age

    def update_frame(self, jpeg_bytes):
        with self._lock:
            self._last_frame_jpeg = jpeg_bytes
            self._last_frame_at = self.clock()

    def get_frame(self):
        with self._lock:
            return self._last_frame_jpeg if self._last_frame_at is not None and self.clock()-self._last_frame_at <= self.max_age else None

    def to_health_dict(self):
        with self._lock:
            return self._health_snapshot()

    def _health_snapshot(self):
        now = self.clock()
        fresh = lambda stamp: stamp is not None and 0 <= now-stamp <= self.max_age
        ready=bool(self.camera_opened and self.model_loaded and self.storage_ok and
                   fresh(self._captured_at) and fresh(self._inference_at) and
                   self.gallery_status.get('origin') in ('server','cache'))
        return {
            "status": "ready" if ready else "degraded",
            "ready": ready,
            "frame_age_seconds": None if self._captured_at is None else round(now-self._captured_at,2),
            "inference_age_seconds": None if self._inference_at is None else round(now-self._inference_at,2),
            "storage_ok": self.storage_ok,
            "frame_fresh": fresh(self._captured_at),
            "inference_fresh": fresh(self._inference_at),
            "error": self.error,
            "backend_required_for_local_ready": False,
            "camera_device": self.camera_device,
            "camera_opened": self.camera_opened,
            "server_reachable": self.server_reachable,
            "model_loaded": self.model_loaded,
            "fps_estimate": round(self.fps_estimate, 1),
            "gallery": dict(self.gallery_status),
        }
