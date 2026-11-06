"""FaceEngine cho AI Service chạy trên server: detect (YuNet) + align + embedding
EdgeFace — PHẢI giống hệt pipeline của edge (edge/face_recognizer.py, profile
"edgeface") để vector đăng ký trên server so khớp được với vector edge tính
từ camera:

- Align: similarity least-squares 5 landmark về template ArcFace 112x112.
- Preprocess: BGR -> RGB, (x - 127.5) / 127.5, NCHW float32 1x3x112x112.
- Model: edgeface_xs_gamma_06.onnx (cùng file, cùng SHA256 với edge/model).
- Output: 512D, L2 normalize.

PIPELINE mô tả hợp đồng này và được lưu kèm mỗi embedding; edge từ chối dữ
liệu /api/face-data nếu recognizer_sha256/preprocessing không khớp với nó.
"""
import hashlib
import os

import cv2
import numpy as np
import onnxruntime as ort

_MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "model")
DETECTOR_MODEL_PATH = os.path.join(_MODEL_DIR, "face_detection_yunet_2023mar.onnx")
RECOGNIZER_MODEL_PATH = os.path.join(_MODEL_DIR, "edgeface_xs_gamma_06.onnx")

# Phải trùng chuỗi edge/face_recognizer.py:preprocessing_id() cho profile edgeface.
PREPROCESSING_ID = "arcface-similarity5-lstsq-112-rgb-mean127.5-scale1/127.5-l2"
EMBEDDING_DIMENSION = 512

_ARC_FACE_DST = np.array([
    [38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
    [41.5493, 92.3655], [70.7299, 92.2041],
], dtype=np.float32)


def _sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def similarity_transform(landmarks, destination=_ARC_FACE_DST):
    """Least-squares similarity 5 điểm: rotation + uniform scale + translation."""
    source = np.asarray(landmarks, dtype=np.float64)
    target = np.asarray(destination, dtype=np.float64)
    if source.shape != (5, 2) or not np.isfinite(source).all():
        raise ValueError("Alignment cần 5 landmark hữu hạn")
    design = np.zeros((10, 4), dtype=np.float64)
    design[0::2, 0], design[0::2, 1], design[0::2, 2] = source[:, 0], -source[:, 1], 1
    design[1::2, 0], design[1::2, 1], design[1::2, 3] = source[:, 1], source[:, 0], 1
    parameters, _, rank, _ = np.linalg.lstsq(design, target.reshape(-1), rcond=None)
    if rank < 4:
        raise ValueError("Landmark suy biến; không thể align")
    a, b, tx, ty = parameters
    if a * a + b * b <= np.finfo(np.float64).eps:
        raise ValueError("Alignment scale không hợp lệ")
    return np.array([[a, -b, tx], [b, a, ty]], dtype=np.float32)


class FaceEngine:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            instance = super(FaceEngine, cls).__new__(cls)

            instance.detector = cv2.FaceDetectorYN.create(
                model=DETECTOR_MODEL_PATH,
                config="",
                input_size=(640, 640),
                score_threshold=0.80,
                nms_threshold=0.3,
            )

            instance.rec_session = ort.InferenceSession(
                RECOGNIZER_MODEL_PATH, providers=["CPUExecutionProvider"],
            )
            instance.rec_input_name = instance.rec_session.get_inputs()[0].name

            instance.pipeline = {
                "recognizer_sha256": _sha256_file(RECOGNIZER_MODEL_PATH),
                "preprocessing": PREPROCESSING_ID,
                "embedding_dimension": EMBEDDING_DIMENSION,
            }
            cls._instance = instance

        return cls._instance

    def align_face(self, image, face_data):
        landmarks = face_data[4:14].reshape((5, 2)).astype(np.float32)
        return cv2.warpAffine(image, similarity_transform(landmarks), (112, 112))

    def detect_faces(self, image, detect_width=640):
        """Phát hiện khuôn mặt bằng YuNet, tự động thu nhỏ nếu ảnh quá lớn để YuNet
        đạt độ nhạy tối ưu (ảnh điện thoại 2K-4K nếu để nguyên kích thước dễ bị trượt).
        Toạ độ trả về được quy đổi ngược về hệ toạ độ ảnh gốc."""
        h, w = image.shape[:2]
        scale = 1.0
        small = image
        if detect_width and w > detect_width:
            scale = w / float(detect_width)
            small = cv2.resize(image, (detect_width, max(1, int(h / scale))))

        sh, sw = small.shape[:2]
        self.detector.setInputSize((sw, sh))
        _, faces = self.detector.detect(small)

        if faces is None or len(faces) == 0:
            return []

        faces = faces.copy()
        if scale != 1.0:
            faces[:, :14] *= scale
        return faces

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
        embedding = np.asarray(net_out, dtype=np.float32).reshape(-1)
        if embedding.shape != (EMBEDDING_DIMENSION,) or not np.isfinite(embedding).all():
            raise ValueError("Model phải trả embedding 512 chiều hữu hạn")
        norm = np.linalg.norm(embedding)
        if norm <= 0:
            raise ValueError("Embedding có norm không hợp lệ")
        return embedding / norm
