"""AI Service rút gọn — chạy trên laptop, chỉ phục vụ:
  - /ai/face/validate : validate + trích embedding khi ĐĂNG KÝ khuôn mặt (trang quản lý)
  - /ai/face/extract  : dự phòng cho edge (EMBEDDING_BACKEND=remote) nếu cv2.dnn
                        không chạy được model trên Orange Pi

Không có endpoint nhận diện realtime nào khác vì việc so khớp/quyết định
check_in-check_out giờ nằm hoàn toàn ở thiết bị biên.
"""
import sys
import os
import numpy as np
import cv2

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core.face_engine import FaceEngine

app = FastAPI(title="AIOT Lab Access - AI Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_FILE_SIZE = 10 * 1024 * 1024
ALLOWED_FORMATS = ["image/jpeg", "image/png", "image/jpg"]

engine = FaceEngine()


def validate_upload_file(file: UploadFile):
    if file.content_type not in ALLOWED_FORMATS:
        raise HTTPException(status_code=400, detail=f"Định dạng {file.content_type} không hỗ trợ. Chỉ nhận JPG/PNG.")
    if file.size > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail=f"File quá lớn ({file.size / 1024 / 1024:.2f}MB). Tối đa 10MB.")


def decode_image(file_bytes: bytes) -> np.ndarray:
    nparr = np.frombuffer(file_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Không thể đọc dữ liệu hình ảnh.")
    return img


@app.get("/")
def health_check():
    return {"status": "ok", "service": "AIOT Lab Access - AI Service"}


@app.post("/ai/face/validate")
def validate_face(face_image: UploadFile = File(...)):
    validate_upload_file(face_image)
    img_bgr = decode_image(face_image.file.read())

    h, w, _ = img_bgr.shape
    engine.detector.setInputSize((w, h))
    _, faces = engine.detector.detect(img_bgr)

    if faces is None or len(faces) == 0:
        return {
            "is_valid": False, "embedding": None, "sharpness_score": 0.0,
            "message": "Không phát hiện khuôn mặt trong ảnh. Vui lòng chụp lại.",
            "error_code": "NO_FACE_DETECTED",
        }

    face = faces[0]
    if float(face[-1]) < 0.80:
        return {
            "is_valid": False, "embedding": None, "sharpness_score": 0.0,
            "message": "Ảnh không rõ mặt người thật. Vui lòng chụp lại.",
            "error_code": "LOW_CONFIDENCE",
        }

    aligned = engine.align_face(img_bgr, face)
    sharpness = engine.calculate_shapeness(aligned)
    if sharpness < 100.0:
        return {
            "is_valid": False, "embedding": None, "sharpness_score": round(float(sharpness), 2),
            "message": f"Ảnh quá mờ, yêu cầu chụp lại. (Độ sắc nét: {sharpness:.1f})",
            "error_code": "BLURRY_IMAGE",
        }

    embedding = engine.get_face_embedding(aligned)
    return {
        "is_valid": True,
        "embedding": embedding.tolist(),
        "sharpness_score": round(float(sharpness), 2),
        "message": "Ảnh hợp lệ.",
        "error_code": None,
    }


@app.post("/ai/face/extract")
def extract_face(face_image: UploadFile = File(...)):
    """Dự phòng cho edge khi EMBEDDING_BACKEND=remote (xem
    edge/face_recognizer.py:RemoteFaceRecognizer)."""
    validate_upload_file(face_image)
    img_bgr = decode_image(face_image.file.read())

    h, w, _ = img_bgr.shape
    engine.detector.setInputSize((w, h))
    _, faces = engine.detector.detect(img_bgr)

    if faces is None or len(faces) == 0:
        return {"found": False, "embedding": None, "error_code": "NO_FACE"}

    face = faces[0]
    if float(face[-1]) < 0.70:
        return {"found": False, "embedding": None, "error_code": "LOW_CONFIDENCE"}

    aligned = engine.align_face(img_bgr, face)
    if engine.is_blurry(aligned, threshold=100.0):
        return {"found": False, "embedding": None, "error_code": "BLURRY_IMAGE"}

    embedding = engine.get_face_embedding(aligned)
    return {
        "found": True,
        "embedding": embedding.tolist(),
        "confidence": round(float(face[-1]), 4),
    }
