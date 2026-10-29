"""Face detection — tái sử dụng nguyên logic YuNet từ
backend/ai/core/face_engine.py (FaceEngine.detector), chỉ tách thành
class riêng cho edge và thêm bước resize trước khi detect để nhẹ CPU
trên Orange Pi (ARMv7, 4 nhân 1.3GHz).
"""
import logging
import time

import cv2
from model_contract import verify_legacy_model

logger = logging.getLogger(__name__)


class FaceDetector:
    def __init__(self, model_path, score_threshold=0.80, nms_threshold=0.3):
        verify_legacy_model(model_path)
        t0 = time.time()
        self._detector = cv2.FaceDetectorYN.create(
            model=model_path,
            config="",
            input_size=(320, 320),
            score_threshold=score_threshold,
            nms_threshold=nms_threshold,
        )
        logger.info("Đã load model face detection (%s) trong %.2fs", model_path, time.time() - t0)

    def detect(self, frame, detect_width=320):
        """Trả về danh sách face rows (giống format YuNet gốc: x,y,w,h,5 landmark(10),score),
        toạ độ đã quy đổi về hệ frame gốc (không phải frame đã resize)."""
        h, w = frame.shape[:2]
        scale = 1.0
        small = frame
        if detect_width and w > detect_width:
            scale = w / float(detect_width)
            small = cv2.resize(frame, (detect_width, max(1, int(h / scale))))

        sh, sw = small.shape[:2]
        self._detector.setInputSize((sw, sh))
        _, faces = self._detector.detect(small)

        if faces is None or len(faces) == 0:
            return []

        faces = faces.copy()
        if scale != 1.0:
            faces[:, :14] *= scale  # bbox (4) + 5 landmark (10) đều theo toạ độ pixel
        return faces
