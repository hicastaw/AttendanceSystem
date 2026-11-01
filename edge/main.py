"""Orchestrator chính của tiến trình edge trên Orange Pi PC.

Vòng lặp: đọc camera -> (mỗi N frame) phát hiện khuôn mặt -> align -> trích
embedding -> so khớp cục bộ với cache embeddings -> quyết định check_in/check_out
bằng toggle cục bộ + cooldown -> gửi sự kiện (async, không block) -> vẽ overlay
lên frame cho debug stream.

Không còn khái niệm phiên điểm danh: chỉ cần tải danh sách embeddings 1 lần lúc
khởi động (rồi làm mới định kỳ) và mồi trạng thái ra/vào gần nhất từ server.

Chạy: python3 main.py  (xem scripts/run_edge.sh)
Dừng: SIGTERM/SIGINT -> giải phóng camera, dừng thread gửi API, thoát sạch.
"""
import logging
import signal
import threading
import time

import cv2
import numpy as np

import config
from api_client import ApiClient
from attendance_service import AttendanceDecision
from camera import Camera
from face_detector import FaceDetector
from face_recognizer import FaceRecognizer, RemoteFaceRecognizer, align_face
from health import AppState
from stream_server import run_stream_server

logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("edge.main")

_running = True


def _handle_signal(signum, _frame):
    global _running
    logger.info("Nhận tín hiệu dừng (%s), sẽ thoát vòng lặp và giải phóng camera...", signum)
    _running = False


def load_known_embeddings(api_client):
    raw = api_client.get_face_data()
    known = []
    for item in raw:
        try:
            emb = np.array(item["embedding"], dtype=np.float32)
        except (KeyError, TypeError, ValueError):
            continue
        norm = np.linalg.norm(emb)
        if norm > 0:
            emb = emb / norm
        known.append({
            "user_code": item.get("user_code"),
            "full_name": item.get("full_name") or item.get("user_code"),
            "embedding": emb,
        })
    return known


