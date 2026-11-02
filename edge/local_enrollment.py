"""Kho enrollment cục bộ cho live test; không liên quan database attendance."""
import hashlib
import json
import os
from pathlib import Path
import tempfile

import numpy as np

import config
from face_recognizer import preprocessing_id

DEFAULT_ENROLLMENT_FILE = Path(__file__).resolve().parent / 'data' / 'enrollments.json'


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def pipeline_metadata():
    return {
        'detector_sha256': sha256_file(config.DETECTOR_MODEL_PATH),
        'recognizer_sha256': sha256_file(config.RECOGNIZER_MODEL_PATH),
        'preprocessing': preprocessing_id(),
        'embedding_dimension': 512,
    }


def validate_local_document(document):
    if not isinstance(document, dict) or document.get('version') != 1:
        raise ValueError('Định dạng enrollment cục bộ không hợp lệ (cần version=1)')
    if document.get('pipeline') != pipeline_metadata():
        raise ValueError('Enrollment không khớp model/preprocessing hiện tại; cần đăng ký lại bằng model đúng')
    rows = document.get('data')
    if not isinstance(rows, list):
        raise ValueError('Enrollment phải có danh sách data')
    known, codes = [], set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('Bản ghi enrollment không hợp lệ')
        code = row.get('user_code')
        if not isinstance(code, str) or not code.strip() or code in codes:
            raise ValueError('Mã enrollment rỗng hoặc trùng lặp')
        try:
            vector = np.asarray(row['embedding'], dtype=np.float32)
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f'Embedding không hợp lệ cho ID {code}') from exc
        if vector.shape != (512,) or not np.isfinite(vector).all():
            raise ValueError(f'Embedding của ID {code} phải có 512 giá trị hữu hạn')
        norm = np.linalg.norm(vector)
        if not np.isfinite(norm) or norm <= 0:
            raise ValueError(f'Embedding của ID {code} có norm không hợp lệ')
        name = row.get('full_name') or code
        if not isinstance(name, str):
            raise ValueError(f'Tên của ID {code} không hợp lệ')
        known.append({'user_code': code, 'full_name': name, 'embedding': vector / norm})
        codes.add(code)
    return known


def load_local_enrollments(path):
    with open(path, encoding='utf-8') as source:
        return validate_local_document(json.load(source))


def save_local_enrollments(document, path, replace=False):
    # Validate toàn bộ trước khi ghi; publish atomically, không để file nửa chừng.
    validate_local_document(document)
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix='.enrollment-', suffix='.tmp', dir=destination.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            json.dump(document, output, ensure_ascii=False, allow_nan=False, indent=2)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        if replace:
            os.replace(temporary, destination)
        else:
            # link tạo file mới atomically và từ chối nếu file đích đã tồn tại.
            os.link(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
