"""Camera -> YuNet -> align -> embedding -> cosine match -> HTTP debug.

`--live-test`: CSI/8080, local CPU inference, enrollment local hoặc GET server; không attendance.
Không có cờ này: giữ chế độ attendance/config hiện có.
"""
import argparse
import logging
import os
import signal
import threading
import time
import unicodedata

import cv2
import numpy as np

import config
from api_client import ApiClient
from attendance_service import AttendanceDecision
from camera import Camera
from face_detector import FaceDetector
from face_recognizer import FaceRecognizer, RemoteFaceRecognizer, align_face
from health import AppState
from local_enrollment import DEFAULT_ENROLLMENT_FILE, load_local_enrollments, pipeline_metadata
from stream_server import build_stream_server

logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("edge.main")
_running = True


def _handle_signal(signum, _frame):
    global _running
    logger.info("Nhận tín hiệu %s; đang dừng và giải phóng camera", signum)
    _running = False


def load_known_embeddings(api_client):
    raw = api_client.get_face_data()
    if raw and config.RECOGNIZER_PROFILE == 'edgeface':
        expected = pipeline_metadata()
        actual = getattr(api_client, 'face_data_pipeline', None)
        keys = ('recognizer_sha256', 'preprocessing', 'embedding_dimension')
        if not isinstance(actual, dict) or any(actual.get(key) != expected[key] for key in keys):
            raise ValueError('Embedding server chưa xác minh cùng EdgeFace/preprocessing; cần tạo lại enrollment server và trả metadata pipeline')
    known = []
    for item in raw:
        try:
            emb = np.array(item["embedding"], dtype=np.float32)
            if emb.shape != (512,) or not np.isfinite(emb).all() or not item.get("user_code"):
                continue
            norm = np.linalg.norm(emb)
            if not np.isfinite(norm) or norm <= 0:
                continue
            emb = emb / norm
            known.append({
                "user_code": item["user_code"],
                "full_name": item.get("full_name") or item["user_code"],
                "embedding": emb,
            })
        except (KeyError, TypeError, ValueError, AttributeError):
            continue
    return known


def infer_faces(frame, detector, recognizer, decision, known_embeddings, api_client,
                attendance_enabled=False):
    annotations = []
    for face in detector.detect(frame, detect_width=config.DETECT_WIDTH):
        x, y, w, h = face[:4].astype(int)
        label, similarity, status, user_code = "Unknown", None, "no_match", None
        # Vẫn chạy embedding thật khi chưa có enrollment để kiểm tra recognition runtime.
        embedding = recognizer.get_embedding(align_face(frame, face))
        if embedding is None:
            status = "embedding_failed"
        elif not known_embeddings:
            status = "no_enrollment"
        else:
            candidate = decision.best_match(embedding, known_embeddings)
            if candidate is not None:
                similarity = candidate[1] * 100
            result = decision.match(embedding, known_embeddings)
            if result is not None:
                entry, score = result
                label, user_code, status = entry["full_name"], entry["user_code"], "matched"
                if attendance_enabled:
                    if decision.should_send(user_code):
                        event_type = decision.next_event_type(user_code)
                        event = decision.build_event(config.DEVICE_ID, user_code, event_type, score)
                        api_client.send_event_async(event)
                        decision.mark_sent(user_code, event_type)
                        status = "sent"
                        label = f"{entry['full_name']} ({'Vào' if event_type == 'check_in' else 'Ra'})"
                    else:
                        status = "cooldown"
        annotations.append({
            "box": [int(x), int(y), int(w), int(h)], "label": label, "user_code": user_code,
            "similarity": similarity, "detection_score": float(face[14]), "status": status,
            "aligned_size": [112, 112],
            "embedding_dimension": int(embedding.size) if embedding is not None else None,
        })
    return annotations


