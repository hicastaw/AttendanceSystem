"""Luồng camera debug qua HTTP (MJPEG), chỉ dùng để xem trực quan trong lúc
demo/PoC — KHÔNG dùng cv2.imshow() (headless, đúng yêu cầu Orange Pi).

Chạy Flask dev server 1 tiến trình, không debug/reloader, không nhiều
worker — đủ cho 1 người xem tại 1 thời điểm trong buổi demo.
"""
import logging
import threading
import time
import hmac
import io
import json

logger = logging.getLogger(__name__)

_INDEX_HTML = """<!doctype html>
<html><head><meta charset="utf-8"><title>Face Attendance Edge - Debug Stream</title></head>
<body style="margin:0;background:#111;color:#eee;font-family:sans-serif">
  <div style="padding:8px 12px">Face Attendance Edge &mdash; debug stream</div>
  <img src="/video_feed" style="width:100%;height:auto;display:block" />
</body></html>
"""


def create_app(state, stop_event=None, device_key=None):
    from flask import Flask, Request, Response, jsonify, request
    from werkzeug.exceptions import RequestEntityTooLarge

    app = Flask(__name__)
    app.logger.setLevel(logging.WARNING)  # bớt log truy cập để đỡ tốn CPU/IO
    single_image = getattr(state.capture, 'allow_single_image', False)
    app.config['MAX_CONTENT_LENGTH']=(5 * 1024 * 1024 + 65536) if single_image else 4096
    app.config['MAX_FORM_MEMORY_SIZE']=256 * 1024
    app.config['MAX_FORM_PARTS']=4

    class MemoryUploadRequest(Request):
        def _get_file_stream(self, total_content_length, content_type, filename=None, content_length=None):
            return io.BytesIO()  # Werkzeug's default spooled stream can write biometric bytes to disk.
    if single_image:app.request_class=MemoryUploadRequest

    @app.errorhandler(RequestEntityTooLarge)
    def too_large(_error):
        return jsonify(error='Image/request exceeds enrollment limit', code='image_too_large'),413

    @app.before_request
    def authorize():
        # None preserves the standalone local debug/test API, but never enables enrollment.
        if request.path=='/health':
            return None
        if device_key is not None or request.path.startswith(('/capture-sessions','/preview','/cpu-test-diagnostics')):
            if not device_key or len(device_key)<24 or device_key.startswith('change-me'):
                return jsonify(error='Worker capture credentials not configured'),503
            if not hmac.compare_digest(request.headers.get('X-Device-Key','').encode(),device_key.encode()):
                return jsonify(error='Unauthorized'),401

    @app.after_request
    def private(response):
        response.headers['Cache-Control']='no-store'
        response.headers['X-Content-Type-Options']='nosniff'
        return response

    @app.get('/preview.jpg')
    def preview():
        frame=state.get_frame()
        return Response(frame,mimetype='image/jpeg') if frame else (jsonify(error='Fresh preview unavailable'),503)

    @app.get('/cpu-test-diagnostics')
    def cpu_test_diagnostics():
        diagnostics=getattr(state,'cpu_test_diagnostics',None)
        if diagnostics is None:return jsonify(error='Not an isolated CPU runtime'),404
        return jsonify(diagnostics())  # Auth above; no images, identities or vectors.

    @app.post('/capture-sessions')
    def start_capture():
        if request.mimetype=='multipart/form-data':
            if not single_image:return jsonify(error='Upload not enabled for this contract',code='incompatible_model'),409
            from enrollment_image import decode_upload, ImageRejected, MAX_IMAGE_BYTES
            session_id=None
            accepted=False
            try:
                if set(request.form) != {'user_code','embedding_contract'} or any(len(v)>4096 for v in request.form.values()):
                    return jsonify(error='Invalid enrollment metadata',code='invalid_capture_request'),400
                if set(request.files) != {'face_image'} or len(request.files.getlist('face_image')) != 1:
                    return jsonify(error='Exactly one face_image required',code='invalid_image'),400
                contract=json.loads(request.form['embedding_contract'])
                value=state.capture.start(request.form['user_code'],contract,1,source='upload')
                session_id=value['session_id']
                file=request.files['face_image']
                try:
                    image=decode_upload(file.read(MAX_IMAGE_BYTES+1),file.mimetype)
                finally:file.close()
                state.capture.attach_upload(session_id,image)
                accepted=True
                return jsonify(value),201
            except ImageRejected as error:
                return jsonify(error='Image rejected',code=error.code),error.status
            except (ValueError,TypeError):
                return jsonify(error='Invalid capture identity/contract',code='invalid_capture_request'),400
            except FileExistsError:return jsonify(error='Capture busy',code='capture_busy'),409
            except FileNotFoundError:return jsonify(error='Capture expired or unavailable',code='capture_not_found'),404
            finally:
                # If validation never attached an image, release only our own reservation.
                if session_id and not accepted:
                    with state.capture.lock:
                        current=state.capture.value
                        if current and current['session_id']==session_id:
                            try:state.capture.cancel(session_id)
                            except FileNotFoundError:pass
        if not request.is_json:return jsonify(error='Expected JSON or multipart image',code='unsupported_format'),415
        if request.content_length and request.content_length>4096:
            return jsonify(error='Capture metadata too large',code='invalid_capture_request'),413
        body=request.get_json(silent=True) or {}
        if not isinstance(body,dict):return jsonify(error='Invalid capture request'),400
        if body.get('source','camera')!='camera':return jsonify(error='Upload requires an image file',code='invalid_image'),400
        try:
            return jsonify(state.capture.start(body.get('user_code'),body.get('embedding_contract'),body.get('frames',5))),201
        except ValueError:return jsonify(error='Invalid capture request',code='invalid_capture_request'),400
        except FileExistsError:return jsonify(error='Capture busy',code='capture_busy'),409

    @app.get('/capture-sessions/<session_id>/preview')
    def capture_preview(session_id):
        try:return Response(state.capture.preview(session_id),mimetype='image/jpeg')
        except FileNotFoundError:return jsonify(error='Capture expired or unavailable',code='capture_not_found'),404
        except BlockingIOError:return jsonify(error='Validated image not ready',code='preview_not_ready'),503

    @app.route('/capture-sessions/<session_id>',methods=['GET','DELETE'])
    def capture_result(session_id):
        try:
            if request.method=='DELETE':
                state.capture.cancel(session_id)
                return jsonify(status='cancelled')
            return jsonify(state.capture.status(session_id,result=True))
        except FileNotFoundError:return jsonify(error='Capture expired or unavailable'),404

    @app.get("/")
    def index():
        return _INDEX_HTML

    @app.get("/health")
    def health():
        return jsonify(state.to_health_dict())

    @app.get("/video_feed")
    def video_feed():
        def generate():
            boundary = b"--frame\r\n"
            while stop_event is None or not stop_event.is_set():
                frame = state.get_frame()
                if frame is not None:
                    yield (
                        boundary
                        + b"Content-Type: image/jpeg\r\n"
                        + f"Content-Length: {len(frame)}\r\n\r\n".encode("ascii")
                        + frame
                        + b"\r\n"
                    )
                time.sleep(0.1)  # ~10 fps debug, đủ dùng, tránh ngốn CPU/RAM

        return Response(generate(), mimetype="multipart/x-mixed-replace; boundary=frame")

    return app


class StreamServer:
    """Owned debug HTTP server; bind errors reach main and shutdown releases its port."""

    def __init__(self, state, host="127.0.0.1", port=5000, *, factory=None, device_key=None):
        self.state, self.host, self.port = state, host, port
        self.factory = factory
        self.device_key = device_key
        self.stop_event = threading.Event()
        self.server = None
        self.thread = None

    def start(self):
        if self.factory is None:
            from werkzeug.serving import make_server
            self.server = make_server(self.host, self.port,
                                      create_app(self.state, self.stop_event, self.device_key), threaded=True)
        else:
            self.server = self.factory()
        self.thread = threading.Thread(target=self.server.serve_forever,
                                       daemon=True, name="stream-server")
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        try:
            if self.thread is not None and self.thread.is_alive():
                self.server.shutdown()
                self.thread.join(timeout=3)
        finally:
            if self.server is not None:
                self.server.server_close()
        return self.thread is None or not self.thread.is_alive()


def run_stream_server(state, host="127.0.0.1", port=5000):
    """Compatibility blocking entrypoint; main owns StreamServer directly."""
    server = StreamServer(state, host, port)
    try:
        server.start()
        server.thread.join()
    finally:
        server.stop()
