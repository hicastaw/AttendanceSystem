# YIRLoDT AttendanceSystem – AIOT

Hệ thống điểm danh khuôn mặt cho phòng lab: **SCRFD-10G + ArcFace R50**, Python worker sở hữu camera, Node.js/Express, SQLite và giao diện HTML/CSS/JavaScript.

MVP hiện tập trung vào demo trên **Windows laptop**. Raspberry Pi 5 là hướng triển khai tiếp theo bằng Raspberry Pi OS và systemd; Hailo NPU là bước đánh giá riêng.

## Chức năng và giao diện

| Chức năng MVP | Nội dung |
|---|---|
| Face Enrollment | Tạo/chọn thành viên bằng tên và mã; đăng ký bằng **một ảnh từ webcam hoặc một ảnh JPEG/PNG tải lên**; kiểm tra ảnh đã được backend xác thực, xác nhận danh tính rồi Save. |
| Face Recognition | Nhận diện thành viên đã đăng ký bằng webcam với gallery cùng model contract. |
| Daily Attendance | Tự động ghi tối đa một check-in/thành viên/ngày theo `Asia/Ho_Chi_Minh` trong demo R50. |
| Attendance Statistics | Thống kê tuần/tháng và lịch sử điểm danh của thành viên. |

Ba trang chính dùng chung origin của launcher:

| Trang | Đường dẫn |
|---|---|
| **Admin Portal** – thành viên, thống kê, lịch sử/log, CSV và diagnostics | `/` |
| **Face Enrollment** – đăng ký khuôn mặt | `/r50-capture.html` |
| **Face Attendance** – nhận diện và check-in | `/lab-kiosk.html` |

Đăng nhập Admin bằng mật khẩu do launcher tạo cho phiên hiện tại. Enrollment có thể yêu cầu đăng nhập riêng; không giả định tự động dùng chung phiên đăng nhập. Preview trên Attendance cần phiên Admin hợp lệ từ Admin Portal.

## Kiến trúc

~~~text
Webcam do một Python worker quản lý
    → SCRFD-10G → alignment 5 điểm → ArcFace R50
    → gallery cùng contract → matching
    → durable outbox → Express API → SQLite + receipt
    → kiosk-state → Face Attendance và thống kê
~~~

Preview là JPEG từ cùng worker qua Express có xác thực; các trang native không mở thêm camera. Ảnh upload đi qua cùng detector/alignment/recognizer, nhưng **không chứng minh sự hiện diện và không tự tạo check-in**.

- Chỉ xác nhận check-in sau khi backend đã commit dữ liệu hoặc receipt.
- Giữ ngưỡng nhận diện, từ chối unknown/nhiều khuôn mặt và guard freshness 5 giây cho frame camera.
- Demo R50 dùng `isolated-r50-laptop-test`. Đường chạy ordinary/production vẫn giữ quy tắc lịch/occurrence/cooldown hiện có; daily policy của demo không thay thế lịch sử production.
- R50 ONNX, R50 HEF và MobileFaceNet có gallery/contract riêng, không trộn hoặc chuyển nhãn embedding.

## Chạy demo trên Windows

Chạy các lệnh từ **thư mục gốc repository**, bằng PowerShell. Môi trường đang dùng để kiểm thử: CPython **3.11.5 64-bit** và Node.js **24.18.0**.

### 1. Chuẩn bị môi trường

Với clone mới hoặc máy mới, tạo venv riêng và cài dependencies theo repository:

~~~powershell
py -3.11 -m venv .venv/laptop-r50-manual
$python = (Resolve-Path '.venv/laptop-r50-manual/Scripts/python.exe').Path

& $python -m pip install -r tools/requirements-test.txt
& $python -m pip check
npm.cmd ci --prefix AIOT/server
node tools/run_r50_laptop_test.mjs --check-deps
~~~

Nếu workspace đã có môi trường đang hoạt động, dùng lại interpreter đã kiểm tra; không chạy lại bước tạo venv/cài dependencies lên môi trường dùng chung.

**Model phải được chuẩn bị riêng:** launcher đọc `AIOT/edge/model/r50-experimental-laptop.json` và kiểm SHA/tensor của các artifact được descriptor chỉ định. Model weights không thuộc bộ tài liệu/source đề xuất công khai. Xem [quy định model artifacts](AIOT/edge/model/README.md); không sửa hash hoặc tắt validation để bỏ qua model không khớp. Cần có quyền sử dụng artifact phù hợp.

### 2. Khởi động webcam khi người tham gia đã đồng ý

Chọn rõ camera index; ví dụ camera `0`:

~~~powershell
$python = (Resolve-Path '.venv/laptop-r50-manual/Scripts/python.exe').Path
node tools/run_r50_laptop_test.mjs --python "$python" --camera 0 --allow-camera --threads 4
~~~

