# Báo cáo kiểm tra Edge AI live camera — 02/11/2026

**Cập nhật hiện tại:** đã chuyển recognition sang EdgeFace XS, ONNX Runtime CPU, tạo lại embedding cho 6 người; xem mục cuối báo cáo. Các bảng ban đầu ghi lịch sử kiểm tra với model w600k, không phải hiệu năng EdgeFace.

Thiết bị: Raspberry Pi 5, aarch64, Debian 13 Trixie; camera CSI `imx708` (Camera Module 3), index 0. Chạy `.venv/bin/python3 main.py --live-test`, CPU local, 640×480 @10 FPS, HTTP 8080. Không thay model, threshold, dataset, Kiosk, môi trường benchmark hoặc cài service.

## Trạng thái nghiệm thu ban đầu, trước khi enrollment

| Hạng mục | Trạng thái | Bằng chứng / giới hạn |
| --- | --- | --- |
| Hệ điều hành phát hiện camera | **PASS** | `rpicam-hello --list-cameras` liệt kê `imx708`, độ phân giải cảm biến 4608×2592. |
| Video thật | **PASS** | Script camera đọc 51 frame BGR 640×480 trong khoảng 5 giây, ~10.2 FPS; chỉ trong RAM. |
| HTTP 8080 và video MJPEG | **PASS** | GET qua loopback và IP LAN `192.168.88.209` trả HTTP 200; stream được decode thành frame 640×480 thực tế. |
| Xem bằng trình duyệt trên laptop Windows | **NOT TESTED** | HTTP qua IP LAN đã kiểm tra từ Pi; chưa có xác nhận từ trình duyệt Windows. README có truy cập trực tiếp và SSH tunnel. |
| Load model và chạy DNN | **PASS** (kỹ thuật) | Cả hai ONNX load được; detector chạy trên video thật. Forward recognition với input tổng hợp trả vector 512 chiều, norm ~1; không dùng kết quả đó làm danh tính. |
| Detection/box trên người thật | **PASS** | Người dùng xác nhận đang đưa mặt trước camera. Health trả face/box, detection score 0.880–0.943; JPEG thật có overlay cam (1.766 pixel qua bộ lọc màu). Vị trí/độ đẹp box trên trình duyệt cần người dùng đối chiếu trực quan. |
| Alignment và embedding trên mặt thật | **PASS** (thực thi) | 20/20 mẫu khi người dùng đứng trước camera có mặt, aligned 112×112, embedding 512D, không lỗi. Tổng face/embedding tăng từ 65 lên 128; sau đó xác minh tiếp đạt 178/178. Không lưu ảnh crop hoặc vector; chưa đánh giá chất lượng alignment bằng ảnh trực quan. |
| Recognition đúng danh tính | **BLOCKED** | Người dùng xác nhận chưa enrollment ai. Không tự tạo danh tính hay sửa database. |
| Unknown với người chưa đăng ký khi đã có enrollment | **BLOCKED** | Chưa có danh tính tham chiếu. Kiểm thử nhánh threshold bằng vector tổng hợp đã qua, nhưng không thay cho người thật. |
| Trạng thái không có enrollment | **PASS** | HTML và health có `No enrolled identities`; score N/A khi chưa có tham chiếu; test không gọi đó là recognition FAIL. |
| Tải enrollment backend | **BLOCKED** | `10.115.62.233:3001/api/face-data` trả `No route to host`. Health báo `enrollment_status=unavailable`; không kết luận database rỗng từ lỗi mạng. |
| Video khi không có mặt | **PASS** | Video/counter tiếp tục tăng, không lỗi inference hoặc ngừng stream. |
| Tránh hai tiến trình giữ camera | **PASS** | Một `rpicam-vid` là child của server; instance Camera thứ hai bị khóa từ chối. Thử chiếm lại 8080 bị từ chối trước khi mở camera; server gốc tiếp tục chạy. |
| Chế độ test không ghi attendance hoặc lưu ảnh | **PASS** (code/kiểm thử) | Không start API sender, không GET last-state, không gọi send/toggle trong test. Ảnh chỉ qua pipe/RAM; script test không còn ghi ảnh. Database backend không được truy cập để đối chiếu vì lỗi mạng. |
| Kiểm thử phần mềm | **PASS** | 11 unittest: test mode không post/toggle, ép local model, no enrollment vẫn chạy embedding, Unknown theo threshold cũ, video khi không có mặt, health/MJPEG, frame cũ, cleanup khi model lỗi, parser giữ frame mới nhất. Dữ liệu tổng hợp chỉ dùng trong test. |
| Dependency / cú pháp | **PASS** | `pip check`: no broken requirements; `py_compile` và `bash -n scripts/test_camera.sh` thành công. |
| SIGTERM và giải phóng camera | **PASS** | Server thoát; bind lại 8080 thành công; script mở lại camera, đọc 51 frame ~10.2 FPS; không còn `rpicam-vid` sau khi script dừng. |
| SIGINT và cleanup bản cuối | **PASS** | Server thoát sạch; bind lại được port 8080; mở lại CSI và đọc 51 frame ~10.19 FPS. Đã dừng server sau nghiệm thu, không để service/chạy nền tự khởi động. |

