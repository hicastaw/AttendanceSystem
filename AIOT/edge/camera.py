"""Mở và duy trì kết nối camera USB (Logitech C920) trên Orange Pi.

Không hard-code /dev/videoX: thử node cấu hình trước, sau đó lần lượt
video0/1/2 nếu node cấu hình không mở được hoặc không hỗ trợ Video Capture.
"""
import logging

import cv2

logger = logging.getLogger(__name__)

FALLBACK_NODES = ["/dev/video0", "/dev/video1", "/dev/video2"]


class Camera:
    def __init__(self, device, width=640, height=480, fps=10, fourcc="MJPG"):
        self.configured_device = device
        self.width = width
        self.height = height
        self.fps = fps
        self.fourcc = fourcc
        self.device = None
        self._cap = None

    def _try_open(self, path):
        cap = cv2.VideoCapture(path, cv2.CAP_V4L2)
        if not cap.isOpened():
            cap.release()
            return None

        # Node không hỗ trợ Video Capture (vd: metadata node của UVC) sẽ mở được
        # nhưng không set nổi format hoặc không đọc được frame — loại ngay tại đây.
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*self.fourcc))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        cap.set(cv2.CAP_PROP_FPS, self.fps)

        ok, _ = cap.read()
        if not ok:
            cap.release()
            return None
        return cap

    def open(self):
        candidates = [self.configured_device] + [
            n for n in FALLBACK_NODES if n != self.configured_device
        ]
        for path in candidates:
            logger.info("Đang thử mở camera tại %s ...", path)
            cap = self._try_open(path)
            if cap is not None:
                self._cap = cap
                self.device = path
                logger.info("Đã mở camera thành công tại %s (%dx%d @%dfps, %s)",
                            path, self.width, self.height, self.fps, self.fourcc)
                return True
            logger.warning("Không mở được / không đọc được frame từ %s", path)
        logger.error("Không tìm được camera khả dụng trong danh sách: %s", candidates)
        return False

    @property
    def is_opened(self):
        return self._cap is not None and self._cap.isOpened()

    def read(self):
        if not self.is_opened:
            return False, None
        ok, frame = self._cap.read()
        if not ok:
            logger.warning("Đọc frame thất bại từ %s — sẽ đóng và thử reconnect ở vòng lặp tiếp theo", self.device)
            self.release()
        return ok, frame

    def reconnect(self):
        self.release()
        return self.open()

    def release(self):
        if self._cap is not None:
            self._cap.release()
        self._cap = None
