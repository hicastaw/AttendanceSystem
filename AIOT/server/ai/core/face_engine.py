"""FaceEngine rút gọn cho AI Service chạy trên laptop (PoC lab access).

So với backend/ai/core/face_engine.py gốc của project cũ: BỎ 2 model chống
giả mạo (MiniFASNetV2/V1SE) và check_liveness() — không cần thiết cho việc
đăng ký khuôn mặt thủ công (người dùng tự chụp/tải ảnh của chính mình), và
việc bớt tải 2 model onnxruntime giúp AI Service khởi động nhẹ hơn. Phần
detect/align/embedding giữ nguyên logic gốc.
"""
import cv2
import numpy as np
import onnxruntime as ort
import os
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[3] / 'edge'))
from model_contract import verify_legacy_model
from pipeline import normalize


class FaceEngine:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(FaceEngine, cls).__new__(cls)

            base_dir = os.path.dirname(os.path.abspath(__file__))
            model_path = os.path.join(base_dir, "..", "model")
            verify_legacy_model(Path(model_path) / 'face_detection_yunet_2023mar.onnx')
            verify_legacy_model(Path(model_path) / 'w600k_mbf.onnx')

            cls._instance.detector = cv2.FaceDetectorYN.create(
                model=os.path.join(model_path, "face_detection_yunet_2023mar.onnx"),
                config="",
                input_size=(640, 640),
                score_threshold=0.80,
                nms_threshold=0.3,
            )

            cls._instance.rec_session = ort.InferenceSession(
                os.path.join(model_path, "w600k_mbf.onnx"),
                providers=["CPUExecutionProvider"],
            )
            cls._instance.rec_input_name = cls._instance.rec_session.get_inputs()[0].name

        return cls._instance

    def align_face(self, image, face_data):
        landmarks = face_data[4:14].reshape((5, 2)).astype(np.float32)
        dst = np.array([
            [38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
            [41.5493, 92.3655], [70.7299, 92.2041],
        ], dtype=np.float32)
        tform = cv2.getAffineTransform(landmarks[:3], dst[:3])
        return cv2.warpAffine(image, tform, (112, 112))

    def calculate_shapeness(self, image):
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        return cv2.Laplacian(gray, cv2.CV_64F).var()

    def is_blurry(self, image, threshold=100.0):
        return self.calculate_shapeness(image) < threshold

    def get_face_embedding(self, aligned_face):
        blob = cv2.dnn.blobFromImage(
            aligned_face, 1.0 / 127.5, (112, 112), (127.5, 127.5, 127.5), swapRB=True
        )
        net_out = self.rec_session.run(None, {self.rec_input_name: blob})[0]
        embedding = net_out.flatten()
        return normalize(embedding).astype(np.float32)