## Pipeline được giữ nguyên

YuNet `face_detection_yunet_2023mar.onnx` → template ArcFace 5 landmark, affine dùng 3 điểm đầu → aligned BGR 112×112 → `w600k_mbf.onnx` bằng OpenCV DNN → embedding L2 512D → cosine dot product → threshold **0.60**. Detection threshold **0.80**, NMS **0.3**, detect width **320**, mỗi **3** frame chạy AI. Không thêm model giả, không sửa `face_detector.py`, `face_recognizer.py` hoặc `attendance_service.py`.

Camera CSI được bổ sung bằng `rpicam-vid` sẵn có vì môi trường `.venv` và Python hệ thống không có Picamera2/libcamera Python. Không thay requirements hoặc cài dependency mới.

## Phép đo đầu

Theo dõi liên tục **185.08 giây**, 185 mẫu health, 1.851 JPEG được decode trong RAM (1.851 checksum khác nhau), không lưu ảnh:

| Chỉ số | Min | Median | Max |
| --- | ---: | ---: | ---: |
| Capture FPS | 9.97 | 10.00 | 10.03 |
| Stream FPS | 9.97 | 10.00 | 10.03 |
| AI Hz | 3.32 | 3.33 | 3.34 |
| Inference latency ms | 5.92 | 7.37 | 13.79 |
| Frame age giây | 0.00 | 0.02 | 0.03 |

185/185 mẫu ở trạng thái streaming. Không lỗi HTTP, lỗi decode, lỗi đọc camera hoặc lỗi inference. Trong toàn bộ khoảng theo dõi không có mặt được phát hiện: **latency trên là detection trên cảnh không có mặt**, không phải latency recognition. Chưa đo hiệu năng khi có người hoặc nhiều mặt.

Sau phép đo đầu đã bổ sung trạng thái enrollment/metadata embedding và giảm access log; bản hoàn thiện được đo lại riêng, kết quả bên dưới.

## Việc người dùng cần làm tiếp

1. Chạy live test, mở trình duyệt trên laptop và xác nhận video cập nhật.
2. Đối chiếu trực quan vị trí box trên trình duyệt; thử ra/vào frame, nhiều góc/ánh sáng, theo dõi counter và latency. Đã xác minh detection/alignment/embedding thực thi trên mặt thật; chưa nghiệm thu các tình huống mở rộng hoặc nhiều người.
3. Khôi phục kết nối tới backend thật. Chỉ enrollment khi bạn chủ động thực hiện trong hệ thống quản trị ngoài repo này; xem README. Không có source/API ghi enrollment tại đây nên chưa thể xác minh các nút hoặc URL đăng ký cụ thể.
4. Sau khi enrollment: đối chiếu người đã đăng ký và người chưa đăng ký, giữ `--live-test`. Không đánh dấu recognition PASS từ riêng score hoặc từ trạng thái no_enrollment.

## File đã tạo hoặc chỉnh sửa

- Tạo `README.md`, `TEST_REPORT.md`, `tests/test_live_test.py`.
- Sửa `main.py`, `camera.py`, `health.py`, `stream_server.py`, `config.py`, `.env.example`, `scripts/test_camera.sh`.
- Không sửa `.env`, `requirements.txt`, hai ONNX, logic alignment/recognition/decision trong các module AI, dữ liệu enrollment/attendance, Kiosk hoặc service đang có.

## Phép đo bản hoàn thiện và thử người thật

Bản cuối chạy liên tục **185.05 giây** trong khoảng đo, 185/185 mẫu health streaming, **1851 JPEG thật** decode thành công và khác checksum. Không có lỗi HTTP/decode/camera/inference; frame age tối đa **0.08 giây**. Cuối khoảng đo có **53 lần phát hiện mặt và 53 lần tạo embedding thật**, sau khi người dùng đưa mặt trước camera. Chỉ lưu thống kê; không lưu ảnh hoặc vector.

