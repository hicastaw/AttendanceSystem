"""
AI Service — FastAPI
Wraps FaceEngine thành HTTP API để backend Node.js gọi vào.

Endpoints:
    POST /ai/face/validate  - Kiểm tra + trích embedding (dùng cho enrollment)
    POST /ai/face/extract   - Trích embedding từ frame (dùng cho nhận diện realtime)
"""

import sys
import os
import io
import numpy as np
import cv2

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# Add core to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core.face_engine import FaceEngine

app = FastAPI(title="AttendanceSystem AI Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Singleton FaceEngine
engine = FaceEngine()


def decode_image(file_bytes: bytes) -> np.ndarray:
    """Decode bytes thành OpenCV BGR image."""
    nparr = np.frombuffer(file_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Không thể đọc file ảnh.")
    return img


@app.get("/")
def health_check():
    return {"status": "ok", "service": "AttendanceSystem AI Service"}


@app.post("/ai/face/validate")
async def validate_face(face_image: UploadFile = File(...)):
    """
    Kiểm tra ảnh khuôn mặt để đăng ký (enrollment).
    - Detect khuôn mặt
    - Kiểm tra độ sắc nét (sharpness)
    - Trích embedding
    
    Returns:
        is_valid: bool
        embedding: list[float] | None
        sharpness_score: float
        message: str
    """
    file_bytes = await face_image.read()
    img_bgr = decode_image(file_bytes)
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    # Detect + extract embedding
    embedding = engine.extract_face_embedding(img_rgb)

    if embedding is None:
        # Thử check sharpness riêng để trả lỗi chi tiết hơn
        h, w, _ = img_bgr.shape
        engine.detector.setInputSize((w, h))
        _, faces = engine.detector.detect(img_rgb)

        if faces is None or len(faces) == 0:
            return {
                "is_valid": False,
                "embedding": None,
                "sharpness_score": 0.0,
                "message": "Không phát hiện khuôn mặt trong ảnh. Vui lòng chụp lại.",
                "error_code": "NO_FACE_DETECTED"
            }

        # Có face nhưng bị blur
        face = faces[0]
        aligned = engine.align_face(img_rgb, face)
        sharpness = engine.calculate_shapeness(aligned)

        return {
            "is_valid": False,
            "embedding": None,
            "sharpness_score": round(float(sharpness), 2),
            "message": f"Ảnh không phù hợp, yêu cầu chụp lại. (Độ sắc nét: {sharpness:.1f} < 100)",
            "error_code": "BLURRY_IMAGE"
        }

    # Tính sharpness để trả về thông tin
    h, w, _ = img_bgr.shape
    engine.detector.setInputSize((w, h))
    _, faces = engine.detector.detect(img_rgb)
    sharpness = 0.0
    if faces is not None and len(faces) > 0:
        aligned = engine.align_face(img_rgb, faces[0])
        sharpness = engine.calculate_shapeness(aligned)

    return {
        "is_valid": True,
        "embedding": embedding.tolist(),
        "sharpness_score": round(float(sharpness), 2),
        "message": "Ảnh hợp lệ. Khuôn mặt được nhận diện thành công.",
        "error_code": None
    }


@app.post("/ai/face/extract")
async def extract_face(face_image: UploadFile = File(...)):
    """
    Trích embedding từ ảnh/frame realtime (dùng cho điểm danh).
    Không kiểm tra sharpness nghiêm ngặt, chỉ cần detect được mặt.

    Returns:
        found: bool
        embedding: list[float] | None
        sharpness_score: float
        confidence: float  (score detect từ YuNet, 0.0–1.0)
    """
    file_bytes = await face_image.read()
    img_bgr = decode_image(file_bytes)
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    h, w, _ = img_bgr.shape
    engine.detector.setInputSize((w, h))
    _, faces = engine.detector.detect(img_rgb)

    if faces is None or len(faces) == 0:
        return {
            "found": False,
            "embedding": None,
            "sharpness_score": 0.0,
            "confidence": 0.0
        }

    face = faces[0]
    confidence = float(face[-1])

    if confidence < 0.8:
        return {
            "found": False,
            "embedding": None,
            "sharpness_score": 0.0,
            "confidence": round(confidence, 4)
        }

    aligned = engine.align_face(img_rgb, face)
    sharpness = engine.calculate_shapeness(aligned)

    # Extract embedding (dù blur vẫn lấy, để backend tự quyết định via DB function)
    blob = cv2.dnn.blobFromImage(
        aligned, 1.0 / 127.5, (112, 112), (127.5, 127.5, 127.5), swapRB=True
    )
    net_out = engine.rec_session.run(None, {engine.input_name: blob})[0]
    embedding = net_out.flatten()
    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding = embedding / norm

    return {
        "found": True,
        "embedding": embedding.tolist(),
        "sharpness_score": round(float(sharpness), 2),
        "confidence": round(confidence, 4)
    }
