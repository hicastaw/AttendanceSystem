# Face Attendance Edge — Raspberry Pi live test

Dự án Edge AI chạy headless trên CPU. Chế độ live test dùng Camera Module 3 (CSI), phát MJPEG qua HTTP **8080**, hiển thị box và kết quả từ pipeline thật. Không cần Docker hoặc service tự khởi động.

Model recognition hiện tại là **`model/edgeface_xs_gamma_06.onnx`**, chạy bằng **ONNX Runtime CPU**. Đã tạo lại embedding cho cả 6 người từ ảnh gốc; giữ nguyên tên/ID.

**Lệnh chạy từ thư mục gốc:**

```bash
.venv/bin/python3 main.py --live-test
```

Chế độ này không gửi điểm danh, không tạo người dùng, không ghi ảnh/video/embedding xuống đĩa. Ưu tiên đọc `data/enrollments.json` nếu đã enrollment cục bộ; nếu chưa có file này thì đọc backend qua `GET /api/face-data`. Chỉ lệnh `enroll_faces.py` được chạy có chủ đích mới ghi kho embedding. Ảnh camera, ảnh aligned và kết quả chỉ nằm trong RAM. Không dùng `bash scripts/run_edge.sh`, `main.py` không cờ, hoặc `recognize_image.py` không `--dry-run` để test an toàn: những cách chạy đó có thể gửi điểm danh.

## Pipeline thực tế và khảo sát code

```text
Camera Module 3 → rpicam-vid (một tiến trình giữ camera CSI)
                → MJPEG qua pipe RAM → frame BGR OpenCV mới nhất
                → YuNet → landmark / alignment 112×112
                → edgeface_xs_gamma_06.onnx bằng ONNX Runtime CPU → vector L2 512 chiều
                → cosine matching với enrollment trong RAM → overlay / HTTP
```

- Entry point là `main.py`; vòng lặp capture và inference dùng chung một tiến trình Python. Thread capture chỉ giữ một JPEG mới nhất; không có hàng đợi video tăng vô hạn. HTTP không mở camera hoặc chạy model riêng, kể cả khi nhiều tab xem.
- Detection: `model/face_detection_yunet_2023mar.onnx`, `FaceDetectorYN`. Cấu hình hiện tại resize detect width **320**, detection score threshold **0.80**, NMS **0.3**, chạy AI mỗi **3** frame. Frame đầu cũng được xử lý ngay.
- Alignment EdgeFace: **5 landmark** của YuNet → similarity transform least-squares (rotation, uniform scale, translation) với template ArcFace → **112×112**. Không dùng affine tự do 3 điểm của model cũ. Profile `arcface` vẫn giữ phép affine 3 điểm để có thể quay lại model cũ.
- Recognition: `model/edgeface_xs_gamma_06.onnx`, input **float32 NCHW [1,3,112,112]**, BGR→RGB (`swapRB=True`), `(pixel-127.5)/127.5` tương đương normalize về **[-1,1]**. ONNX Runtime **CPUExecutionProvider**, 2 intra-op threads, output **[1,512]**, kiểm tra hữu hạn/norm>0 rồi normalize L2. Model được load và warmup ngay khi khởi động. OpenCV DNN 4.11 không import được graph này vì `CumSum`; không sửa hoặc convert lại file model.
- Decision: `AttendanceDecision.best_match/match`, dot product của vector đã normalize, threshold giữ nguyên **0.60**. `Unknown` khi không đạt threshold. Threshold này chưa được hiệu chỉnh bằng tập kiểm thử độc lập cho EdgeFace; cần đối chiếu người thật và người chưa đăng ký trước khi dùng cho attendance. Similarity không phải xác suất nhận diện đúng.
- Live test tự nạp enrollment từ `data/enrollments.json` nếu file đã có, không gọi backend và không trộn hai nguồn danh tính. Nếu chưa có kho local hoặc dùng `--server-enrollment`, tải từ backend qua `GET /api/face-data`. Cả hai nguồn dùng `user_code`, `full_name`, `embedding` 512 chiều. Kho local kiểm tra checksum model và tính hợp lệ vector; không khớp sẽ dừng trước khi mở camera. Chế độ attendance vẫn chỉ dùng backend.
- Enrollment backend được tải/làm mới ở thread nền, mặc định **300 giây**. Enrollment local được nạp một lần lúc khởi động; sau khi đăng ký lại cần restart live test. Mất backend không chặn video. Lỗi tải giữ cache RAM gần nhất; phản hồi thành công với danh sách rỗng xóa cache. Web phân biệt `loading`, `unavailable`, `empty`, `ready`.
- **Không có enrollment vẫn chạy detection, alignment và embedding thật** khi có mặt. Hiển thị `Unknown`, score `N/A`, trạng thái `no_enrollment`, và **No enrolled identities**. Đây không phải kết luận recognition thất bại. Nếu backend không truy cập được, chỉ có thể khẳng định cache rỗng, chưa kiểm chứng database.
- Chế độ attendance cũ có toggle check-in/check-out và cooldown 60 giây; chỉ hoạt động khi không dùng `--live-test`. Live test luôn chọn model local. Remote embedding legacy bị từ chối với profile EdgeFace vì chưa xác minh model phía server; không tự fallback sang model cũ.
- Code ban đầu chỉ mở USB qua V4L2 và stream port 5000; không có worker inference riêng. Backend CSI được bổ sung vào chính lớp `Camera`; đường USB và cấu hình attendance cũ vẫn còn.