| Chỉ số | Min | Median | Max |
| --- | ---: | ---: | ---: |
| Capture/stream FPS | 9.91 | 10.00 | 10.11 |
| AI Hz | 2.99 | 3.33 | 3.49 |
| Latency ms (cả cảnh trống và có mặt) | 5.86 | 7.39 | 32.81 |

Theo dõi bổ sung **20 mẫu có mặt thật**: detection score **0.880–0.943**, latency detection+alignment+embedding (không matching vì chưa enrollment) **19.92–27.22 ms**, median **26.02 ms**. Tất cả đều có aligned size 112×112, embedding 512D, `Unknown/no_enrollment`, similarity `null` (UI N/A), không có inference error. Đây là PASS cho detection và thực thi alignment/embedding, **không phải recognition đúng danh tính**.

Một số box chạm/vượt mép frame khi mặt rất gần; OpenCV tự clip khi vẽ. Đã hướng dẫn người dùng lùi để cả mặt trong khung; không thay tọa độ detector hoặc thuật toán alignment.

## Kết thúc chạy và giải phóng tài nguyên

Bản cuối hoạt động **315.7 giây** (~5 phút 16 giây), xuất **3150 frame**, tổng **462 lần phát hiện mặt / 462 lần tạo embedding**, **0 lỗi đọc camera và 0 lỗi inference**. Việc refresh enrollment ở phút thứ 5 vẫn gặp lỗi mạng nhưng không làm dừng video. Ngoài khoảng 20 mẫu có mặt nói trên, log có ghi nhận một lượt inference **41.3 ms**; chưa đo phân bố latency đầy đủ cho toàn bộ thời gian có mặt.

SIGINT dừng sạch, port 8080 được nhả, camera được mở lại bằng script test. SIGTERM cũng đã kiểm tra thành công ở lượt trước. **Server hiện đã dừng để người dùng chạy lại lệnh trong README**; không còn tiến trình capture do lượt test này giữ camera.

## Cập nhật: enrollment 5 ảnh và camera recognition cục bộ — 02/11/2026

Người dùng đã cung cấp 5 file trong `enroll_image/` và yêu cầu đăng ký để xem recognition trên port camera. Đã tạo `data/enrollments.json` bằng chính detector/align/recognizer hiện có, ID theo thứ tự ảnh gửi trước đó:

| ID | File | Detection score | Replay ảnh sau resize: ID / similarity |
| --- | --- | ---: | --- |
| 1 | `vinh.jpg` | 0.9392 | 1 / 98.97% |
| 2 | `adong.jpg` | 0.9345 | 2 / 98.70% |
| 3 | `aquan.jpg` | 0.9382 | 3 / 98.52% |
| 4 | `aminh.jpg` | 0.9285 | 4 / 99.44% |
| 5 | `adiep.jpg` | 0.9392 | 5 / 98.88% |

Mỗi ảnh phát hiện một mặt, tạo vector 512D, norm ~1. Enrollment dùng detect width 320, threshold detection 0.80 và recognition threshold 0.60 như code hiện tại. Không sửa model hoặc thuật toán alignment/recognition/decision. Không thay ảnh gốc, không ghi ảnh/crop mới, không ghi attendance hoặc cập nhật database backend. Chỉ kho local mới được tạo theo yêu cầu đăng ký của người dùng, quyền file 0600.

**PASS — enrollment và tích hợp local:** kho được đọc/kiểm tra đúng checksum model, 5 bản ghi hợp lệ. Replay ảnh đã resize 640×853 qua `infer_faces()` trả đúng ID cho 5/5 ảnh, không có lời gọi API ghi. Đây là kiểm tra tích hợp trên **chính ảnh enrollment**, không phải bộ ảnh kiểm thử độc lập hoặc benchmark accuracy.

**PASS — HTTP/camera:** đã xác định tiến trình cũ là `main.py --live-test`, dừng bằng SIGTERM, khởi động lại server trên 8080. GET health qua loopback và LAN báo `enrollment_source=local`, `enrollment_status=ready`, `known_embeddings_count=5`, `attendance_enabled=false`, camera streaming ~10 FPS, không lỗi inference. `/video_feed` trả multipart JPEG thật. Chỉ một tiến trình rpicam mở CSI.

**PASS — 18 kiểm thử phần mềm:** gồm 11 test live có sẵn và 7 test kho local: quyền file/roundtrip, không ghi đè mặc định, mismatch model, vector không hợp lệ/trùng ID, main local không gọi backend, không cho dùng kho local trong attendance, ảnh nhiều mặt phải được chọn có chủ đích. `py_compile` thành công.

