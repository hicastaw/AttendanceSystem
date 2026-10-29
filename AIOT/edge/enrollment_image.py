"""Bounded RAM-only upload decoding and shared R50 enrollment validation.

No model is loaded here. Only the existing camera owner invokes model methods.
Uploaded images never enter the live attendance/recognition path.
"""
import io
import warnings

import cv2
import numpy as np

from capture_session import SampleRejected
from pipeline import normalize

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_SIDE = 4096
MAX_IMAGE_PIXELS = 12_000_000

_MODEL_ERRORS = (ValueError, OSError, RuntimeError, cv2.error)
try:
    from onnxruntime.capi.onnxruntime_pybind11_state import Fail, InvalidArgument, RuntimeException, InvalidGraph, EPFail
    _MODEL_ERRORS += (Fail, InvalidArgument, RuntimeException, InvalidGraph, EPFail)
except ImportError:
    pass  # Legacy/non-ONNX test imports do not activate an R50 provider.


class ImageRejected(ValueError):
    def __init__(self, code, status=400):
        super().__init__(code)
        self.code, self.status = code, status


def decode_upload(data, mime):
    from PIL import Image, ImageOps, UnidentifiedImageError
    if not data:raise ImageRejected('invalid_image')
    if len(data) > MAX_IMAGE_BYTES:raise ImageRejected('image_too_large', 413)
    formats = {'image/jpeg': 'JPEG', 'image/jpg': 'JPEG', 'image/png': 'PNG'}
    if mime not in formats:raise ImageRejected('unsupported_format', 415)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format not in ('JPEG', 'PNG') or image.format != formats[mime]:
                    raise ImageRejected('unsupported_format', 415)
                width, height = image.size
                if min(width, height) <= 0 or max(width, height) > MAX_IMAGE_SIDE or width * height > MAX_IMAGE_PIXELS:
                    raise ImageRejected('image_too_large', 413)
                if getattr(image, 'n_frames', 1) != 1:raise ImageRejected('unsupported_format', 415)
                image.verify()
            with Image.open(io.BytesIO(data)) as image:
                with ImageOps.exif_transpose(image) as oriented:
                    rgb = np.asarray(oriented.convert('RGB'), dtype=np.uint8)
                    return rgb[:, :, ::-1].copy()
    except ImageRejected:raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ImageRejected('image_too_large', 413) from None
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError):
        raise ImageRejected('invalid_image') from None


def preview_jpeg(image):
    height, width = image.shape[:2]
    ratio = min(1., 640 / max(height, width))
    preview = image if ratio == 1 else cv2.resize(image, (max(1, round(width * ratio)), max(1, round(height * ratio))))
    ok, value = cv2.imencode('.jpg', preview, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:raise SampleRejected('alignment_failed')
    return value.tobytes()


def embed_face(image, face, align, embedding, *, fresh=None):
    if fresh is not None and not fresh():raise SampleRejected('stale_frame')
    row = np.asarray(face)
    if row.shape != (15,) or not np.isfinite(row).all() or row[2] <= 0 or row[3] <= 0:
        raise SampleRejected('invalid_landmarks')
    height, width = image.shape[:2]
    if row[0] >= width or row[1] >= height or row[0] + row[2] <= 0 or row[1] + row[3] <= 0:
        raise SampleRejected('invalid_landmarks')
    landmarks = row[4:14].reshape(5, 2)
    if np.linalg.matrix_rank(landmarks - landmarks.mean(axis=0)) < 2:
        raise SampleRejected('invalid_landmarks')
    try:
        aligned = align(image, face)
        if aligned.shape != (112, 112, 3) or aligned.dtype != np.uint8:
            raise ValueError('Invalid aligned image')
    except (ValueError, cv2.error):
        raise SampleRejected('alignment_failed') from None
    # Same sharpness policy as the existing camera capture, no new threshold.
    if cv2.Laplacian(cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var() < 100:
        raise SampleRejected('image_blurry')
    try:
        value = np.asarray(embedding(aligned))
        if value.dtype.kind != 'f':raise ValueError('Embedding must be floating point')
        value = normalize(value)
    except _MODEL_ERRORS:
        raise SampleRejected('embedding_failed') from None
    if fresh is not None and not fresh():raise SampleRejected('stale_frame')
    return value


def process_uploaded(capture, adapter):
    """Called by main's owner thread, before camera reads; never emits attendance."""
    pending = capture.take_upload()
    if pending is None:return False
    session_id, image = pending
    try:
        faces = adapter.detect(image)
        capture.observe(faces, lambda face: embed_face(image, face, adapter.align, adapter.get_embedding),
                        source='upload', session_id=session_id, preview=preview_jpeg(image))
    except (SampleRejected, *_MODEL_ERRORS) as error:
        capture.reject(session_id, error.reason if isinstance(error, SampleRejected) else 'embedding_failed')
    finally:
        image.fill(0)
    return True