## Các file quan trọng

| File/thư mục | Vai trò |
| --- | --- |
| `main.py` | Orchestrator, live test, overlay, đo latency, cleanup |
| `camera.py` | CSI/rpicam và USB/V4L2, khóa tránh hai tiến trình Edge tranh camera, reconnect |
| `face_detector.py` | YuNet, resize và quy đổi tọa độ |
| `face_recognizer.py` | Alignment similarity 5 điểm, ONNX Runtime CPU; hỗ trợ legacy cv2.dnn/affine3 |
| `attendance_service.py` | Cosine matching, threshold, cooldown/toggle |
| `api_client.py` | Đọc enrollment; gửi sự kiện trong chế độ attendance |
| `health.py`, `stream_server.py` | Trạng thái RAM, trang debug, `/health`, `/video_feed` |
| `config.py`, `.env`, `.env.example` | Cấu hình; biến môi trường được ưu tiên hơn `.env` |
| `model/` | YuNet, EdgeFace đang dùng và w600k_mbf.onnx để rollback |
| `enroll_faces.py`, `local_enrollment.py` | Đăng ký ảnh thật và kiểm tra kho embedding local |
| `enroll_image/` | 6 ảnh gốc người dùng cung cấp; không bị công cụ sửa |
| `data/enrollments.json` | Enrollment local, ID/tên file/embedding và checksum model, quyền file 0600 |
| `tests/test_local_enrollment.py` | Toàn vẹn dữ liệu local, từ chối ghi đè, test mode không gọi backend |
| `tests/test_edgeface.py` | Contract RGB/alignment/embedding, CPU forward thật, migration giữ ID/tên |
| `scripts/test_camera.sh` | Test video thật 5 giây trong RAM, mặc định CSI |
| `scripts/install_edge.sh`, `scripts/run_edge.sh` | Cài dependency; chạy attendance cũ |
| `recognize_image.py` | Nhận diện file ảnh; có cờ `--dry-run` |
| `tests/test_live_test.py` | Kiểm thử an toàn/HTTP bằng dữ liệu tổng hợp, không nghiệm thu danh tính |
| `TEST_REPORT.md` | Kết quả nghiệm thu thực tế và các mục chưa kiểm tra |
| `systemd/` | Service có sẵn của dự án; không cần cài/bật để live test |

## Python và dependencies

Môi trường kiểm tra: Debian 13 Trixie, aarch64, Python **3.13.5**, `.venv` riêng (không dùng system site packages), OpenCV **4.11.0**, NumPy **2.5.4**, Flask **3.1.3**, Requests **2.34.2**. Đã bổ sung **ONNX Runtime 1.31.1 CPU** và dependency đi kèm trong `.venv`; giữ nguyên OpenCV, NumPy, Flask, Requests. Cả hai model đang dùng đã có trên đĩa; không cần PyTorch hoặc GPU.

```bash
cd /home/raspberrypi/face-attendance-edge
.venv/bin/python3 -m pip check
.venv/bin/python3 -c "import cv2, numpy, flask, requests, onnxruntime; print(cv2.__version__, onnxruntime.__version__)"
rpicam-vid --version
```

CSI sử dụng executable `rpicam-vid` đã có trên hệ thống; **không cần Picamera2 hoặc libcamera Python trong venv**. Recognition EdgeFace cần ONNX Runtime CPU, đã thêm vào `requirements.txt`. Nếu triển khai vào môi trường mới và chưa có `.venv`, dùng script cài dependency có sẵn:

