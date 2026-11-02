"""Trạng thái live debug; chỉ giữ một JPEG và kết quả AI trong RAM."""
import threading
import time


class AppState:
    def __init__(self, camera_device="", test_mode=False):
        self.camera_device = camera_device
        self.camera_opened = False
        self.model_loaded = False
        self.recognizer_model = ""
        self.recognizer_runtime = ""
        self.recognizer_alignment = ""
        self.server_reachable = False
        self.test_mode = test_mode
        self.fps_estimate = 0.0
        self.capture_fps = 0.0
        self.inference_fps = 0.0
        self.inference_latency_ms = None
        self.known_embeddings_count = 0
        self.enrollment_status = "loading"
        self.enrollment_source = "server"
        self.faces_detected_total = 0
        self.embeddings_generated_total = 0
        self.frames_processed = 0
        self.inference_count = 0
        self.camera_read_errors = 0
        self.inference_errors = 0
        self.last_error = None
        self.faces = []
        self.stopped = False
        self._started = time.monotonic()
        self._last_inference = None
        self._last_frame_at = None
        self._lock = threading.Condition()
        self._last_frame_jpeg = None
        self._frame_sequence = 0

    def update_frame(self, jpeg_bytes):
        with self._lock:
            self._last_frame_jpeg = jpeg_bytes
            self._last_frame_at = time.monotonic()
            self._frame_sequence += 1
            self.frames_processed += 1
            self._lock.notify_all()

    def get_frame(self):
        with self._lock:
            return self._last_frame_jpeg

    def wait_frame(self, sequence, timeout=1):
        with self._lock:
            self._lock.wait_for(lambda: self._frame_sequence != sequence or self.stopped, timeout)
            fresh = (self._last_frame_at is not None and time.monotonic() - self._last_frame_at < 3)
            return self._frame_sequence, self._last_frame_jpeg if self.camera_opened and fresh else None

    def stop(self):
        with self._lock:
            self.stopped = True
            self._lock.notify_all()

    def to_health_dict(self):
        now = time.monotonic()
        frame_age = now - self._last_frame_at if self._last_frame_at is not None else None
        inference_age = now - self._last_inference if self._last_inference is not None else None
        streaming = self.camera_opened and frame_age is not None and frame_age < 3
        return {
            "status": "stopped" if self.stopped else ("running" if streaming else "waiting_for_camera"),
            "test_mode": self.test_mode,
            "attendance_enabled": not self.test_mode,
            "camera_device": self.camera_device,
            "camera_opened": self.camera_opened,
            "camera_status": "streaming" if streaming else "no_recent_frame",
            "server_reachable": self.server_reachable,
            "model_loaded": self.model_loaded,
            "recognizer_model": self.recognizer_model,
            "recognizer_runtime": self.recognizer_runtime,
            "recognizer_alignment": self.recognizer_alignment,
            "known_embeddings_count": self.known_embeddings_count,
            "identity_status": "No enrolled identities" if self.known_embeddings_count == 0 else "Enrollment loaded",
            "enrollment_status": self.enrollment_status,
            "enrollment_source": self.enrollment_source,
            "faces_detected_total": self.faces_detected_total,
            "embeddings_generated_total": self.embeddings_generated_total,
            "fps_estimate": round(self.fps_estimate, 2),
            "capture_fps": round(self.capture_fps, 2),
            "inference_fps": round(self.inference_fps, 2),
            "inference_latency_ms": (round(self.inference_latency_ms, 2)
                                     if self.inference_latency_ms is not None else None),
            "frame_age_seconds": round(frame_age, 2) if frame_age is not None else None,
            "inference_age_seconds": round(inference_age, 2) if inference_age is not None else None,
            "uptime_seconds": round(now - self._started, 1),
            "frames_processed": self.frames_processed,
            "inference_count": self.inference_count,
            "camera_read_errors": self.camera_read_errors,
            "inference_errors": self.inference_errors,
            "last_error": self.last_error,
            "faces": self.faces if streaming and inference_age is not None and inference_age < 3 else [],
        }