**NOT TESTED tại thời điểm cập nhật — recognition live đúng danh tính và Unknown của người ngoài danh sách:** server đã sẵn sàng với mẫu thật, cần người dùng đưa người tương ứng ID vào camera và đối chiếu. Không đánh dấu PASS từ riêng replay ảnh enrollment.

Thay đổi mới: thêm `enroll_faces.py`, `local_enrollment.py`, `tests/test_local_enrollment.py`, `.gitignore`, `data/enrollments.json`; sửa `main.py`, `health.py`, `stream_server.py`, `tests/test_live_test.py`, README và báo cáo này. Chế độ attendance vẫn chỉ dùng backend. Live test tự nạp local nếu đã có kho; có `--server-enrollment` để chọn backend riêng, không trộn hai nguồn ID.

Server live test hiện được giữ chạy trên **http://192.168.88.209:8080** để người dùng thử trực tiếp; không tạo service hoặc tự khởi động cùng hệ điều hành. Lần sau vẫn dùng `.venv/bin/python3 main.py --live-test` sau khi dừng bản đang chạy.

Theo yêu cầu hiển thị tên của người dùng, overlay dùng tên file không gồm `.jpg`: **vinh, adong, aquan, aminh, adiep**. Numeric ID 1–5 chỉ là mã nội bộ; không thay vector hoặc đăng ký lại. Tên bảng HTML và overlay lấy từ trường `full_name`.

## Cập nhật: đăng ký bổ sung Hùng — 02/11/2026

Theo yêu cầu người dùng, đã đọc `enroll_image/Hùng.jpg`, phát hiện đúng 1 mặt với detection score **0.9253**, tạo embedding 512D L2 và thêm bản ghi **ID=Hùng, full_name=Hùng**. Đã so sánh dữ liệu trước/sau, xác nhận 5 bản ghi cũ giữ nguyên hoàn toàn; kho có tổng cộng 6 bản ghi. Ghi file atomically bằng hàm đã có, không tạo ảnh/crop mới hoặc attendance, không sửa model/threshold.

Replay chính ảnh enrollment sau resize 640×853 qua pipeline thật trả **Hùng / 98.43% / matched**. Đây là kiểm tra tích hợp, không đánh dấu recognition live đúng danh tính PASS khi chưa đối chiếu bằng người thật. Tên Unicode nguyên gốc được lưu và trả qua health/HTML; nhãn OpenCV bỏ dấu (`Hung`) vì font hiện tại không hỗ trợ Unicode. Không thêm dependency để sửa font.

Sau khi restart: HTTP qua IP LAN báo `known_embeddings_count=6`, `enrollment_source=local`, `enrollment_status=ready`, `camera_status=streaming`, `attendance_enabled=false`, không lỗi inference. 18 unittest và kiểm tra cú pháp tiếp tục thành công. Server được giữ chạy tại http://192.168.88.209:8080.

## Cập nhật: EdgeFace XS gamma 0.6 — 02/11/2026

Theo yêu cầu đổi model, đã chọn file người dùng cung cấp `model/edgeface_xs_gamma_06.onnx`, không sửa/convert/download thay model. File cũ `w600k_mbf.onnx` vẫn còn để rollback.

**Blocker đã xử lý:** OpenCV DNN 4.11 import graph thất bại tại toán tử `CumSum`. Đã cài **onnxruntime 1.31.1 CPU** vào `.venv`, kèm flatbuffers 25.12.19, packaging 26.3, protobuf 7.36.2. Giữ nguyên OpenCV 4.11.0, NumPy 2.5.4 và các dependency ứng dụng cũ. `pip check` không phát hiện dependency hỏng.