```bash
bash scripts/install_edge.sh
```

Script này cài/cập nhật dependency, chỉ chạy khi cần. Nếu thiếu `rpicam-vid`, kiểm tra nguồn package hệ điều hành và gói `rpicam-apps`; không cài gói camera bằng pip vào venv để thay thế. Không ghi đè `.env` sẵn có; `.env.example` là mẫu cấu hình.

## Kiểm tra camera thật

Dừng server/ứng dụng camera khác trước khi chạy test độc lập:

```bash
rpicam-hello --list-cameras
ss -ltnp 'sport = :8080'
systemctl is-active face-attendance-edge
bash scripts/test_camera.sh
```

Kết quả mong đợi: camera `imx708` index 0; script đọc video 640×480 trong 5 giây và báo FPS, rồi release camera. Không lưu ảnh. Nếu đang có service chạy, xác định và dừng service đó có chủ đích trước khi thử; không chạy hai bản ứng dụng đồng thời. File lock của Edge tự nhả khi thoát, không cần xóa thủ công.

Camera USB dùng:

```bash
bash scripts/test_camera.sh v4l2
.venv/bin/python3 main.py --live-test --camera-backend v4l2
```

USB lấy `CAMERA_DEVICE` trong `.env`, thử thêm `/dev/video0..2` như code ban đầu. Với CSI, `/dev/video0` không phải thiết bị USB đọc ảnh trực tiếp; đừng dùng backend V4L2 cho Camera Module 3.

## Mở video trên laptop Windows

Chạy trên Pi, giữ terminal mở:

```bash
cd /home/raspberrypi/face-attendance-edge
.venv/bin/python3 main.py --live-test
```

Live test mặc định override port 5000 trong `.env` thành **8080** và camera thành `rpicam`, giữ nguyên model/threshold. Bind lấy `STREAM_HOST` (hiện `0.0.0.0`). Có thể chỉ định rõ:

```bash
.venv/bin/python3 main.py --live-test --host 0.0.0.0 --port 8080
```

Xem IP hiện tại bằng:

```bash
hostname -I
```

IP LAN đo được khi nghiệm thu là **192.168.88.209**. Laptop cùng mạng mở Edge/Chrome tại **http://192.168.88.209:8080**. IP có thể thay đổi; chọn IP LAN phù hợp từ `hostname -I`. IP mạng riêng ZeroTier đo được là `10.115.62.222`; chỉ dùng nếu laptop cũng có đường mạng tới đó.

Trang `/` hiển thị video và thống kê. `/video_feed` là MJPEG trực tiếp; `/health` là JSON phục vụ debug. Chỉ dùng trên LAN/mạng riêng tin cậy; không cấu hình NAT/router hay tunnel công cộng. Trang debug hiện không có đăng nhập.

### SSH port forwarding

Nếu SSH tới Pi được nhưng không mở HTTP trực tiếp, trên PowerShell Windows chạy:

```powershell
ssh -N -L 8080:127.0.0.1:8080 raspberrypi@192.168.88.209
```

Giữ cửa sổ đó mở, rồi truy cập **http://127.0.0.1:8080** trên laptop. Server trên Pi vẫn phải chạy. Nếu port 8080 trên Windows bận:

```powershell
ssh -N -L 18080:127.0.0.1:8080 raspberrypi@192.168.88.209
```

Sau đó mở **http://127.0.0.1:18080**. Có thể chạy server với `--host 127.0.0.1` trên Pi khi chỉ xem qua SSH. Dừng tunnel bằng Ctrl+C ở PowerShell.

## Đọc kết quả

