# Triển khai PoC "Lab Access" — hướng dẫn từng bước

> PoC: 1 camera (Logitech C920) → 1 Orange Pi PC (ARMv7, Armbian/Debian Trixie)
> → 1 laptop (server + trang quản lý, hoàn toàn mới, KHÔNG dùng lại
> `backend/`/`frontend/` của project gốc).

## Cấu trúc thư mục

Toàn bộ hệ thống PoC (server + trang quản lý + edge) nằm gọn trong 1 thư mục
`AIOT/` — tách biệt hoàn toàn khỏi `backend/`/`frontend/` cũ ở gốc project
(không đụng, không xoá, chỉ đơn giản là không dùng nữa):

```
AIOT/
├── edge/                  # Code chạy trên Orange Pi
│   ├── main.py, config.py, camera.py, face_detector.py, face_recognizer.py,
│   │   attendance_service.py, api_client.py, health.py, stream_server.py
│   └── model/*.onnx       # face_detection_yunet_2023mar.onnx, w600k_mbf.onnx (đã copy sẵn)
├── server/                # Chạy trên laptop: Node/Express + SQLite + trang quản lý tĩnh
│   ├── src/               # index.js, db.js, schema.sql, routes/, middleware/
│   ├── ai/                # AI Service Python rút gọn (chỉ dùng khi ĐĂNG KÝ khuôn mặt)
│   ├── public/            # Trang quản lý (login, đăng ký khuôn mặt, xem log) — HTML/JS thuần
│   └── data/attendance.db # File SQLite (tự tạo khi chạy lần đầu)
├── scripts/               # install_edge.sh, test_camera.sh, run_edge.sh, deploy_edge.sh
├── systemd/                # face-attendance-edge.service
├── .env.example            # cấu hình cho edge
└── EDGE_DEPLOYMENT.md       # chính file này
```

Mọi lệnh trong hướng dẫn này chạy **từ bên trong `AIOT/`** (hoặc `AIOT/server/`
khi nói rõ) — không còn phụ thuộc gì vào `backend/`/`frontend/`/`docker-compose.yml`
ở gốc project nữa.

## 0. Quyết định kỹ thuật quan trọng — đọc trước khi triển khai

`onnxruntime` (dùng để trích embedding 512-D) **không có wheel PyPI cho armv7l
và không được Debian đóng gói** (đã kiểm chứng qua PyPI JSON API và
packages.debian.org). Vì vậy Face Recognition trên Orange Pi **không gọi
`onnxruntime`**, mà chạy qua `cv2.dnn.readNetFromONNX` — vẫn dùng đúng file
`w600k_mbf.onnx`, đúng thuật toán ArcFace/MobileFaceNet, chỉ đổi runtime
(`edge/face_recognizer.py:FaceRecognizer`).

**Việc này cần được xác nhận thực tế trên chính Orange Pi** (mục 3.B bên
dưới). Nếu `cv2.dnn.readNetFromONNX` không import được graph, chuyển sang chế
độ dự phòng bằng 1 dòng cấu hình, KHÔNG cần sửa code:
```
# AIOT/.env (trên Orange Pi)
EMBEDDING_BACKEND=remote
```
Khi đó Orange Pi chỉ làm Face Detection + crop/align (rất nhẹ), gửi ảnh mặt
sang AI Service rút gọn trên laptop (`AIOT/server/ai/main.py`, endpoint
`/ai/face/extract`, dùng `onnxruntime` bình thường trên x86_64) để lấy
embedding. Xem `edge/face_recognizer.py:RemoteFaceRecognizer`.

Không có liveness/chống giả mạo trong PoC này (2 model MiniFASNet của project
gốc không được mang sang `AIOT/server/ai`) — không cần thiết cho việc đăng ký
khuôn mặt thủ công qua trang quản lý.

## 1. Chuẩn bị trên laptop (server)

### 1.1 Cài Node.js dependencies cho server

```bash
cd AIOT/server
npm install
cp .env.example .env
nano .env   # đặt ADMIN_PASSWORD, EDGE_DEVICE_KEY thật
```

### 1.2 Chạy AI Service (Python, chỉ phục vụ đăng ký khuôn mặt)

```bash
cd AIOT/server/ai
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
```

### 1.3 Chạy server (Node/Express + SQLite + trang quản lý)

```bash
cd AIOT/server
npm run dev
```
- Trang quản lý: `http://localhost:3001/` (đăng nhập bằng `ADMIN_PASSWORD`)
- Health check: `http://localhost:3001/api/health`
- File SQLite tự tạo tại `AIOT/server/data/attendance.db` lúc khởi động lần đầu.

### 1.4 Đăng ký người dùng + khuôn mặt

Vào trang quản lý → tab **"Đăng ký khuôn mặt"** → nhập mã người dùng + họ tên
→ bật camera hoặc chọn ảnh có sẵn → chụp/chọn → **Lưu khuôn mặt**. Lặp lại cho
từng người cần điểm danh ra/vào phòng lab.

### 1.5 Xác định IP laptop trên card Ethernet chia sẻ Internet (ICS)

```powershell
ipconfig | findstr /C:"192.168.137"
```

## 2. Chuẩn bị trên Orange Pi PC

Cắm Logitech C920 vào cổng USB, nối cáp Ethernet trực tiếp vào laptop, đăng
nhập Orange Pi (SSH hoặc console).