def draw_and_publish(state, frame, faces_annotation, jpeg_quality):
    for f in faces_annotation:
        x, y, w, h = f["box"]
        color = (0, 200, 0) if f["status"] in ("matched", "sent") else (0, 165, 255)
        cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
        text = f"{f['label']} {f['similarity']:.0f}% [{f['status']}]"
        cv2.putText(frame, text, (x, max(0, y - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

    cv2.putText(frame, f"FPS ~{state.fps_estimate:.1f}", (8, 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
    if ok:
        state.update_frame(buf.tobytes())


def main():
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    state = AppState(camera_device=config.CAMERA_DEVICE)

    camera = Camera(
        config.CAMERA_DEVICE, config.CAMERA_WIDTH, config.CAMERA_HEIGHT,
        config.CAMERA_FPS, config.CAMERA_FOURCC,
    )
    if not camera.open():
        logger.error(
            "Không mở được camera nào lúc khởi động — vẫn chạy health/stream server "
            "để debug, vòng lặp chính sẽ tiếp tục thử reconnect."
        )
    state.camera_opened = camera.is_opened
    state.camera_device = camera.device or config.CAMERA_DEVICE

    detector = FaceDetector(config.DETECTOR_MODEL_PATH, score_threshold=config.DETECTION_SCORE_THRESHOLD)

    if config.EMBEDDING_BACKEND == "remote":
        recognizer = RemoteFaceRecognizer(config.AI_SERVICE_URL, timeout=config.HTTP_TIMEOUT_SECONDS)
    else:
        recognizer = FaceRecognizer(config.RECOGNIZER_MODEL_PATH)
    state.model_loaded = True

    api_client = ApiClient(
        config.SERVER_BASE_URL, device_key=config.EDGE_DEVICE_KEY, timeout=config.HTTP_TIMEOUT_SECONDS,
    )
    api_client.start()

    decision = AttendanceDecision(config.SIMILARITY_THRESHOLD, config.ATTENDANCE_COOLDOWN_SECONDS)
    # Mồi trạng thái ra/vào gần nhất — nếu server chưa sẵn sàng lúc này cũng không
    # sao, chỉ là edge sẽ mặc định coi mọi người là "chưa vào" cho tới khi tự học
    # lại qua các lần nhận diện tiếp theo.
    decision.seed_last_state(api_client.get_last_state())

    stream_thread = threading.Thread(
        target=run_stream_server, args=(state, config.STREAM_HOST, config.STREAM_PORT),
        daemon=True, name="stream-server",
    )
    stream_thread.start()

    known_embeddings = load_known_embeddings(api_client)
    logger.info("Đã tải %d embeddings người dùng lúc khởi động", len(known_embeddings))
    last_face_data_refresh = time.monotonic()

    frame_index = 0
    fps_window_start = time.time()
    fps_window_count = 0
    last_recognition_log = 0.0

    logger.info(
        "Bắt đầu vòng lặp camera (device=%s, backend nhận diện=%s). Ctrl+C hoặc SIGTERM để dừng.",
        state.camera_device, config.EMBEDDING_BACKEND,
    )

    while _running:
        now = time.monotonic()

        # --- Làm mới cache embeddings định kỳ (vd có người mới đăng ký khuôn mặt) ---
        if now - last_face_data_refresh >= config.FACE_DATA_REFRESH_SECONDS:
            fresh = load_known_embeddings(api_client)
            state.server_reachable = api_client.server_reachable
            if fresh:
                known_embeddings = fresh
                logger.info("Đã làm mới %d embeddings người dùng", len(known_embeddings))
            last_face_data_refresh = now

        # --- Camera ---
        if not camera.is_opened:
            if not camera.reconnect():
                state.camera_opened = False
                time.sleep(2)
                continue
            state.camera_opened = True
            state.camera_device = camera.device

        ok, frame = camera.read()
        if not ok or frame is None:
            state.camera_opened = camera.is_opened
            time.sleep(0.2)
            continue

        frame_index += 1
        fps_window_count += 1
        if time.time() - fps_window_start >= 2.0:
            state.fps_estimate = fps_window_count / (time.time() - fps_window_start)
            fps_window_count = 0
            fps_window_start = time.time()

        faces_annotation = []

        if frame_index % config.PROCESS_EVERY_N_FRAMES == 0:
            faces = detector.detect(frame, detect_width=config.DETECT_WIDTH)
            for face in faces:
                x, y, w, h = face[:4].astype(int)
                label, similarity, att_status = "Unknown", 0.0, "no_match"

                if known_embeddings:
                    aligned = align_face(frame, face)
                    embedding = recognizer.get_embedding(aligned)
                    if embedding is not None:
                        candidate = decision.best_match(embedding, known_embeddings)
                        if candidate is not None:
                            entry, score = candidate
                            similarity = score
                            if now - last_recognition_log >= 5:
                                logger.info(
                                    "Nhận diện gần nhất: %s, similarity=%.1f%% (ngưỡng %.1f%%)",
                                    entry["user_code"], score * 100,
                                    decision.similarity_threshold * 100,
                                )
                                last_recognition_log = now

                        result = decision.match(embedding, known_embeddings)
                        if result is not None:
                            entry, score = result
                            label, similarity, att_status = entry["full_name"], score, "matched"
                            user_code = entry["user_code"]
                            if decision.should_send(user_code):
                                event_type = decision.next_event_type(user_code)
                                event = decision.build_event(
                                    config.DEVICE_ID, user_code, event_type, score,
                                )
                                api_client.send_event_async(event)
                                decision.mark_sent(user_code, event_type)
                                att_status = "sent"
                                label = f"{entry['full_name']} ({'Vào' if event_type == 'check_in' else 'Ra'})"
                            else:
                                att_status = "cooldown"

                faces_annotation.append({
                    "box": [int(x), int(y), int(w), int(h)],
                    "label": label,
                    "similarity": similarity * 100,
                    "status": att_status,
                })

        draw_and_publish(state, frame, faces_annotation, config.JPEG_QUALITY)

    logger.info("Đang dừng: giải phóng camera và dừng thread gửi API...")
    camera.release()
    api_client.stop()
    logger.info("Đã dừng sạch.")


if __name__ == "__main__":
    main()