- Box xanh: match đạt threshold; box cam: `Unknown` hoặc chưa đủ dữ liệu. Tên lấy từ tên file được vẽ trên video nếu là ASCII (hiện là vinh, adong, aquan, aminh, adiep); tên có dấu hiển thị đầy đủ trong bảng HTML, overlay dùng ID thay thế và bỏ dấu nếu ID cũng có dấu vì font OpenCV không hỗ trợ Unicode.
- `Cosine similarity`: score ứng viên gần nhất ×100, có thể âm; `N/A` khi chưa có enrollment hoặc embedding thất bại. Không thay threshold theo phần trăm trên UI; 0.60 tương ứng 60%.
- `Detection score`: score của YuNet, khác similarity recognition.
- `112×112 / 512D`: alignment đã chạy và đã tạo embedding thực cho mặt đó; không hiện hoặc lưu vector của video live. `failed` nghĩa là không lấy được embedding.
- `no_enrollment` / **No enrolled identities**: cache không có danh tính để so khớp. `enrollment_status=empty` khi nguồn enrollment không có danh tính, `unavailable` nghĩa là không tải được backend. `enrollment_source=local` và `ready` nghĩa là đã nạp kho trên Pi; lúc này `server_reachable=false` không phải lỗi recognition vì không cần kết nối server.
- `no_match`: có enrollment nhưng score không đạt threshold. `matched`: match được danh tính, **không gửi attendance trong test**. `embedding_failed`: không tạo được embedding.
- Capture FPS: tốc độ camera cấp JPEG; Stream FPS: số frame xử lý/encode xuất HTTP mỗi giây; AI Hz: số vòng inference thành công mỗi giây. Với capture 10 FPS và xử lý mỗi 3 frame, AI khoảng 3.3 Hz là bình thường. FPS trình duyệt còn phụ thuộc mạng/máy khách.
- Inference latency: thời gian một lượt detection + alignment/embedding/matching cho các mặt được phát hiện; không tính capture, JPEG hoặc truyền mạng. Khi **không có mặt**, đây chỉ là thời gian detection; không suy ra hiệu năng recognition từ số đó.
- Box giữ tối đa 1 giây giữa frame bỏ qua AI; không có tracking. Không có mặt vẫn xuất video bình thường. Health không trả mặt cũ khi frame/inference quá 3 giây.
- Camera `streaming` yêu cầu đang mở và frame mới dưới 3 giây; `no_recent_frame` báo mất video. `/health` còn có tổng frame/inference, tổng mặt/embedding và số lỗi; ảnh cuối trong trình duyệt có thể còn đứng khi mất camera, phải đối chiếu trạng thái/frame age.

## Enrollment cục bộ và đổi model

Kho hiện tại `data/enrollments.json` chứa **6 vector EdgeFace 512D**, đã tạo lại từ ảnh gốc, không tái sử dụng vector của w600k dù cùng số chiều:

| ID | Ảnh | Tên hiển thị |
| --- | --- | --- |
| 1 | `enroll_image/vinh.jpg` | vinh |
| 2 | `enroll_image/adong.jpg` | adong |
| 3 | `enroll_image/aquan.jpg` | aquan |
| 4 | `enroll_image/aminh.jpg` | aminh |
| 5 | `enroll_image/adiep.jpg` | adiep |
| Hùng | `enroll_image/Hùng.jpg` | Hùng |

Tên được lấy từ tên file; ID **Hùng** giữ nguyên theo yêu cầu. Bảng HTML/health có đầy đủ dấu; nhãn OpenCV dùng `Hung` do font không hỗ trợ Unicode. File ảnh gốc được giữ nguyên, không tạo ảnh/crop mới hoặc gửi dữ liệu lên backend. Kho embedding có quyền file 0600; `.gitignore` bỏ qua `data/` và `enroll_image/`.

Sau khi đổi model/profile, phải tạo lại toàn bộ vector bằng lệnh sau (đã thực hiện cho lần chuyển EdgeFace này):

```bash
.venv/bin/python3 enroll_faces.py --rebuild-existing enroll_image
```

Lệnh này đọc danh sách danh tính trong kho cũ, tìm đúng ảnh theo `source_image`, kiểm tra checksum ảnh không đổi, tạo embedding bằng model hiện tại và **giữ nguyên ID/tên/thứ tự**. Ghi atomically sau khi mọi ảnh đều thành công, đồng thời backup kho trước khi thay. Nếu thiếu ảnh, ảnh thay đổi, nhiều mặt hoặc lỗi inference thì không tự ghi kho dở dang. Không được chỉ sửa checksum metadata để ép dùng vector cũ với model mới.

Backup trước khi chuyển từ w600k sang EdgeFace ở lần này:

```text
data/enrollments.before-d574fc0d2b20.json
```

Để tạo một kho hoàn toàn mới, `enroll_faces.py` nhận danh sách ảnh theo thứ tự ID hoặc một thư mục (sắp xếp tên file). Mặc định từ chối ghi đè. `--replace` thay toàn bộ kho và gán ID lại theo đầu vào; không phải thêm người. Với kho 6 người hiện tại, dùng `--rebuild-existing` khi đổi model để giữ ID Hùng. Ảnh nhiều mặt bị từ chối trừ khi chủ động chọn `--largest-face`.

Chạy camera recognition:

```bash
.venv/bin/python3 main.py --live-test
```

