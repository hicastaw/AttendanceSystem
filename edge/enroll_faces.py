"""Enrollment từ ảnh thật vào kho local; không mở camera hoặc gửi request HTTP."""
import argparse
from datetime import datetime, timezone
import logging
import json
import os
from pathlib import Path

import cv2
import numpy as np

import config
from face_detector import FaceDetector
from face_recognizer import FaceRecognizer, align_face
from local_enrollment import (DEFAULT_ENROLLMENT_FILE, pipeline_metadata,
                              save_local_enrollments, sha256_file, validate_local_document)

logger = logging.getLogger(__name__)
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}


def collect_images(paths):
    images = []
    for path in map(Path, paths):
        if path.is_dir():
            images.extend(sorted(p for p in path.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS))
        elif path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS:
            images.append(path)
        else:
            raise ValueError(f'Không tìm thấy ảnh hợp lệ: {path}')
    if not images:
        raise ValueError('Không có ảnh để enrollment')
    if len({p.resolve() for p in images}) != len(images):
        raise ValueError('Danh sách đầu vào bị trùng file ảnh')
    return images


def build_enrollments(images, detector, recognizer, start_id=1, largest_face=False):
    records = []
    for index, path in enumerate(images, start=start_id):
        frame = cv2.imread(str(path))
        if frame is None:
            raise ValueError(f'Không đọc được ảnh: {path}')
        faces = detector.detect(frame, detect_width=config.DETECT_WIDTH)
        if not len(faces):
            raise ValueError(f'Không phát hiện mặt trong {path}; không ghi enrollment')
        if len(faces) > 1 and not largest_face:
            raise ValueError(f'{path} có {len(faces)} mặt; chọn ảnh một người hoặc dùng --largest-face có chủ đích')
        face = max(faces, key=lambda row: float(row[2] * row[3]))
        embedding = recognizer.get_embedding(align_face(frame, face))
        if embedding is None or embedding.shape != (512,) or not np.isfinite(embedding).all():
            raise ValueError(f'Không tạo được embedding 512D hợp lệ từ {path}')
        norm = np.linalg.norm(embedding)
        if not np.isfinite(norm) or norm <= 0:
            raise ValueError(f'Embedding có norm không hợp lệ: {path}')
        records.append({
            'user_code': str(index), 'full_name': path.stem,
            'embedding': (embedding / norm).tolist(),
            'source_image': path.name, 'source_sha256': sha256_file(path),
            'box': [int(value) for value in face[:4]],
            'detection_score': float(face[14]), 'faces_detected': len(faces),
        })
    return {'version': 1, 'created_at': datetime.now(timezone.utc).isoformat(),
            'pipeline': pipeline_metadata(), 'data': records}


def rebuild_enrollments(previous, images, detector, recognizer, largest_face=False):
    """Tạo lại vector từ ảnh gốc, không coi vector model cũ là tương thích."""
    if not isinstance(previous, dict) or previous.get('version') != 1 or not previous.get('data'):
        raise ValueError('Kho cũ không hợp lệ hoặc rỗng')
    lookup = {}
    for path in images:
        if path.name in lookup:
            raise ValueError(f'Trùng tên file nguồn: {path.name}')
        lookup[path.name] = path
    sources, identities = [], set()
    for row in previous['data']:
        code, name = row.get('user_code'), row.get('full_name')
        if not isinstance(code, str) or not code.strip() or code in identities or not isinstance(name, str) or not name:
            raise ValueError('Kho cũ có ID/tên không hợp lệ hoặc trùng lặp')
        path = lookup.get(row.get('source_image'))
        if path is None:
            raise ValueError(f'Không tìm thấy ảnh gốc cho ID {code}')
        if row.get('source_sha256') and row['source_sha256'] != sha256_file(path):
            raise ValueError(f'Ảnh gốc của ID {code} đã thay đổi; không tự tái đăng ký')
        sources.append(path)
        identities.add(code)
    rebuilt = build_enrollments(sources, detector, recognizer, largest_face=largest_face)
    for row, original in zip(rebuilt['data'], previous['data']):
        row['user_code'], row['full_name'] = original['user_code'], original['full_name']
    rebuilt['created_at'] = previous.get('created_at', rebuilt['created_at'])
    rebuilt['updated_at'] = datetime.now(timezone.utc).isoformat()
    rebuilt['previous_pipeline'] = previous.get('pipeline')
    validate_local_document(rebuilt)
    return rebuilt


def backup_store(path, original_bytes):
    backup = path.with_name(f'{path.stem}.before-{sha256_file(path)[:12]}{path.suffix}')
    if backup.exists():
        if backup.read_bytes() != original_bytes:
            raise ValueError('File backup đã tồn tại nhưng nội dung khác')
    else:
        fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as output:
            output.write(original_bytes)
            output.flush()
            os.fsync(output.fileno())
    return backup


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('paths', nargs='+', help='Ảnh theo thứ tự ID; thư mục được sắp xếp theo tên file')
    parser.add_argument('--output', type=Path, default=DEFAULT_ENROLLMENT_FILE)
    parser.add_argument('--start-id', type=int, default=1)
    parser.add_argument('--largest-face', action='store_true', help='Chọn mặt lớn nhất khi ảnh có nhiều mặt')
    parser.add_argument('--replace', action='store_true', help='Thay toàn bộ kho local đã có, không phải thêm bản ghi')
    parser.add_argument('--rebuild-existing', action='store_true',
                        help='Tạo lại embedding từ ảnh gốc bằng model hiện tại, giữ ID/tên, backup kho cũ')
    args = parser.parse_args(argv)
    if args.start_id < 1:
        parser.error('--start-id phải >= 1')
    if args.output.exists() and not (args.replace or args.rebuild_existing):
        parser.error(f'{args.output} đã có; không ghi đè. Dùng --replace chỉ khi muốn thay toàn bộ kho')
    if args.rebuild_existing and args.replace:
        parser.error('Chọn --rebuild-existing hoặc --replace, không kết hợp hai cách')
    try:
        original_bytes = args.output.read_bytes() if args.rebuild_existing else None
        images = collect_images(args.paths)
        detector = FaceDetector(config.DETECTOR_MODEL_PATH, score_threshold=config.DETECTION_SCORE_THRESHOLD)
        recognizer = FaceRecognizer(config.RECOGNIZER_MODEL_PATH)
        if args.rebuild_existing:
            document = rebuild_enrollments(json.loads(original_bytes), images, detector, recognizer, args.largest_face)
            if args.output.read_bytes() != original_bytes:
                raise ValueError('Kho đã thay đổi trong lúc xử lý; không ghi đè')
            backup = backup_store(args.output, original_bytes)
            print(f'Backup kho cũ: {backup}')
        else:
            document = build_enrollments(images, detector, recognizer, args.start_id, args.largest_face)
        save_local_enrollments(document, args.output, replace=args.replace or args.rebuild_existing)
    except (ValueError, OSError, cv2.error) as exc:
        logger.error('Enrollment không thành công: %s', exc)
        return 1
    for row in document['data']:
        print(f"ID {row['user_code']}: {row['source_image']} | faces={row['faces_detected']} "
              f"| detection={row['detection_score']:.4f} | embedding=512D")
    print(f'Đã lưu {len(document["data"])} enrollment tại {args.output}. Không gửi attendance hoặc lưu ảnh mới.')
    return 0


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    raise SystemExit(main())