def draw_and_publish(state, frame, faces_annotation, jpeg_quality):
    for f in faces_annotation:
        x, y, w, h = f["box"]
        color = (0, 200, 0) if f["status"] in ("matched", "sent", "cooldown") else (0, 165, 255)
        cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
        score = f"{f['similarity']:.1f}%" if f["similarity"] is not None else "N/A"
        # OpenCV Hershey không hỗ trợ Unicode; tên đầy đủ xuất qua HTML/health.
        label = f["label"] if f["label"].isascii() else (f.get("user_code") or "Unknown")
        label = unicodedata.normalize("NFKD", label).encode("ascii", "ignore").decode("ascii")
        cv2.putText(frame, f"{label} {score} [{f['status']}]", (max(0, x), max(15, y - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
    latency = f"{state.inference_latency_ms:.1f}ms" if state.inference_latency_ms is not None else "N/A"
    cv2.putText(frame, f"Stream {state.fps_estimate:.1f} FPS | AI {latency}", (8, 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2)
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
    if not ok:
        raise RuntimeError("Không encode được JPEG stream")
    state.update_frame(buf.tobytes())


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live-test", action="store_true",
                        help="Test CSI trên 8080, local CPU; không gửi điểm danh/ảnh")
    parser.add_argument("--camera-backend", choices=("rpicam", "v4l2"))
    parser.add_argument("--host", help="Địa chỉ bind HTTP; mặc định lấy STREAM_HOST")
    parser.add_argument("--port", type=int, help="Mặc định live-test=8080, attendance=STREAM_PORT")
    enrollment = parser.add_mutually_exclusive_group()
    enrollment.add_argument("--enrollment-file", help="Kho local cho --live-test; mặc định tự nạp data/enrollments.json nếu có")
    enrollment.add_argument("--server-enrollment", action="store_true", help="--live-test chỉ đọc backend, bỏ qua kho local")
    args = parser.parse_args(argv)
    if not args.live_test and (args.enrollment_file or args.server_enrollment):
        parser.error("Cấu hình enrollment này chỉ dùng với --live-test, không dùng cho attendance")
    args.camera_backend = args.camera_backend or ("rpicam" if args.live_test else config.CAMERA_BACKEND)
    args.host = args.host or config.STREAM_HOST
    args.port = args.port if args.port is not None else (8080 if args.live_test else config.STREAM_PORT)
    if not 1 <= args.port <= 65535:
        parser.error("--port phải trong khoảng 1..65535")
    return args


def main(argv=None):
    global _running
    _running = True
    args = parse_args(argv)
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)
    state = AppState(camera_device=config.CAMERA_DEVICE, test_mode=args.live_test)
    camera = Camera(config.CAMERA_DEVICE, config.CAMERA_WIDTH, config.CAMERA_HEIGHT,
                    config.CAMERA_FPS, config.CAMERA_FOURCC,
                    backend=args.camera_backend, camera_index=config.CAMERA_INDEX)
    api_client = ApiClient(config.SERVER_BASE_URL, device_key=config.EDGE_DEVICE_KEY,
                           timeout=config.HTTP_TIMEOUT_SECONDS)
    server = None
    stream_thread = refresh_thread = None
    api_started = False
    stop_refresh = threading.Event()
    cache = {"entries": []}

    def refresh_embeddings():
        # GET có thể timeout; chạy nền để không chặn capture/inference/video.
        while not stop_refresh.is_set():
            try:
                fresh = load_known_embeddings(api_client)
                state.server_reachable = api_client.server_reachable
                if api_client.server_reachable:
                    cache["entries"] = fresh  # Kể cả cache rỗng hợp lệ: không giữ người đã xóa.
                    state.known_embeddings_count = len(fresh)
                    state.enrollment_status = "ready" if fresh else "empty"
                    logger.info("Đã tải %d embeddings hợp lệ từ backend", len(fresh))
                else:
                    state.enrollment_status = "unavailable"
                    logger.warning("Enrollment chưa tải được; giữ cache RAM gần nhất (%d)", len(cache["entries"]))
            except Exception:
                state.server_reachable = False
                state.enrollment_status = "unavailable"
                logger.exception("Không đọc được dữ liệu enrollment")
            if stop_refresh.wait(max(1, config.FACE_DATA_REFRESH_SECONDS)):
                break

    try:
        server = build_stream_server(state, args.host, args.port)
        stream_thread = threading.Thread(target=server.serve_forever, name="stream-server", daemon=True)
        stream_thread.start()
        detector = FaceDetector(config.DETECTOR_MODEL_PATH, score_threshold=config.DETECTION_SCORE_THRESHOLD)
        # Live test không gửi crop mặt sang remote embedding service.
        if not args.live_test and config.EMBEDDING_BACKEND == "remote":
            recognizer = RemoteFaceRecognizer(config.AI_SERVICE_URL, timeout=config.HTTP_TIMEOUT_SECONDS)
        else:
            recognizer = FaceRecognizer(config.RECOGNIZER_MODEL_PATH)
        state.model_loaded = True
        state.recognizer_model = os.path.basename(config.RECOGNIZER_MODEL_PATH)
        state.recognizer_runtime = recognizer.runtime
        state.recognizer_alignment = 'similarity5' if config.RECOGNIZER_PROFILE == 'edgeface' else 'affine3'
        decision = AttendanceDecision(config.SIMILARITY_THRESHOLD, config.ATTENDANCE_COOLDOWN_SECONDS)
        if not args.live_test:
            api_client.start()
            api_started = True
            decision.seed_last_state(api_client.get_last_state())
        local_file = None
        if args.live_test and not args.server_enrollment:
            local_file = args.enrollment_file or (DEFAULT_ENROLLMENT_FILE if DEFAULT_ENROLLMENT_FILE.exists() else None)
        if local_file is not None:
            cache["entries"] = load_local_enrollments(local_file)
            state.known_embeddings_count = len(cache["entries"])
            state.enrollment_status = "ready" if cache["entries"] else "empty"
            state.enrollment_source = "local"
            logger.info("Đã nạp %d enrollment LOCAL từ %s; không gọi backend", len(cache["entries"]), local_file)
        else:
            refresh_thread = threading.Thread(target=refresh_embeddings, name="enrollment-reader", daemon=True)
            refresh_thread.start()
        logger.info("Mode=%s; backend camera=%s; threshold=%.2f; mỗi %d frame chạy AI",
                    "TEST (NO ATTENDANCE)" if args.live_test else "ATTENDANCE",
                    args.camera_backend, config.SIMILARITY_THRESHOLD, config.PROCESS_EVERY_N_FRAMES)
        if not camera.open():
            logger.error("Chưa có frame camera. HTTP vẫn chạy; sẽ reconnect.")
        state.camera_opened = camera.is_opened
        state.camera_device = camera.device or config.CAMERA_DEVICE
        frame_index = 0
        annotations = []
        window_start = time.monotonic()
        window_frames = window_inferences = 0
        window_captured = camera.frames_captured
        last_metrics_log = window_start

        while _running:
            if not camera.is_opened:
                state.camera_opened = False
                state.faces = annotations = []
                if not camera.reconnect():
                    time.sleep(1)
                    continue
                state.camera_opened = True
                state.camera_device = camera.device
            ok, frame = camera.read()
            if not ok or frame is None:
                state.camera_read_errors += 1
                state.camera_opened = False
                state.faces = annotations = []
                time.sleep(0.2)
                continue
            state.camera_opened = True
            frame_index += 1
            window_frames += 1
            if frame_index == 1 or frame_index % config.PROCESS_EVERY_N_FRAMES == 0:
                started = time.perf_counter()
                try:
                    annotations = infer_faces(frame, detector, recognizer, decision, cache["entries"],
                                              api_client, attendance_enabled=not args.live_test)
                    state.inference_count += 1
                    state.faces_detected_total += len(annotations)
                    state.embeddings_generated_total += sum(
                        f["embedding_dimension"] is not None for f in annotations)
                    state.last_error = None
                    window_inferences += 1
                except Exception as exc:
                    annotations = []
                    state.inference_errors += 1
                    state.last_error = f"Inference lỗi: {exc}"
                    logger.exception("Inference thất bại; tiếp tục video thật")
                state.inference_latency_ms = (time.perf_counter() - started) * 1000
                state._last_inference = time.monotonic()
                state.faces = annotations
            # Giữ box ngắn giữa frame bỏ qua AI; không coi đó là tracking.
            visible = annotations if time.monotonic() - state._last_inference <= 1 else []
            draw_and_publish(state, frame, visible, config.JPEG_QUALITY)
            now = time.monotonic()
            elapsed = now - window_start
            if elapsed >= 2:
                state.fps_estimate = window_frames / elapsed
                state.inference_fps = window_inferences / elapsed
                state.capture_fps = (camera.frames_captured - window_captured) / elapsed
                window_start, window_captured = now, camera.frames_captured
                window_frames = window_inferences = 0
            if now - last_metrics_log >= 10:
                logger.info("Camera=%s capture=%.1f stream=%.1f AI=%.1fHz latency=%.1fms faces=%d errors=%d/%d",
                            state.camera_device, state.capture_fps, state.fps_estimate, state.inference_fps,
                            state.inference_latency_ms, len(visible), state.camera_read_errors, state.inference_errors)
                last_metrics_log = now
    finally:
        # Cả lỗi load model, lỗi inference, SIGINT/SIGTERM đều đi qua đây.
        stop_refresh.set()
        state.camera_opened = False
        state.stop()
        try:
            camera.release()
        finally:
            if api_started:
                api_client.stop()
            if refresh_thread is not None:
                refresh_thread.join(timeout=1)
            if server is not None:
                if stream_thread is not None and stream_thread.is_alive():
                    server.shutdown()
                    stream_thread.join(timeout=2)
                server.server_close()
        logger.info("Đã dừng: camera và HTTP đã giải phóng.")


if __name__ == "__main__":
    main()
