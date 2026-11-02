"""Recognition local: EdgeFace qua ONNX Runtime CPU; hỗ trợ lại model ArcFace cũ.

EdgeFace: RGB float32 NCHW 1x3x112x112, normalize [-1, 1], output 512D L2.
Nguồn preprocessing: https://github.com/otroshi/edgeface và
https://github.com/yakhyo/edgeface-onnx/blob/main/model/edgeface.py
"""
import logging
from pathlib import Path
import time

import cv2
import numpy as np

import config

logger = logging.getLogger(__name__)
_ARC_FACE_DST = np.array([
    [38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
    [41.5493, 92.3655], [70.7299, 92.2041],
], dtype=np.float32)


def preprocessing_id():
    if config.RECOGNIZER_PROFILE == 'edgeface':
        return 'arcface-similarity5-lstsq-112-rgb-mean127.5-scale1/127.5-l2'
    if config.RECOGNIZER_PROFILE == 'arcface':
        return 'arcface-first3-affine-112-bgr-swapRB-mean127.5-scale1/127.5-l2'
    raise ValueError(f'RECOGNIZER_PROFILE không hợp lệ: {config.RECOGNIZER_PROFILE}')


def similarity_transform(landmarks, destination=_ARC_FACE_DST):
    """Least-squares similarity 5 điểm: rotation + uniform scale + translation."""
    source = np.asarray(landmarks, dtype=np.float64)
    target = np.asarray(destination, dtype=np.float64)
    if source.shape != (5, 2) or target.shape != (5, 2) or not np.isfinite(source).all() or not np.isfinite(target).all():
        raise ValueError('Alignment cần 5 landmark hữu hạn')
    design = np.zeros((10, 4), dtype=np.float64)
    design[0::2, 0], design[0::2, 1], design[0::2, 2] = source[:, 0], -source[:, 1], 1
    design[1::2, 0], design[1::2, 1], design[1::2, 3] = source[:, 1], source[:, 0], 1
    parameters, _, rank, _ = np.linalg.lstsq(design, target.reshape(-1), rcond=None)
    if rank < 4:
        raise ValueError('Landmark suy biến; không thể align')
    a, b, tx, ty = parameters
    if a * a + b * b <= np.finfo(np.float64).eps:
        raise ValueError('Alignment scale không hợp lệ')
    return np.array([[a, -b, tx], [b, a, ty]], dtype=np.float32)


def align_face(image, face_row):
    landmarks = face_row[4:14].reshape((5, 2)).astype(np.float32)
    if config.RECOGNIZER_PROFILE == 'edgeface':
        transform = similarity_transform(landmarks)
    elif config.RECOGNIZER_PROFILE == 'arcface':
        transform = cv2.getAffineTransform(landmarks[:3], _ARC_FACE_DST[:3])
    else:
        raise ValueError(f'RECOGNIZER_PROFILE không hợp lệ: {config.RECOGNIZER_PROFILE}')
    return cv2.warpAffine(image, transform, (112, 112))


def preprocess_face(aligned_face_bgr):
    if aligned_face_bgr is None or aligned_face_bgr.shape != (112, 112, 3):
        raise ValueError('Recognition cần ảnh BGR đã align 112x112')
    return cv2.dnn.blobFromImage(
        aligned_face_bgr, 1.0 / 127.5, (112, 112), (127.5, 127.5, 127.5), swapRB=True,
    )


def normalize_embedding(output):
    embedding = np.asarray(output, dtype=np.float32).reshape(-1)
    if embedding.shape != (512,) or not np.isfinite(embedding).all():
        raise ValueError('Model phải trả embedding 512 chiều hữu hạn')
    norm = np.linalg.norm(embedding)
    if not np.isfinite(norm) or norm <= 0:
        raise ValueError('Model trả embedding có norm không hợp lệ')
    return embedding / norm


class FaceRecognizer:
    def __init__(self, model_path, runtime=None):
        started = time.monotonic()
        self.model_path = str(model_path)
        self.runtime = runtime or config.EMBEDDING_BACKEND
        if self.runtime in ('auto', 'remote'):
            self.runtime = 'onnxruntime' if Path(model_path).name.startswith('edgeface') else 'cv2dnn'
        self._session = self._net = None
        if self.runtime == 'onnxruntime':
            try:
                import onnxruntime as ort
            except ImportError as exc:
                raise RuntimeError('Thiếu ONNX Runtime CPU: chạy .venv/bin/python3 -m pip install -r requirements.txt') from exc
            ort.disable_telemetry_events()
            options = ort.SessionOptions()
            options.intra_op_num_threads = config.RECOGNIZER_THREADS
            options.inter_op_num_threads = 1
            options.add_session_config_entry('session.intra_op.allow_spinning', '0')
            self._session = ort.InferenceSession(self.model_path, sess_options=options,
                                                providers=['CPUExecutionProvider'])
            inputs, outputs = self._session.get_inputs(), self._session.get_outputs()
            if len(inputs) != 1 or len(outputs) != 1:
                raise ValueError('Recognition cần đúng một input và một output')
            input_info, output_info = inputs[0], outputs[0]
            shape = input_info.shape
            if (input_info.type != 'tensor(float)' or len(shape) != 4 or shape[1:] != [3, 112, 112]
                    or (isinstance(shape[0], int) and shape[0] != 1)):
                raise ValueError(f'Input model không phù hợp: {shape} / {input_info.type}')
            if output_info.type != 'tensor(float)' or len(output_info.shape) != 2 or output_info.shape[1] != 512:
                raise ValueError(f'Output model không phù hợp: {output_info.shape} / {output_info.type}')
            self._input_name, self._output_name = input_info.name, output_info.name
            logger.info('ONNX Runtime CPU: input=%s %s, output=%s %s, threads=%d',
                        input_info.name, input_info.shape, output_info.name, output_info.shape,
                        config.RECOGNIZER_THREADS)
        elif self.runtime == 'cv2dnn':
            self._net = cv2.dnn.readNetFromONNX(self.model_path)
        else:
            raise ValueError(f'Runtime recognition không hợp lệ: {self.runtime}')
        # Fail lúc khởi động nếu graph có lỗi, thay vì đợi người thật tới camera.
        self.get_embedding(np.zeros((112, 112, 3), dtype=np.uint8))
        logger.info('Đã load/warmup recognition %s (%s) trong %.2fs', self.model_path,
                    self.runtime, time.monotonic() - started)

    def get_embedding(self, aligned_face_bgr):
        blob = preprocess_face(aligned_face_bgr)
        if self._session is not None:
            output = self._session.run([self._output_name], {self._input_name: blob})[0]
        else:
            self._net.setInput(blob)
            output = self._net.forward()
        return normalize_embedding(output)


class RemoteFaceRecognizer:
    """Legacy remote: chưa có hợp đồng metadata xác nhận model EdgeFace phía server."""
    runtime = 'remote'

    def __init__(self, ai_service_url, timeout=5):
        if config.RECOGNIZER_PROFILE == 'edgeface':
            raise ValueError('Remote embedding chưa xác minh hỗ trợ EdgeFace; dùng EMBEDDING_BACKEND=onnxruntime trên Pi')
        import requests
        self._requests = requests
        self._url = ai_service_url.rstrip('/') + '/ai/face/extract'
        self._timeout = timeout

    def get_embedding(self, aligned_face_bgr):
        ok, buf = cv2.imencode('.jpg', aligned_face_bgr, [cv2.IMWRITE_JPEG_QUALITY, 90])
        if not ok:
            return None
        files = {'face_image': ('face.jpg', buf.tobytes(), 'image/jpeg')}
        try:
            response = self._requests.post(self._url, files=files, timeout=self._timeout)
            response.raise_for_status()
        except self._requests.RequestException as exc:
            logger.warning('Gọi AI Service thất bại: %s', exc)
            return None
        data = response.json()
        return normalize_embedding(data['embedding']) if data.get('found') else None
