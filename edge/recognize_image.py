"""Nhận diện khuôn mặt từ file ảnh thay vì camera — dùng để thử pipeline edge
khi chưa cắm camera, hoặc để kiểm tra độ chính xác với ảnh có sẵn.

Dùng đúng pipeline của main.py: detect (YuNet) -> align -> embedding ->
so khớp với embeddings tải từ server -> quyết định check_in/check_out theo
trạng thái gần nhất -> gửi sự kiện về server. Không áp dụng cooldown: mỗi ảnh
đưa vào được coi là 1 lần đi qua cửa.

Chạy (trong thư mục edge, đã có .env):
    .venv/bin/python3 recognize_image.py anh1.jpg anh2.jpg
    .venv/bin/python3 recognize_image.py thu_muc_anh/
    .venv/bin/python3 recognize_image.py --dry-run thu_muc_anh/   # chỉ nhận diện, không gửi
"""
import argparse
import logging
import os
import sys

import cv2

import config
from api_client import ApiClient
from attendance_service import AttendanceDecision
from face_detector import FaceDetector
from face_recognizer import FaceRecognizer, RemoteFaceRecognizer, align_face
from main import load_known_embeddings

logger = logging.getLogger("edge.recognize_image")

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".bmp", ".webp")


def collect_images(paths):
    images = []
    for path in paths:
        if os.path.isdir(path):
            for name in sorted(os.listdir(path)):
                if name.lower().endswith(IMAGE_EXTS):
                    images.append(os.path.join(path, name))
        elif os.path.isfile(path):
            images.append(path)
        else:
            logger.warning("Bỏ qua %s: không tồn tại", path)
    return images


def main():
    parser = argparse.ArgumentParser(description="Nhận diện khuôn mặt từ file ảnh và gửi sự kiện về server.")
    parser.add_argument("paths", nargs="+", help="File ảnh hoặc thư mục chứa ảnh")
    parser.add_argument("--dry-run", action="store_true", help="Chỉ nhận diện, không gửi sự kiện")
    parser.add_argument("--detect-width", type=int, default=640,
                        help="Resize ảnh về chiều rộng này trước khi detect (0 = giữ nguyên)")
    args = parser.parse_args()

    images = collect_images(args.paths)
    if not images:
        logger.error("Không có ảnh nào để xử lý.")
        return 1

    detector = FaceDetector(config.DETECTOR_MODEL_PATH, score_threshold=config.DETECTION_SCORE_THRESHOLD)
    if config.EMBEDDING_BACKEND == "remote":
        recognizer = RemoteFaceRecognizer(config.AI_SERVICE_URL, timeout=config.HTTP_TIMEOUT_SECONDS)
    else:
        recognizer = FaceRecognizer(config.RECOGNIZER_MODEL_PATH)

    api_client = ApiClient(
        config.SERVER_BASE_URL, device_key=config.EDGE_DEVICE_KEY, timeout=config.HTTP_TIMEOUT_SECONDS,
    )
    known_embeddings = load_known_embeddings(api_client)
    if not known_embeddings:
        logger.error(
            "Không có embedding nào từ %s — kiểm tra server đang chạy, EDGE_DEVICE_KEY, "
            "và đã đăng ký khuôn mặt trên trang quản trị chưa.", config.SERVER_BASE_URL,
        )
        return 1
    logger.info("Đã tải %d embeddings người dùng từ server", len(known_embeddings))

    decision = AttendanceDecision(config.SIMILARITY_THRESHOLD, config.ATTENDANCE_COOLDOWN_SECONDS)
    if not args.dry_run:
        decision.seed_last_state(api_client.get_last_state())

    sent_count = 0
    for path in images:
        frame = cv2.imread(path)
        if frame is None:
            print(f"{path}: không đọc được ảnh")
            continue

        faces = detector.detect(frame, detect_width=args.detect_width)
        if len(faces) == 0:
            print(f"{path}: không phát hiện khuôn mặt")
            continue

        for i, face in enumerate(faces, start=1):
            prefix = f"{path} [mặt {i}/{len(faces)}]"
            embedding = recognizer.get_embedding(align_face(frame, face))
            if embedding is None:
                print(f"{prefix}: không trích được embedding")
                continue

            entry, score = decision.best_match(embedding, known_embeddings)
            if score < decision.similarity_threshold:
                print(f"{prefix}: Unknown (gần nhất {entry['user_code']} {score * 100:.1f}% "
                      f"< ngưỡng {decision.similarity_threshold * 100:.0f}%)")
                continue

            user_code = entry["user_code"]
            if args.dry_run:
                print(f"{prefix}: {user_code} - {entry['full_name']} ({score * 100:.1f}%)")
                continue

            event_type = decision.next_event_type(user_code)
            event = decision.build_event(config.DEVICE_ID, user_code, event_type, score)
            if api_client.send_event(event):
                decision.mark_sent(user_code, event_type)
                sent_count += 1
                status = "đã gửi"
            else:
                status = "GỬI THẤT BẠI"
            print(f"{prefix}: {user_code} - {entry['full_name']} ({score * 100:.1f}%) "
                  f"-> {'VÀO' if event_type == 'check_in' else 'RA'} [{status}]")

    if not args.dry_run:
        print(f"Tổng: {sent_count} sự kiện đã gửi về {config.SERVER_BASE_URL}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