Dùng đúng **origin loopback và mật khẩu tạm được in trong terminal**, không dùng URL/port của phiên trước. Giữ terminal mở.

1. Vào Admin Portal và đăng nhập.
2. Vào Face Enrollment, tạo/chọn đúng thành viên; chọn webcam hoặc một ảnh upload.
3. Chờ backend xác thực; xem ảnh xác nhận đã đóng băng, xác nhận đúng người rồi Save.
4. Chờ gallery sẵn sàng hoặc dùng `restart-worker` để kiểm tra profile được reload.
5. Vào Face Attendance, cho thành viên xuất hiện trước webcam; kiểm tra check-in đã commit và thống kê trong Admin.
6. Thử lại cùng ngày: không thêm dòng điểm danh thứ hai. Unknown/nhiều khuôn mặt không được tạo attendance.

Nếu cần kiểm tra upload không tự điểm danh, cho người vừa đăng ký rời khỏi khung hình trước Save trong khi camera vẫn chạy. Một frame live hợp lệ sau Save có thể tự động tạo check-in.

### 3. Restart và dừng

Gõ vào terminal launcher rồi nhấn Enter:

| Lệnh | Tác dụng |
|---|---|
| `restart-worker` | Restart worker Python, giữ nguyên backend và DB/gallery/outbox của run hiện tại. |
| `stop` | Dừng các tiến trình do launcher sở hữu và xóa dữ liệu tạm khi cleanup bình thường thành công. |

Một lần mở launcher mới bắt đầu với dữ liệu mới. **Native demo không phải kho dữ liệu lab lâu dài.** Nếu shutdown/cleanup báo lỗi, giữ lại bằng chứng đã lược bỏ thông tin nhạy cảm; không xóa nhầm thư mục hay database khác.

## Kiểm thử tự động

Thiết lập interpreter đúng trước khi chạy:

~~~powershell
$python = (Resolve-Path '.venv/laptop-r50-manual/Scripts/python.exe').Path
$env:TEST_PYTHON = $python

& $python -B -m unittest discover -s tools/tests -q
npm.cmd test --prefix AIOT/server
~~~

Để bật integration fixture dùng ONNX thật, cần descriptor/model và bộ fixture public-domain đã được xác minh hash:

~~~powershell
$env:CPU_R50_DESCRIPTOR = (Resolve-Path 'AIOT/edge/model/r50-experimental-laptop.json').Path
$env:CPU_R50_FIXTURES = (Resolve-Path '.model-validation/public-domain-fixtures-20261020').Path
npm.cmd run test:cpu --prefix AIOT/server
~~~

Browser tests cần Chromium của Playwright:

~~~powershell
Push-Location AIOT/server
npx.cmd --no-install playwright install chromium
npm.cmd run test:browser
Pop-Location
~~~

Các lệnh cài đặt/kiểm thử trên là hướng dẫn chạy, không phải cam kết mọi suite đang PASS. Model/fixture thiếu có thể làm test skip hoặc fail; phải ghi rõ kết quả. Fixture ONNX và mock không thay thế nghiệm thu webcam với người thật. Xem [môi trường và testing](docs/SOFTWARE_ENVIRONMENT.md).

## Docker và Raspberry Pi

- **Native Windows là luồng demo ưu tiên.** Docker Compose ở `deploy/r50-docker/` là lựa chọn laptop riêng, còn cần xác minh các giới hạn routing/camera/packaging và webcam thực tế. Xem [README Docker](deploy/r50-docker/README.md).
- Docker demo dùng named volume riêng, có thể giữ dữ liệu qua lần dừng; vòng đời này khác native temporary run. Không xóa volume hoặc dùng dữ liệu lab hiện có làm dữ liệu test.
- Pi 5 sẽ có kế hoạch native Raspberry Pi OS, systemd, camera CSI và SQLite persistent riêng. Chưa có nghiệm thu Pi/Hailo hay production R50; không dùng kết quả laptop làm bằng chứng phần cứng.
- `backend/`, `frontend/` và `docker-compose.yml` ở root là stack **legacy React/PostgreSQL/pgvector**; chúng không phải lệnh khởi động của AIOT MVP.

## Tài liệu và dữ liệu công khai

Xem [danh mục tài liệu chọn lọc cho GitHub](docs/README.md), gồm cả các file Markdown ở ngoài `docs/`.

Chỉ công khai source, cấu hình mẫu và tài liệu đã rà soát. Không đưa lên GitHub: `.env`, mật khẩu/token, ảnh/video người tham gia, embeddings/gallery, SQLite/outbox, bản backup, log/HAR/screenshot có dữ liệu cá nhân hoặc model weights chưa có quyền phân phối.

Trạng thái hiện tại là **R50 laptop experimental**. Kiểm thử tự động có bằng chứng riêng; nghiệm thu webcam đầy đủ, độ chính xác/calibration, nguồn gốc/license model và triển khai kiosk dùng chung vẫn là các gate riêng.
