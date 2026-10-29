"""Face recognition cho edge.

FaceRecognizer (mặc định, EMBEDDING_BACKEND=cv2dnn):
    Dùng NGUYÊN model w600k_mbf.onnx đã có trong backend/ai/model/ và NGUYÊN
    công thức align/blob của backend/ai/core/face_engine.py — chỉ đổi runtime
    từ `onnxruntime.InferenceSession` (không có wheel/gói apt cho ARMv7) sang
    `cv2.dnn.readNetFromONNX` (có sẵn trong python3-opencv armhf qua
    libopencv-dnn410). Không đổi thuật toán, không đổi độ chính xác nếu OpenCV
    import được graph ONNX này — cần xác nhận trên chính Orange Pi (xem
    EDGE_DEPLOYMENT.md, mục kiểm thử AI).

RemoteFaceRecognizer (fallback, EMBEDDING_BACKEND=remote):
    Nếu cv2.dnn không import được model, chuyển embedding sang chạy trên
    laptop: gửi ảnh mặt đã align (112x112, vài KB) tới AI Service FastAPI
    hiện có (backend/ai/main.py, endpoint /ai/face/extract), vốn vẫn dùng
    onnxruntime bình thường trên laptop (x86_64, có wheel đầy đủ).
"""
import logging
import time

import cv2
import numpy as np
from model_contract import LEGACY_CONTRACT, verify_legacy_model
from pipeline import normalize

logger = logging.getLogger(__name__)

# Template 5 điểm ArcFace 112x112 — giống hệt backend/ai/core/face_engine.py:align_face
_ARC_FACE_DST = np.array([
    [38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
    [41.5493, 92.3655], [70.7299, 92.2041],
], dtype=np.float32)


def align_face(image, face_row):
    landmarks = face_row[4:14].reshape((5, 2)).astype(np.float32)
    tform = cv2.getAffineTransform(landmarks[:3], _ARC_FACE_DST[:3])
    return cv2.warpAffine(image, tform, (112, 112))


class FaceRecognizer:
    contract = LEGACY_CONTRACT
    def __init__(self, model_path):
        verify_legacy_model(model_path)
        t0 = time.time()
        self._net = cv2.dnn.readNetFromONNX(model_path)
        logger.info("Đã load model face recognition qua cv2.dnn (%s) trong %.2fs", model_path, time.time() - t0)

    def get_embedding(self, aligned_face_bgr):
        blob = cv2.dnn.blobFromImage(
            aligned_face_bgr, 1.0 / 127.5, (112, 112), (127.5, 127.5, 127.5), swapRB=True,
        )
        self._net.setInput(blob)
        out = self._net.forward()
        embedding = out.flatten().astype(np.float32)
        return normalize(embedding).astype(np.float32)


class RemoteFaceRecognizer:
    """Fallback: nhận diện chạy trên laptop qua AI Service /ai/face/extract."""

    def __init__(self, ai_service_url, timeout=5):
        import requests
        self._requests = requests
        self._url = ai_service_url.rstrip("/") + "/ai/face/embed-aligned"
        self._timeout = timeout
        logger.info("FaceRecognizer chạy ở chế độ REMOTE, gọi %s", self._url)

    def get_embedding(self, aligned_face_bgr):
        ok, buf = cv2.imencode(".png", aligned_face_bgr)
        if not ok:
            return None
        files = {"face_image": ("face.png", buf.tobytes(), "image/png")}
        try:
            resp = self._requests.post(self._url, files=files, timeout=self._timeout, allow_redirects=False)
            resp.raise_for_status()
        except self._requests.RequestException as exc:
            logger.warning("Gọi AI Service (remote embedding) thất bại: %s", exc)
            return None

        try:
            data = resp.json()
            if not data.get("found") or data.get('embedding_contract') != LEGACY_CONTRACT:
                return None
            return normalize(data['embedding']).astype(np.float32)
        except (ValueError, TypeError, KeyError):
            return None
