"""Mở và duy trì kết nối camera USB (Logitech C920) trên Orange Pi.

Không hard-code /dev/videoX: thử node cấu hình trước, sau đó lần lượt
video0/1/2 nếu node cấu hình không mở được hoặc không hỗ trợ Video Capture.
"""
import logging
import time

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


class Picamera2Camera:
    """CSI provider with owned BGR frames. Driver/color/AF remain HIL gates.

    Picamera2 RGB888 byte layout is BGR for OpenCV. Test a color chart on the
    actual sensor before pairing with any RGB NPU input contract.
    """
    def __init__(self, width=640, height=480, fps=10, *, factory=None):
        self.width,self.height,self.fps=width,height,fps
        self.device='picamera2:0';self._camera=None;self.factory=factory
        self._last_sensor_timestamp=None

    @property
    def is_opened(self):
        return self._camera is not None

    def open(self):
        self.release()
        camera=None
        try:
            if self.factory is None:
                from picamera2 import Picamera2
                from libcamera import controls
                factory=Picamera2
                settings={'FrameRate':float(self.fps),'AfMode':controls.AfModeEnum.Continuous}
            else:
                factory=self.factory;settings={'FrameRate':float(self.fps)}
            camera=factory()
            camera.configure(camera.create_video_configuration(main={'size':(self.width,self.height),'format':'RGB888'},controls=settings,buffer_count=2))
            camera.start();self._camera=camera
            return True
        except Exception:
            logger.exception('CSI camera unavailable; no USB/mock fallback')
            if camera is not None:
                try:camera.close()
                except Exception:logger.warning('Could not close failed CSI camera')
            return False

    def read(self):
        if not self.is_opened:return False,None
        request=None
        failed=False
        try:
            request=self._camera.capture_request()
            metadata=request.get_metadata() if hasattr(request,'get_metadata') else {}
            stamp=metadata.get('SensorTimestamp')
            if stamp is None and self.factory is None:
                raise OSError('CSI sensor timestamp missing; freshness unverified')
            if stamp is not None:
                if type(stamp) is not int or stamp<=0 or (self._last_sensor_timestamp is not None and stamp<=self._last_sensor_timestamp):
                    raise OSError('CSI sensor timestamp did not advance')
                if self.factory is None:
                    age=(time.clock_gettime_ns(time.CLOCK_BOOTTIME)-stamp)/1e9
                    if not 0<=age<=5:raise OSError('CSI sensor frame is stale')
                self._last_sensor_timestamp=stamp
            frame=request.make_array('main').copy()
            return True,frame
        except Exception:
            failed=True
            logger.exception('CSI capture failed')
            return False,None
        finally:
            if request is not None:request.release()
            if failed:self.release()

    def release(self):
        camera,self._camera=self._camera,None
        if camera is not None:
            try:camera.stop()
            finally:camera.close()

    def reconnect(self):
        return self.open()


def create_camera(backend,device,width,height,fps,fourcc='MJPG'):
    if backend=='picamera2':return Picamera2Camera(width,height,fps)
    if backend=='v4l2':return Camera(device,width,height,fps,fourcc)
    raise ValueError('Unsupported camera backend; no implicit fallback')
