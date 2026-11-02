"""HTTP MJPEG dùng frame từ main; không mở camera hoặc chạy inference lần nữa."""
import logging

from flask import Flask, Response, jsonify
from werkzeug.serving import make_server

logger = logging.getLogger(__name__)

_INDEX_HTML = """<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Edge AI — Live camera test</title>
<style>body{margin:20px;background:#15171b;color:#eee;font:16px system-ui}img{width:100%;max-width:960px}
pre{white-space:pre-wrap}td,th{padding:6px 12px;text-align:left}#warning{color:#ffd479}</style></head>
<body><h1>Edge AI — Live camera test</h1><p id="mode">Đang kết nối…</p>
<p id="metrics"></p><p id="warning"></p><img src="/video_feed" alt="Đang chờ camera">
<p>Kết quả lần suy luận gần nhất (box giữ tối đa 1 giây giữa các lần AI):</p>
<table><thead><tr><th>Danh tính</th><th>Cosine similarity</th><th>Detection score</th><th>Alignment / embedding</th><th>Trạng thái</th></tr></thead>
<tbody id="faces"></tbody></table><pre id="error"></pre>
<p><a href="/health">Health JSON</a> · Ảnh và kết quả live chỉ giữ trong RAM.</p>
<script>
const fmt=(v,d=1)=>v==null?'N/A':Number(v).toFixed(d);
async function refresh(){try{
 const r=await fetch('/health',{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);const s=await r.json();
 document.getElementById('mode').textContent=s.test_mode?'TEST MODE — Không ghi điểm danh, không lưu ảnh':'ATTENDANCE MODE — Có thể ghi điểm danh';
 document.getElementById('mode').textContent+=` | Recognition: ${s.recognizer_model||'loading'} / ${s.recognizer_runtime||'loading'}`;
 document.getElementById('metrics').textContent=`Camera: ${s.camera_device} / ${s.camera_status} | Capture: ${fmt(s.capture_fps)} FPS | Stream: ${fmt(s.fps_estimate)} FPS | AI: ${fmt(s.inference_fps)} Hz | Inference: ${fmt(s.inference_latency_ms)} ms | Frame age: ${fmt(s.frame_age_seconds)} s`;
 document.getElementById('warning').textContent=(s.known_embeddings_count===0?'No enrolled identities — chưa có danh tính trong cache. ':`Đã tải ${s.known_embeddings_count} embeddings (${s.enrollment_source==='local'?'cục bộ trên Pi':'backend'}). `)+(s.enrollment_status==='unavailable'?'Không tải được enrollment từ backend; chưa xác minh trạng thái database. ':'')+(s.enrollment_status==='loading'?'Đang tải enrollment. ':'')+(s.camera_status!=='streaming'?'Video đang thiếu frame mới.':'');
 const body=document.getElementById('faces');body.replaceChildren();
 for(const f of s.faces){const tr=document.createElement('tr');for(const v of [f.label+(f.user_code?' ('+f.user_code+')':''),f.similarity==null?'N/A':fmt(f.similarity)+'%',fmt(f.detection_score*100)+'%',`112×112 / ${f.embedding_dimension==null?'failed':f.embedding_dimension+'D'}`,f.status]){const td=document.createElement('td');td.textContent=v;tr.appendChild(td);}body.appendChild(tr);}
 document.getElementById('error').textContent=s.last_error||'';
 }catch(e){document.getElementById('warning').textContent='Mất kết nối HTTP: '+e.message;}
 setTimeout(refresh,1000);
}refresh();
</script></body></html>"""


def create_app(state):
    app = Flask(__name__)
    app.logger.setLevel(logging.WARNING)

    @app.after_request
    def no_cache(response):
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get("/")
    def index():
        return _INDEX_HTML

    @app.get("/health")
    def health():
        return jsonify(state.to_health_dict())

    @app.get("/video_feed")
    def video_feed():
        def generate():
            sequence = -1
            while not state.stopped:
                new_sequence, frame = state.wait_frame(sequence)
                if new_sequence == sequence:
                    continue
                sequence = new_sequence
                if frame is None:
                    continue
                yield (b"--frame\r\nContent-Type: image/jpeg\r\n"
                       + f"Content-Length: {len(frame)}\r\n\r\n".encode("ascii")
                       + frame + b"\r\n")
        return Response(generate(), mimetype="multipart/x-mixed-replace; boundary=frame")

    return app


def build_stream_server(state, host="0.0.0.0", port=8080):
    # Bind đồng bộ: nếu port bận, main thoát TRƯỚC khi mở camera.
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    server = make_server(host, port, create_app(state), threaded=True)
    logger.info("HTTP stream: http://%s:%d/ (video_feed, health)", host, port)
    return server


def run_stream_server(state, host="0.0.0.0", port=8080):
    server = build_stream_server(state, host, port)
    try:
        server.serve_forever()
    finally:
        server.server_close()