### 2.1 Kiểm tra camera trước khi cài gì cả
```bash
lsusb                                   # phải thấy 046d:08e5 (Logitech C920 PRO)
v4l2-ctl --list-devices
ls -la /dev/video*
```
Nếu chưa có `v4l2-ctl`: `sudo apt update && sudo apt install -y v4l-utils`.

### 2.2 Lấy code sang Orange Pi

Cách A — từ laptop, dùng script đóng gói + rsync (khuyến nghị):
```bash
# trên laptop, từ thư mục gốc của project (nơi chứa thư mục AIOT/)
ORANGE_PI_HOST=<ip-hoac-hostname-cua-orange-pi> ORANGE_PI_USER=<user-ssh> \
  bash AIOT/scripts/deploy_edge.sh
```

Cách B — thủ công, KHÔNG cần SSH/rsync (copy qua USB/thẻ SD/dây cáp):
```bash
# Trên Orange Pi
sudo mkdir -p /opt/face-attendance-edge
sudo chown $(whoami) /opt/face-attendance-edge
# Copy nội dung AIOT/edge/, AIOT/scripts/, AIOT/systemd/, AIOT/.env.example
# vào /opt/face-attendance-edge (model .onnx đã có sẵn trong edge/model/)
```

### 2.3 Cài dependency (chỉ apt, không mù quáng pip install)
```bash
cd /opt/face-attendance-edge     # trên máy dev chính là thư mục AIOT/
bash scripts/install_edge.sh
```

### 2.4 Cấu hình
```bash
cp .env.example .env
nano .env
```
Chỉnh tối thiểu:
- `CAMERA_DEVICE` — đúng node camera xác định ở bước 2.1.
- `SERVER_BASE_URL` — IP thật của laptop (mặc định `http://192.168.137.1:3001`).
- `EDGE_DEVICE_KEY` — phải khớp `EDGE_DEVICE_KEY` trong `AIOT/server/.env` trên laptop.
- `DEVICE_ID` — ví dụ `ORANGE_PI_PC_01`.

### 2.5 Cho user chạy service quyền truy cập camera
```bash
sudo usermod -aG video $(whoami)
# đăng xuất/đăng nhập lại (hoặc reboot) để group có hiệu lực
```

## 3. Kiểm thử trước khi chạy qua systemd

### A. Camera
```bash
bash scripts/test_camera.sh
```

### B. AI — chạy thủ công để xem log trực tiếp
```bash
bash scripts/run_edge.sh
```
Theo dõi log:
- `Đã load model face recognition qua cv2.dnn (...)` — **cần xác nhận trên
  phần cứng thật**; nếu lỗi, chuyển `EMBEDDING_BACKEND=remote` rồi chạy lại.
- `Đã nạp trạng thái ra/vào gần nhất cho N người dùng` — edge đã đồng bộ
  trạng thái check_in/check_out từ server lúc khởi động.
- Đứng trước camera: log `Đã gửi sự kiện: <mã> check_in (...)`. Đứng trước
  camera lần nữa (sau khi hết cooldown) phải ra `check_out` (toggle).

### C. Stream debug
```
http://<IP_ORANGE_PI>:5000/
http://<IP_ORANGE_PI>:5000/video_feed
http://<IP_ORANGE_PI>:5000/health
```

### D. Network
- Rút cáp mạng ngắn hạn trong lúc `run_edge.sh` đang chạy — log phải hiện lỗi
  gửi sự kiện/tải face-data nhưng **tiến trình không crash**, camera vẫn chạy.
- Cắm lại — log quay lại gửi được bình thường, không cần khởi động lại.

### E. Resource
```bash
top -o %MEM
```
Dừng bằng `Ctrl+C`, kiểm tra `v4l2-ctl -d /dev/videoX --all` để chắc camera
được nhả ra.

## 4. Chạy production qua systemd (Orange Pi)
```bash
sudo cp systemd/face-attendance-edge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now face-attendance-edge
journalctl -u face-attendance-edge -f
```

## 5. Giới hạn còn lại của PoC

- Chưa xác nhận 100% `cv2.dnn.readNetFromONNX` chạy được với `w600k_mbf.onnx`
  trên phần cứng thật — cần chạy mục 3.B; đã có fallback `remote`.
- Không có liveness/chống giả mạo (bỏ khỏi PoC này, cả trên edge lẫn AI Service).
- 1 thiết bị, 1 cửa, 1 camera — không quản lý nhiều Orange Pi/nhiều cửa.
- Toggle check_in/check_out là suy luận đơn giản (lần thấy mặt kế tiếp = đảo
  trạng thái) — nếu 2 người đi sát nhau bị nhận nhầm liên tục, hoặc một người
  "quên checkout" rồi hôm sau mới xuất hiện lại, hệ thống vẫn coi đó là lượt
  toggle tiếp theo (không có xử lý "khác ngày reset lại trạng thái").
- Không đồng bộ offline phức tạp: mất mạng thì sự kiện lúc đó bị bỏ (log lỗi),
  không có hàng đợi bền vững ghi đĩa trên edge.
- Xác thực bằng 1 device key tĩnh (thiết bị) + 1 mật khẩu admin tĩnh (trang
  quản lý) — không phải cơ chế cấp phát/xoay khoá cho production.
- SQLite: phù hợp quy mô PoC (1 phòng lab, vài chục/vài trăm người) — không
  phù hợp nếu sau này mở rộng nhiều thiết bị ghi đồng thời liên tục.