Mở **http://192.168.88.209:8080**. Health phải có:

```json
{
  "recognizer_model": "edgeface_xs_gamma_06.onnx",
  "recognizer_runtime": "onnxruntime",
  "recognizer_alignment": "similarity5",
  "enrollment_source": "local",
  "enrollment_status": "ready",
  "known_embeddings_count": 6,
  "attendance_enabled": false
}
```

Có thể chỉ định rõ kho bằng `--enrollment-file data/enrollments.json`. Sau khi đăng ký lại cần restart server; không chạy hai instance chiếm camera. Người đã đăng ký đạt threshold sẽ hiện tên, box xanh và similarity; người ngoài danh sách cần được `Unknown/no_match`. Replay chính ảnh enrollment không chứng minh accuracy trên người thật mới.

Các cấu hình recognition có thể ghi vào `.env` hoặc đặt qua biến môi trường:

```text
EMBEDDING_BACKEND=onnxruntime
RECOGNIZER_THREADS=2
RECOGNIZER_MODEL_PATH=/home/raspberrypi/face-attendance-edge/model/edgeface_xs_gamma_06.onnx
RECOGNIZER_PROFILE=edgeface
```

`RECOGNIZER_MODEL_PATH` mặc định là EdgeFace trong `model/`, profile suy ra từ tên file. Nếu đổi tên model khác, chọn profile có chủ đích. Không tự hạ threshold để bù lỗi alignment hoặc embedding sai model.

Nếu cần quay lại model cũ, dừng server đang chạy trước, rồi dùng **đúng model/profile và kho cũ cùng nhau**:

```bash
RECOGNIZER_MODEL_PATH=model/w600k_mbf.onnx RECOGNIZER_PROFILE=arcface EMBEDDING_BACKEND=cv2dnn .venv/bin/python3 main.py --live-test --enrollment-file data/enrollments.before-d574fc0d2b20.json
```

