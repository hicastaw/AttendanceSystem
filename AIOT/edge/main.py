"""Single-camera orchestrator for AIOT Kiosk (verified legacy CPU provider).

Vòng lặp: đọc camera -> (mỗi N frame) phát hiện khuôn mặt -> align -> trích
embedding -> so khớp cục bộ với cache embeddings -> quyết định check-in-only
bằng check-in-only theo sự kiện (ngoài sự kiện vẫn ghi) -> persist outbox -> gửi HTTP async -> vẽ overlay
lên frame cho debug stream.

Không còn khái niệm phiên điểm danh: chỉ cần tải danh sách embeddings 1 lần lúc
khởi động (rồi làm mới định kỳ) và đồng bộ lịch/điểm danh từ server.
Local confirmed state/pending reservation tồn tại qua restart. SQLite commit
vẫn là local I/O đồng bộ; không chạy đoạn enqueue này trong callback GStreamer.

Chạy: python3 edge/main.py  (xem scripts/run_edge.sh)
Dừng: SIGTERM/SIGINT -> giải phóng camera, dừng thread gửi API, thoát sạch.
Transient I/O/SDK calls have finite recovery budgets. No Hailo/mock fallback;
SCRFD/R50 production remains gated on verified artifacts and enrollment migration.
"""
import logging
from contextlib import ExitStack
import signal
import sqlite3
import time

import cv2

import config
from api_client import ApiClient
from attendance_service import AttendanceDecision
from camera import create_camera
from face_detector import FaceDetector
from face_recognizer import FaceRecognizer, RemoteFaceRecognizer, align_face
from health import AppState
from member_gallery import MemberGallery
from stream_server import StreamServer
from model_contract import LEGACY_CONTRACT, validate_backend
from pipeline import Consensus, normalize, recognition_confirmed
from worker_status import WorkerStatus
from recovery import Recovery, RecoveryExhausted, WorkerStopping
from service_watchdog import notify
from capture_session import SampleRejected

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


def load_known_embeddings(api_client, gallery):
    gallery.refresh(api_client)
    return gallery.entries  # [] is an authoritative result, not a truthiness guard.


def initialize_member_gallery(api_client, config):
    # Current recognizers/enrollment still use w600k_mbf; an R50 provider must
    # pass its own contract and re-enroll members, not relabel this legacy cache.
    gallery = MemberGallery(config.MEMBER_GALLERY_CACHE_PATH, source=api_client.base_url,
                            max_age_seconds=config.GALLERY_CACHE_MAX_AGE_SECONDS)
    gallery.restore()
    load_known_embeddings(api_client, gallery)
    return gallery


