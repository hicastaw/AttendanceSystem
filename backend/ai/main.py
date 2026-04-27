import sys
import os
import numpy as np
import cv2

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core.face_engine import FaceEngine

app = FastAPI(title="PTIT Attendance AI Service", version="2.2.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 Megabytes
ALLOWED_FORMATS = ["image/jpeg", "image/png", "image/jpg"]

engine = FaceEngine()

def validate_upload_file(file: UploadFile):
    """Kiểm tra dung lượng và định dạng file trước khi xử lý."""
    if file.content_type not in ALLOWED_FORMATS:
        raise HTTPException(
            status_code=400, 
            detail=f"Định dạng {file.content_type} không hỗ trợ. Chỉ nhận JPG/PNG."
        )
    
    if file.size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413, 
            detail=f"File quá lớn ({file.size / 1024 / 1024:.2f}MB). Giới hạn tối đa là 10MB."
        )

def decode_image(file_bytes: bytes) -> np.ndarray:
    nparr = np.frombuffer(file_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Không thể đọc dữ liệu hình ảnh.")
    return img

@app.get("/")
def health_check():
    return {"status": "ok", "service": "AttendanceSystem AI Service"}

@app.post("/ai/face/validate")
def validate_face(face_image: UploadFile = File(...)):
    validate_upload_file(face_image)
    
    file_bytes = face_image.file.read()
    img_bgr = decode_image(file_bytes)

    h, w, _ = img_bgr.shape
    engine.detector.setInputSize((w, h))
    _, faces = engine.detector.detect(img_bgr)

    if faces is None or len(faces) == 0:
        return {
            "is_valid": False,
            "embedding": None,
            "sharpness_score": 0.0,
            "liveness_score": 0.0,
            "message": "Không phát hiện khuôn mặt trong ảnh. Vui lòng chụp lại.",
            "error_code": "NO_FACE_DETECTED"
        }

    face = faces[0]
    confidence = float(face[-1])

    if confidence < 0.80:
        return {
            "is_valid": False,
            "embedding": None,
            "sharpness_score": 0.0,
            "liveness_score": 0.0,
            "message": "Ảnh không rõ mặt người thật. Vui lòng chụp lại.",
            "error_code": "LOW_CONFIDENCE"
        }

    aligned = engine.align_face(img_bgr, face)
    
    sharpness = engine.calculate_shapeness(aligned)
    if sharpness < 100.0:
        return {
            "is_valid": False,
            "embedding": None,
            "sharpness_score": round(float(sharpness), 2),
            "liveness_score": 0.0,
            "message": f"Ảnh quá mờ, yêu cầu chụp lại. (Độ sắc nét: {sharpness:.1f})",
            "error_code": "BLURRY_IMAGE"
        }

    embedding = engine.get_face_embedding(aligned)

    return {
        "is_valid": True,
        "embedding": embedding.tolist(),
        "sharpness_score": round(float(sharpness), 2),
        "message": "Ảnh hợp lệ. Khuôn mặt được xác nhận là người thật.",
        "error_code": None
    }

@app.post("/ai/face/extract")
def extract_face(face_image: UploadFile = File(...)):
    validate_upload_file(face_image)
    
    file_bytes = face_image.file.read()
    img_bgr = decode_image(file_bytes)

    h, w, _ = img_bgr.shape
    engine.detector.setInputSize((w, h))
    _, faces = engine.detector.detect(img_bgr)

    if faces is None or len(faces) == 0:
        return {
            "found": False,
            "embedding": None,
            "liveness_score": 0.0,
            "error_code": "NO_FACE"
        }

    face = faces[0]
    confidence = float(face[-1])
    
    if confidence < 0.80:
        return {
            "found": False,
            "embedding": None,
            "liveness_score": 0.0,
            "error_code": "LOW_CONFIDENCE"
        }

    aligned = engine.align_face(img_bgr, face)
    
    sharpness = engine.calculate_shapeness(aligned)
    
    is_real, liveness_score = engine.check_liveness(img_bgr, face)
    if not is_real:
        return {
            "found": False, 
            "embedding": None,
            "sharpness_score": round(float(sharpness), 2),
            "liveness_score": round(float(liveness_score), 4),
            "message": "Phát hiện giả mạo! Vui lòng không sử dụng điện thoại hoặc ảnh chụp.",
            "error_code": "SPOOFING_DETECTED"
        }

    embedding = engine.get_face_embedding(aligned)

    return {
        "found": True,
        "embedding": embedding.tolist(),
        "sharpness_score": round(float(sharpness), 2),
        "liveness_score": round(float(liveness_score), 4),
        "confidence": round(confidence, 4)
    }