Nguồn đối chiếu: [EdgeFace inference chính thức](https://github.com/otroshi/edgeface#inference), [alignment tham chiếu](https://github.com/otroshi/edgeface/blob/main/face_alignment/mtcnn.py), [preprocessing ONNX của tác giả bản export](https://github.com/yakhyo/edgeface-onnx/blob/main/model/edgeface.py), [ONNX Runtime CPU](https://onnxruntime.ai/docs/get-started/with-python.html).

## Enrollment qua backend (tuỳ chọn)

Repo này chưa có API tạo người dùng/enrollment trên server hoặc giao diện quản trị. Nếu cần đồng bộ người dùng vào hệ thống attendance thật, đăng ký ở backend hiện có; không coi kho local là dữ liệu đã đồng bộ server.

1. Khởi động backend trên laptop và kiểm tra `SERVER_BASE_URL`, `EDGE_DEVICE_KEY`. Địa chỉ cấu hình hiện là `http://10.115.62.233:3001`; lần kiểm tra gặp `No route to host`. Không dùng port stream 8080 làm backend enrollment.
2. Tạo/chọn người và đăng ký mặt trong chức năng quản trị thực tế của backend. Chưa xác minh tên nút/URL vì không có source backend ở repo này. Backend phải tạo lại enrollment bằng **cùng EdgeFace**, alignment/preprocessing và embedding 512 chiều. `GET /api/face-data` phải kèm đối tượng `pipeline` có `recognizer_sha256`, `preprocessing`, `embedding_dimension` khớp kho Edge hiện tại; vector không có metadata hoặc sai model bị từ chối. Backend cũ dùng w600k không tương thích, dù cũng 512 chiều. Không đổi threshold để bù mismatch model.
3. Dừng live test đang chạy, rồi bỏ qua kho local bằng:

```bash
.venv/bin/python3 main.py --live-test --server-enrollment
```

4. Health phải có `enrollment_source=server`, `server_reachable=true`, `enrollment_status=ready`, `known_embeddings_count>=1`. Backend refresh mặc định mỗi 300 giây. Đối chiếu người đã đăng ký và người chưa đăng ký trong test mode; không gửi attendance.

## Dừng an toàn

Ctrl+C tại terminal chạy server, hoặc gửi SIGTERM tới **PID của đúng `main.py --live-test`**. Code dùng `finally` để terminate/wait `rpicam-vid`, đóng camera V4L2, nhả lock và đóng HTTP. Không dùng `kill -9` khi dừng bình thường.

```bash
ss -ltnp 'sport = :8080'
pgrep -af rpicam-vid
bash scripts/test_camera.sh
```

Sau khi server thoát, port không còn listen bởi tiến trình đó và script phải mở lại được camera. Không chạy script khi server vẫn đang giữ camera.

## Lỗi thường gặp

| Hiện tượng | Kiểm tra / xử lý |
| --- | --- |
| `No cameras available`, lỗi dmaHeap | Chạy `rpicam-hello --list-cameras` trên host Pi có quyền thiết bị; sandbox có thể ẩn `/dev`. Kiểm tra cáp CSI đúng cổng/hướng, tắt nguồn trước khi thao tác phần cứng. |
| `Camera đang được ... Edge ... sử dụng` hoặc libcamera báo busy | Dừng đúng instance/service/rpicam khác trước; mỗi thời điểm chỉ một capture. Không xóa lock để ép mở. |
| `Address already in use` | Dùng `ss -ltnp 'sport = :8080'`, xác định tiến trình giữ cổng; không tự kill ứng dụng khác. Server bind trước khi mở camera. |
| Chưa thấy box | Cần người thật trong frame, đủ sáng và khuôn mặt đủ lớn. Kiểm tra counter `faces_detected_total`; chưa có mặt không phải detection FAIL. Không tự hạ threshold. |
| `No enrolled identities` | Chưa có vector hợp lệ trong cache; xem `enrollment_status`, kết nối backend và quy trình enrollment ở trên. |
| `No route to host`, timeout/401/403 | Kiểm tra `SERVER_BASE_URL`, đường mạng tới laptop, backend và device key. Video/AI vẫn tiếp tục; đừng coi đây là lỗi camera. |
| OpenCV báo lỗi `CumSum` với EdgeFace | Dùng `EMBEDDING_BACKEND=onnxruntime`, cài dependency từ requirements; không ép dùng cv2dnn cho file này. |
| Enrollment không khớp model/preprocessing | Tạo lại bằng `enroll_faces.py --rebuild-existing enroll_image`; không dùng embedding model cũ hoặc tự sửa fingerprint. |
| Có box nhưng embedding lỗi | Xem traceback terminal, `last_error`, `inference_errors`; model forward khác việc nhận diện đúng người. Kiểm tra model và OpenCV đang có, không thay model ngẫu nhiên. |
| Video đứng | Kiểm tra `camera_status`, `frame_age_seconds`, số frame tăng và log reconnect; browser có thể vẫn giữ ảnh cũ. |
| Không mở được từ Windows | Kiểm tra IP mới bằng `hostname -I`, cùng mạng, STREAM_HOST, firewall mạng nội bộ hoặc dùng SSH forwarding. |
| Quá tải CPU khi nhiều người xem | Thử một tab xem trước; tránh chạy app camera khác. Không thay môi trường benchmark/model/threshold để che lỗi. |

## Checklist nghiệm thu

- [ ] `rpicam-hello` liệt kê đúng `imx708`.
- [ ] Test RAM 5 giây trả nhiều frame thật, không lưu ảnh.
- [ ] Laptop xem được video mới tại port 8080 (hoặc tunnel).
- [ ] Đưa **người thật** vào/ra frame: box xuất hiện/mất đúng vị trí.
- [ ] Khi có mặt: bảng báo alignment 112×112, embedding 512D, counter tăng, không có inference error.
- [ ] Khi không có mặt: video vẫn chạy, không giữ box quá hạn.
- [ ] Chưa có enrollment: hiển thị **No enrolled identities**, similarity `N/A`, không kết luận recognition FAIL/PASS.
- [ ] Khi có enrollment hợp lệ: đối chiếu đúng ID/tên người thật.
- [ ] Khi có enrollment hợp lệ: người chưa đăng ký được `Unknown/no_match`.
- [ ] Ghi capture/stream FPS, AI Hz, latency **có và không có mặt** riêng.
- [ ] Chạy ít nhất 3–5 phút; kiểm tra frame age, counter lỗi và mất video.
- [ ] Ctrl+C/SIGTERM: camera mở lại được, port giải phóng.
- [ ] Test mode không tạo attendance, user hoặc file ảnh.

Kết quả thực tế của lần triển khai nằm trong `TEST_REPORT.md`; checklist này là hướng dẫn nghiệm thu, không tự đánh dấu những bước chưa thực hiện.

Kiểm thử phần mềm (dữ liệu tổng hợp, không chứng minh recognition trên người thật):

```bash
.venv/bin/python3 -m unittest discover -s tests -v
```