def draw_and_publish(state, frame, faces_annotation, jpeg_quality):
    for f in faces_annotation:
        x, y, w, h = f["box"]
        color = (0, 200, 0) if f["status"] in ("matched", "confirmed") else (0, 165, 255)
        cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
        text = f"{f['label']} {f['similarity']:.0f}% [{f['status']}]"
        cv2.putText(frame, text, (x, max(0, y - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

    cv2.putText(frame, f"FPS ~{state.fps_estimate:.1f}", (8, 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
    if ok:
        state.update_frame(buf.tobytes())


def _cleanup(name, action):
    """Attempt every owned cleanup without masking the startup/loop exception."""
    try:
        if action() is False:
            logger.warning("Cleanup incomplete for %s; durable pending events remain on disk", name)
    except Exception:
        logger.exception("Cleanup failed for %s; continuing remaining cleanup", name)


def _read_camera(camera):
    if not camera.is_opened and not camera.reconnect():
        raise OSError('Camera unavailable')
    ok, frame = camera.read()
    if not ok or frame is None:
        if getattr(camera,'browser_source',False) is True and getattr(camera,'waiting_for_frame',False) is True:
            return None  # No fresh browser frame is an idle input, not a driver fault.
        camera.release()
        raise OSError('Camera frame unavailable')
    return frame


def _get_embedding(recognizer, aligned):
    value = recognizer.get_embedding(aligned)
    if value is None:
        raise OSError('Embedding provider unavailable')
    normalize(value)  # Fail closed on malformed model output; no contract substitution.
    return value


def main(*, cpu_test=None):
    config.validate_runtime()
    validate_backend(config.EMBEDDING_BACKEND)
    if cpu_test is not None:
        from cpu_test_runtime import CPUWorkerAdapter
        if type(cpu_test) is not CPUWorkerAdapter:
            raise ValueError('Explicit isolated CPU adapter required')
        cpu_test.validate(config)  # Before publisher, camera, outbox or gallery I/O.
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    resources = ExitStack()
    state = None
    try:
        state = AppState(camera_device=config.CAMERA_DEVICE)
        active_contract = cpu_test.contract if cpu_test else LEGACY_CONTRACT
        if cpu_test:
            from capture_session import CaptureSession
            state.capture = CaptureSession(contract=active_contract,deadline_seconds=cpu_test.capture_deadline_seconds,
                                           max_sample_gap_seconds=cpu_test.capture_max_sample_gap_seconds,allow_single_image=True)
            from enrollment_image import process_uploaded, embed_face, preview_jpeg
            state.cpu_test_diagnostics = cpu_test.diagnostics
        publisher=WorkerStatus(config.SERVER_BASE_URL,config.EDGE_DEVICE_KEY,active_contract,health=state.to_health_dict)
        resources.callback(_cleanup, 'publisher', publisher.stop)
        publisher.start()
        consensus=Consensus()
        # The named laptop demo accepts one independently thresholded match;
        # unlike the live path, it has no temporal vote requirement.
        single_frame_recognition=bool(cpu_test and cpu_test.run.get('purpose')=='isolated-r50-laptop-test')
        def failed(component):
            consensus.reset()
            state.failed(component)
            publisher.update({'camera':'camera_unavailable','model':'model_unavailable',
                              'storage':'storage_error'}[component],
                             camera_ok=state.camera_opened,model_ok=state.model_loaded)
        recovery=Recovery(running=lambda:_running, failure=failed,
                          success=lambda component:setattr(state,'storage_ok',True) if component=='storage' else None)

        camera = cpu_test.camera_factory() if cpu_test else create_camera(
            config.CAMERA_BACKEND, config.CAMERA_DEVICE, config.CAMERA_WIDTH, config.CAMERA_HEIGHT,
            config.CAMERA_FPS, config.CAMERA_FOURCC,
        )
        resources.callback(_cleanup, 'camera', camera.release)
        if not camera.open():
            logger.error("Không mở được camera lúc khởi động (%s) — vẫn chạy health/stream server để debug; "
                         "kiểm tra quyền camera, đóng ứng dụng đang giữ webcam và thử đúng camera index.",
                         getattr(camera,'last_error',None) or config.CAMERA_DEVICE)
        state.camera_opened = camera.is_opened
        state.camera_device = camera.device or config.CAMERA_DEVICE

        try:
            detector = cpu_test if cpu_test else recovery.call('model',lambda:FaceDetector(config.DETECTOR_MODEL_PATH, score_threshold=config.DETECTION_SCORE_THRESHOLD))

            if cpu_test:
                recognizer = cpu_test
            elif config.EMBEDDING_BACKEND == "remote":
                recognizer = RemoteFaceRecognizer(config.AI_SERVICE_URL, timeout=config.HTTP_TIMEOUT_SECONDS)
            else:
                recognizer = recovery.call('model',lambda:FaceRecognizer(config.RECOGNIZER_MODEL_PATH))
        except Exception:
            publisher.update('model_unavailable',camera_ok=camera.is_opened,model_ok=False)
            publisher.publish()
            raise
        state.model_loaded = True

        api_client = ApiClient(
            config.SERVER_BASE_URL, device_key=config.EDGE_DEVICE_KEY, timeout=config.HTTP_TIMEOUT_SECONDS,
            outbox_path=config.EDGE_OUTBOX_PATH,
            retry_base_seconds=config.OUTBOX_RETRY_BASE_SECONDS,
            retry_max_seconds=config.OUTBOX_RETRY_MAX_SECONDS,
        )
        resources.callback(_cleanup, 'sender', api_client.stop)
        decision = AttendanceDecision(config.SIMILARITY_THRESHOLD, config.ATTENDANCE_COOLDOWN_SECONDS,
                                      outbox=api_client.outbox,minimum_margin=cpu_test.margin if cpu_test else 0.05)
        # No dateless last-state toggle. Schedule + confirmed occurrences survive restart.
        try:
            api_client.sync_attendance_policy(decision)
        except (sqlite3.Error, OSError):
            logger.exception("Attendance snapshot storage failed; using local calendar")
        last_policy_day = decision.current_day()
        last_policy_sync = time.monotonic()
        api_client.start()  # Replay existing pending records without camera callbacks.

        gallery = cpu_test.initialize_gallery(api_client, config) if cpu_test else initialize_member_gallery(api_client, config)
        known_embeddings = gallery.entries
        state.gallery_status = gallery.status()
        state.server_reachable = api_client.server_reachable
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

        stream = StreamServer(state, config.STREAM_HOST, config.STREAM_PORT,device_key=config.EDGE_DEVICE_KEY)
        resources.callback(_cleanup, 'debug stream', stream.stop)
        stream.start()
        if cpu_test:
            import json
            cpu_test.publish_port(stream.server.server_port)
            print(json.dumps(dict(type='cpu-worker-listening', port=stream.server.server_port)), flush=True)
        notify('READY=1')

        while _running:
            notify('WATCHDOG=1')  # Only the camera-owner loop can show forward progress.
            now = time.monotonic()
            state.storage_ok = api_client.storage_ok
            if not api_client.storage_ok:
                failed('storage')
            if api_client.fatal_error:
                publisher.publish()
                raise RuntimeError('Durable sender stopped after bounded storage recovery')
            gallery.expire()
            known_embeddings = gallery.entries
            state.gallery_status = gallery.status()

            if decision.current_day() != last_policy_day or now - last_policy_sync >= 60:
                last_policy_day, last_policy_sync = decision.current_day(), now
                try:
                    api_client.sync_attendance_policy(decision)
                except (sqlite3.Error, OSError):
                    logger.exception("Attendance snapshot storage failed; using local calendar")

            # --- Làm mới cache embeddings định kỳ (vd có người mới đăng ký khuôn mặt) ---
            if now - last_face_data_refresh >= config.FACE_DATA_REFRESH_SECONDS:
                known_embeddings = load_known_embeddings(api_client, gallery)
                state.server_reachable = api_client.server_reachable
                state.gallery_status = gallery.status()
                logger.info("Gallery: %d thành viên, source=%s", len(known_embeddings), gallery.origin)
                last_face_data_refresh = now

            # Uploads run in this same model/camera-owner thread, never through
            # attendance. They do not require or refresh a live-camera timestamp.
            if cpu_test and process_uploaded(state.capture, cpu_test):
                consensus.reset()
                publisher.update('enrollment')
                continue
            detector_session = None
            if cpu_test:
                with state.capture.lock:
                    if state.capture.value:detector_session=state.capture.value['session_id']
            # Only this thread touches camera/SDKs; bounded I/O retries reset votes.
            frame = recovery.call('camera',lambda:_read_camera(camera))
            if frame is None or getattr(camera,'source_changed',False) is True:
                consensus.reset()
                if getattr(camera,'browser_source',False) is True:
                    with state.capture.lock:
                        if state.capture.value and state.capture.value.get('source','camera')=='camera':
                            state.capture.cancel(state.capture.value['session_id'])
                    camera.source_changed=False
            if frame is None:
                failed('camera');time.sleep(.05);continue
            state.camera_opened = camera.is_opened
            state.camera_device = camera.device
            state.captured()

            frame_index += 1
            fps_window_count += 1
            if time.time() - fps_window_start >= 2.0:
                state.fps_estimate = fps_window_count / (time.time() - fps_window_start)
                fps_window_count = 0
                fps_window_start = time.time()

            faces_annotation = []

            if frame_index % config.PROCESS_EVERY_N_FRAMES == 0:
                faces = recovery.call('model',lambda:detector.detect(frame, detect_width=config.DETECT_WIDTH))
                if not state.frame_fresh():
                    if cpu_test:state.capture.reject_stale_frame(detector_session)
                    consensus.reset();state.failed('camera');continue
                state.inferred()
                def capture_embed(face):
                    if cpu_test:
                        return embed_face(frame,face,cpu_test.align,
                                          lambda aligned:recovery.call('model',lambda:_get_embedding(recognizer,aligned)),
                                          fresh=state.frame_fresh)
                    aligned=recovery.call('model',lambda:cpu_test.align(frame,face) if cpu_test else align_face(frame,face))
                    # Same enrollment sharpness gate as the current CPU service.
                    if cv2.Laplacian(cv2.cvtColor(aligned,cv2.COLOR_BGR2GRAY),cv2.CV_64F).var()<100:
                        raise SampleRejected('Blurry crop')
                    value=recovery.call('model',lambda:_get_embedding(recognizer,aligned))
                    if not state.frame_fresh():raise SampleRejected('stale_frame')
                    return value
                capture_options = dict(session_id=detector_session,
                                       preview=preview_jpeg(frame) if detector_session else None) if cpu_test else {}
                if state.capture.observe(faces,capture_embed,**capture_options):
                    consensus.reset()
                    publisher.update('enrollment')
                    draw_and_publish(state,frame,[],config.JPEG_QUALITY)
                    continue
                publisher.update('evaluating' if len(faces) else 'idle', clear_event=len(faces)!=1)
                # Without a verified tracker, multiple faces are ambiguous. Do not
                # aggregate votes from different people into a synthetic single track.
                if len(faces)!=1:
                    consensus.reset()
                    faces=[]
                for face in faces:
                    x, y, w, h = face[:4].astype(int)
                    label, similarity, att_status = "Unknown", 0.0, "no_match"

                    if known_embeddings:
                        aligned = recovery.call('model',lambda:cpu_test.align(frame,face) if cpu_test else align_face(frame, face))
                        embedding = recovery.call('model',lambda:_get_embedding(recognizer,aligned))
                        if not state.frame_fresh():
                            consensus.reset();state.failed('camera');break
                        state.inferred()
                        if gallery.valid_query(embedding):
                            candidate = decision.best_match(embedding, known_embeddings)
                            if candidate is not None:
                                entry, score = candidate
                                similarity = score
                                if now - last_recognition_log >= 5:
                                    logger.info(
                                        "Candidate evaluated; similarity=%.1f%% (ngưỡng %.1f%%)",
                                        score * 100,
                                        decision.similarity_threshold * 100,
                                    )
                                    last_recognition_log = now

                            result = decision.match(embedding, known_embeddings)
                            if recognition_confirmed(result,consensus,version=gallery.version,
                                                     single_frame=single_frame_recognition):
                                entry, score = result
                                label, similarity, att_status = entry["full_name"], score, "matched"
                                user_code = entry["user_code"]
                                if decision.should_send(user_code):
                                    event = decision.build_checkin_event(config.DEVICE_ID, user_code, score)
                                    context = decision.context_for(event["timestamp"])
                                    try:
                                        result = recovery.call('storage',lambda:api_client.send_event_async(event, attendance_key=context["occurrence_key"] or "__outside__"))
                                        state.storage_ok = True
                                        att_status = "confirmed" if result in ("already_acked", "already_attended") else "pending"
                                        label = f"{entry['full_name']} (Check-in)"
                                    except (sqlite3.Error, OSError, ValueError):
                                        att_status = "storage_error"
                                        logger.exception("Cannot persist event; not sent or confirmed")
                                else:
                                    att_status = decision.delivery_status(user_code)
                                row=recovery.call('storage',lambda:api_client.outbox.latest_for(user_code,decision.current_key()))
                                publisher.update('storage_error' if att_status in ('storage_error','blocked') else 'pending',
                                                 event_id=row['event_id'] if row else api_client.outbox.confirmed_event_id(user_code,decision.current_key()))
                            elif result is None:
                                publisher.update('unknown')
                        else:
                            consensus.reset();publisher.update('model_unavailable',model_ok=False)
                    else:
                        publisher.update('unknown')

                    faces_annotation.append({
                        "box": [int(x), int(y), int(w), int(h)],
                        "label": label,
                        "similarity": similarity * 100,
                        "status": att_status,
                    })

            recovery.call('model',lambda:draw_and_publish(state, frame, faces_annotation, config.JPEG_QUALITY))

    except WorkerStopping:
        logger.info('Stop requested during recovery')
    except RecoveryExhausted:
        _cleanup('final fault status',publisher.publish)
        raise
    finally:
        if state is not None:state.failed('camera')
        logger.info("Đang dừng: giải phóng camera và dừng thread gửi API...")
        resources.close()


if __name__ == "__main__":
    main()