**Contract model đã xác minh:** input `input`, float32 **[1,3,112,112]**; output `embedding`, float32 **[1,512]**. Runtime cố định `CPUExecutionProvider`, intra-op 2 thread, inter-op 1. Input RGB, mean/std 127.5 ([-1,1]), output kiểm tra 512D hữu hạn và norm>0 rồi L2 normalize. Alignment chuyển từ affine 3 điểm sang similarity least-squares **5 điểm** với template ArcFace, giữ YuNet detector. Đối chiếu RGB/normalization với [inference EdgeFace chính thức](https://github.com/otroshi/edgeface#inference) và [source bản ONNX export](https://github.com/yakhyo/edgeface-onnx/blob/main/model/edgeface.py); alignment theo cách [5-point alignment tham chiếu](https://github.com/otroshi/edgeface/blob/main/face_alignment/mtcnn.py).

**Migration PASS:** `enroll_faces.py --rebuild-existing enroll_image` đã tạo lại cả 6 embedding bằng model mới từ ảnh gốc (kiểm tra checksum ảnh), giữ nguyên các cặp ID/tên: `1/vinh`, `2/adong`, `3/aquan`, `4/aminh`, `5/adiep`, `Hùng/Hùng`. Backup byte-for-byte kho cũ tại `data/enrollments.before-d574fc0d2b20.json`, quyền 0600. Kho hiện tại có fingerprint model/preprocessing mới; loader từ chối kho cũ khi cấu hình EdgeFace. Không ghi attendance hoặc thay ảnh gốc.

**Replay ảnh enrollment sau resize 640×853 PASS 6/6:**

| Ảnh | Kết quả | Similarity | Detection+align+embedding+matching |
| --- | --- | ---: | ---: |
| vinh.jpg | vinh / ID 1 | 99.69% | 26.07 ms |
| adong.jpg | adong / ID 2 | 99.64% | 24.60 ms |
| aquan.jpg | aquan / ID 3 | 99.11% | 24.46 ms |
| aminh.jpg | aminh / ID 4 | 99.70% | 23.92 ms |
| adiep.jpg | adiep / ID 5 | 99.50% | 24.80 ms |
| Hùng.jpg | Hùng / ID Hùng | 97.78% | 24.05 ms |

Đây là replay **chính ảnh đã đăng ký**, không phải benchmark accuracy hoặc nghiệm thu live đúng người. Không tạo model/kết quả giả. Threshold recognition giữ nguyên **0.60**, detection 0.80; chưa calibration threshold cho EdgeFace bằng tập độc lập.

**Kiểm thử phần mềm PASS 27/27:** gồm RGB channel/range, similarity transform khôi phục đầy đủ 5 điểm, landmark suy biến, invalid embedding, CPU forward model thật, từ chối metadata server sai/thiếu, từ chối kho model cũ, rebuild giữ Unicode ID/date và dừng khi thiếu/thay ảnh. `py_compile`, `bash -n scripts/install_edge.sh`, `pip check` thành công.

**Live HTTP đã xác minh:** sau khi dừng đúng server cũ bằng SIGTERM và khởi động lại, health qua LAN báo `recognizer_model=edgeface_xs_gamma_06.onnx`, `recognizer_runtime=onnxruntime`, `recognizer_alignment=similarity5`, `known_embeddings_count=6`, `attendance_enabled=false`, camera streaming ~10 FPS, không lỗi inference. Đang đo độ ổn định liên tục riêng cho EdgeFace.

**Giới hạn còn lại:** recognition live đúng từng người và Unknown với người chưa đăng ký chưa được nghiệm thu trong lần đổi model. Remote embedding legacy không được dùng với profile EdgeFace. Backend phải tạo lại vector cùng model/preprocessing và trả metadata pipeline mới được dùng; không so vector w600k với EdgeFace chỉ vì cùng 512D.

File cập nhật cho lần đổi model: `face_recognizer.py`, `config.py`, `.env` (chỉ runtime), `.env.example`, `requirements.txt`, `local_enrollment.py`, `enroll_faces.py`, `main.py`, `api_client.py`, `health.py`, `stream_server.py`, `scripts/install_edge.sh`, `tests/test_live_test.py`, README, báo cáo này và kho enrollment local; thêm `tests/test_edgeface.py` và backup kho cũ. Không sửa detector, decision, camera, Kiosk hoặc service.

### Kết quả theo dõi EdgeFace liên tục

**PASS — 185.06 giây**, **185 mẫu health**, 185/185 mẫu streaming; **1851 JPEG thật** decode thành công, khác checksum. Không có lỗi HTTP, decode, đọc camera hoặc inference. Stream/capture median **10.00 FPS**, AI median **3.33 Hz**; frame age tối đa **0.04 giây**. Mẫu khởi động FPS bằng 0 do chưa đủ cửa sổ đo 2 giây, sau đó xấp xỉ 10 FPS.

Trong toàn bộ khoảng theo dõi không có mặt trước camera: latency live **5.91–10.88 ms**, median **7.59 ms**, chỉ phản ánh **detection**, không phải inference EdgeFace. Latency có alignment/embedding/matching ở bảng replay phía trên được đo riêng trên ảnh thật của người dùng. Chưa đo recognition live trên người thật hoặc tập kiểm thử độc lập cho model mới; không đánh dấu PASS cho phần đó.

Server được giữ chạy tại **http://192.168.88.209:8080**, health xác nhận EdgeFace/ONNX Runtime/similarity5/6 enrollments/attendance disabled. Lần khởi động sau vẫn dùng `.venv/bin/python3 main.py --live-test`; không chạy thêm instance khi server hiện tại còn giữ cổng/camera.
