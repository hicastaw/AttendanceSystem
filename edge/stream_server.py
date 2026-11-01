"""Luồng camera debug qua HTTP (MJPEG), chỉ dùng để xem trực quan trong lúc
demo/PoC — KHÔNG dùng cv2.imshow() (headless, đúng yêu cầu Orange Pi).

Chạy Flask dev server 1 tiến trình, không debug/reloader, không nhiều
worker — đủ cho 1 người xem tại 1 thời điểm trong buổi demo.
"""
import logging
import time

from flask import Flask, Response, jsonify

logger = logging.getLogger(__name__)

_INDEX_HTML = """<!doctype html>
<html><head><meta charset="utf-8"><title>Face Attendance Edge - Debug Stream</title></head>
<body style="margin:0;background:#111;color:#eee;font-family:sans-serif">
  <div style="padding:8px 12px">Face Attendance Edge &mdash; debug stream</div>
  <img src="/video_feed" style="width:100%;height:auto;display:block" />
</body></html>
"""


def create_app(state):
    app = Flask(__name__)
    app.logger.setLevel(logging.WARNING)  # bớt log truy cập để đỡ tốn CPU/IO

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
            while True:
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


def run_stream_server(state, host="0.0.0.0", port=5000):
    app = create_app(state)
    logger.info("Debug stream server: http://%s:%d/  (video_feed, health)", host, port)
    app.run(host=host, port=port, debug=False, use_reloader=False, threaded=True)
