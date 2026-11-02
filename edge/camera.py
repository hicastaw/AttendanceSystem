"""Một chủ sở hữu camera: USB/V4L2 hoặc CSI qua rpicam-vid, chỉ giữ frame mới nhất."""
import fcntl
import logging
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time

import cv2
import numpy as np

logger = logging.getLogger(__name__)
FALLBACK_NODES = ["/dev/video0", "/dev/video1", "/dev/video2"]


class Camera:
    def __init__(self, device, width=640, height=480, fps=10, fourcc="MJPG",
                 backend="v4l2", camera_index=0):
        self.configured_device = device
        self.width, self.height, self.fps = width, height, fps
        self.fourcc, self.backend, self.camera_index = fourcc, backend, camera_index
        self.device = None
        self._cap = None
        self._process = None
        self._reader = None
        self._condition = threading.Condition()
        self._jpeg = None
        self._sequence = self._consumed = 0
        self._reader_done = False
        self._ownership = None
        self.frames_captured = 0
        self.last_capture_at = None

    def _claim(self):
        # Khóa chung cho các instance của ứng dụng, không thay thế lock libcamera.
        path = Path(f"/tmp/face-attendance-camera-{os.getuid()}.lock")
        fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        self._ownership = os.fdopen(fd, "w")
        try:
            fcntl.flock(self._ownership, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self._ownership.close()
            self._ownership = None
            raise RuntimeError("Camera đang được một tiến trình Edge khác sử dụng. Dừng tiến trình đó trước.")

    def _try_open(self, path):
        cap = cv2.VideoCapture(path, cv2.CAP_V4L2)
        try:
            if not cap.isOpened():
                cap.release()
                return None
            cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*self.fourcc))
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
            cap.set(cv2.CAP_PROP_FPS, self.fps)
            ok, _ = cap.read()
            if not ok:
                cap.release()
                return None
            return cap
        except BaseException:
            cap.release()
            raise

    def open(self):
        if self.is_opened:
            return True
        self._claim()
        try:
            if self.backend == "rpicam":
                return self._open_rpicam()
            if self.backend != "v4l2":
                raise ValueError(f"CAMERA_BACKEND không hợp lệ: {self.backend}")
            candidates = [self.configured_device] + [
                n for n in FALLBACK_NODES if n != self.configured_device
            ]
            for path in candidates:
                logger.info("Đang thử mở camera tại %s", path)
                self._cap = self._try_open(path)
                if self._cap is not None:
                    self.device = path
                    return True
            self.release()
            return False
        except BaseException:
            self.release()
            raise

    def _open_rpicam(self):
        executable = shutil.which("rpicam-vid")
        if not executable:
            raise RuntimeError("Thiếu rpicam-vid. Kiểm tra gói rpicam-apps trên Pi.")
        # Stdout là pipe RAM; không tạo file ảnh/video. Đây là process DUY NHẤT mở CSI.
        command = [executable, "--nopreview", "--timeout", "0", "--camera", str(self.camera_index),
                   "--width", str(self.width), "--height", str(self.height),
                   "--framerate", str(self.fps), "--codec", "mjpeg", "--quality", "85",
                   "--autofocus-mode", "continuous", "--flush", "--output", "-", "--verbose", "0"]
        self._jpeg = None
        self._sequence = self._consumed = 0
        self._reader_done = False
        self._process = subprocess.Popen(command, stdout=subprocess.PIPE, bufsize=0)
        self.device = f"rpicam:{self.camera_index}"
        self._reader = threading.Thread(target=self._read_jpegs, name="camera-capture", daemon=True)
        self._reader.start()
        with self._condition:
            ready = self._condition.wait_for(lambda: self._jpeg is not None or self._reader_done, timeout=10)
        if not ready or self._jpeg is None:
            logger.error("rpicam không cung cấp frame trong 10s (exit=%s)", self._process.poll())
            self.release()
            return False
        logger.info("Đã mở CSI %s (%dx%d @%s fps)", self.device, self.width, self.height, self.fps)
        return True

    def _read_jpegs(self):
        buffer = bytearray()
        try:
            while chunk := self._process.stdout.read(65536):
                buffer.extend(chunk)
                while True:
                    start = buffer.find(b"\xff\xd8")
                    if start < 0:
                        buffer[:] = buffer[-1:]
                        break
                    if start:
                        del buffer[:start]
                    end = buffer.find(b"\xff\xd9", 2)
                    if end < 0:
                        if len(buffer) > 8 * 1024 * 1024:
                            raise RuntimeError("Frame camera vượt giới hạn 8 MiB")
                        break
                    jpeg = bytes(buffer[:end + 2])
                    del buffer[:end + 2]
                    with self._condition:
                        self._jpeg = jpeg
                        self._sequence += 1
                        self.frames_captured += 1
                        self.last_capture_at = time.monotonic()
                        self._condition.notify_all()
        except Exception:
            logger.exception("Lỗi đọc pipe rpicam")
        finally:
            with self._condition:
                self._reader_done = True
                self._condition.notify_all()

    @property
    def is_opened(self):
        if self.backend == "rpicam":
            return self._process is not None and self._process.poll() is None and not self._reader_done
        return self._cap is not None and self._cap.isOpened()

    def read(self):
        if not self.is_opened:
            return False, None
        if self.backend == "rpicam":
            with self._condition:
                ready = self._condition.wait_for(
                    lambda: self._sequence != self._consumed or self._reader_done, timeout=5)
                if ready and self._sequence != self._consumed:
                    jpeg, self._consumed = self._jpeg, self._sequence
                else:
                    jpeg = None
            frame = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR) if jpeg else None
            ok = frame is not None
        else:
            ok, frame = self._cap.read()
            if ok:
                self.frames_captured += 1
                self.last_capture_at = time.monotonic()
        if not ok:
            logger.warning("Camera không cung cấp frame; đóng để reconnect")
            self.release()
        return ok, frame

    def reconnect(self):
        self.release()
        return self.open()

    def release(self):
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        if self._process is not None:
            if self._process.poll() is None:
                self._process.terminate()
                try:
                    self._process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self._process.kill()
                    self._process.wait(timeout=2)
            if self._reader is not None:
                self._reader.join(timeout=2)
            self._process.stdout.close()
            self._process = self._reader = None
        if self._ownership is not None:
            self._ownership.close()
            self._ownership = None
