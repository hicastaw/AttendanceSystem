# AttendanceSystem — Điểm danh ra/vào phòng lab bằng khuôn mặt

Camera gắn trên thiết bị biên (Raspberry Pi) tự nhận diện khuôn mặt và ghi nhận
check-in / check-out. Server trên máy tính lưu dữ liệu và cung cấp trang quản trị.

```
AttendanceSystem/
├── edge/                 Chạy trên Raspberry Pi 5 + Camera Module 3
│   ├── main.py           Vòng lặp: camera → detect → embedding → so khớp → gửi sự kiện
│   ├── config.py         Đọc cấu hình từ .env
│   ├── camera.py         Camera CSI (rpicam-vid) hoặc USB (V4L2)
│   ├── face_detector.py, face_recognizer.py   YuNet + EdgeFace (ONNX Runtime)
│   ├── attendance_service.py   Quyết định check_in/check_out + cooldown
│   ├── api_client.py     Gửi sự kiện về server (thread nền)
│   ├── stream_server.py  Stream MJPEG + /kiosk + /health (port 5000)
│   ├── recognize_image.py   Nhận diện từ file ảnh (thử nghiệm không cần camera)
│   ├── enroll_faces.py, local_enrollment.py   Kho khuôn mặt cục bộ cho --live-test
│   ├── model/            face_detection_yunet_2023mar + edgeface_xs_gamma_06
│   ├── scripts/          install / deploy / run / test_camera / kiosk
│   ├── systemd/          Service tự chạy khi Pi khởi động
│   ├── tests/            unittest
│   └── .env.example
├── docker-compose.yml    Đóng gói server: web (3001) + ai (8001)
├── server/               Chạy trên máy tính
│   ├── backend/          Node/Express API + SQLite (port 3001), phục vụ luôn bản build frontend
│   ├── frontend/         Trang quản trị React + Vite (src/pages, src/components, src/api)
│   └── ai/               FastAPI: validate ảnh + trích embedding khi đăng ký (port 8001)
└── docs/
    ├── ARCHITECTURE.md   Kiến trúc đề xuất
    └── assets/           Sơ đồ kiến trúc
```

## Luồng hoạt động

1. Admin tạo người dùng và đăng ký ảnh khuôn mặt trên trang quản trị → AI service
   trích embedding → lưu vào SQLite.
2. Edge tải danh sách embedding (`GET /api/face-data`) và trạng thái ra/vào gần nhất
   (`GET /api/last-state`) khi khởi động, làm mới định kỳ.
3. Edge nhận diện tại chỗ, đảo trạng thái vào/ra theo từng người (cooldown 60s),
   gửi `POST /api/access-events`.
4. Admin xem log ra/vào trên trang quản trị.

Edge xác thực với server bằng header `X-Device-Key`, giá trị phải khớp
`EDGE_DEVICE_KEY` ở cả `edge/.env` và `server/backend/.env`.

**Model nhận diện phải giống nhau ở hai phía.** Server (`server/ai`) và edge cùng
dùng `edgeface_xs_gamma_06.onnx` với cùng cách align/tiền xử lý. Mỗi embedding được
lưu kèm `pipeline` (sha256 model + preprocessing); `/api/face-data` chỉ trả embedding
đúng pipeline hiện tại và edge từ chối dữ liệu không khớp. Khi đổi model, phải đổi
ở cả hai nơi rồi đăng ký lại khuôn mặt (trang quản trị hiện "Cần đăng ký lại").

## Chạy server bằng Docker (khuyên dùng)

```bash
cp server/backend/.env.example server/backend/.env   # đặt ADMIN_PASSWORD, EDGE_DEVICE_KEY
docker compose up -d --build
```

| Container | Nội dung | Port |
|---|---|---|
| `attendance-web` | Frontend (đã build) + backend Express + SQLite | 3001 |
| `attendance-ai` | FastAPI trích embedding | 8001 |

- Trang quản trị: http://localhost:3001
- Dữ liệu SQLite nằm trong Docker volume `web-data`, không mất khi rebuild/restart.
- Xem log: `docker compose logs -f` — dừng: `docker compose down`
  (thêm `-v` sẽ **xoá luôn dữ liệu**).

Edge không chạy trong Docker — nó chạy trực tiếp trên Pi bằng systemd vì cần camera.

## Chạy server không dùng Docker (khi phát triển)

```bash
# Backend
cd server/backend
cp .env.example .env          # đặt ADMIN_PASSWORD, EDGE_DEVICE_KEY
npm install
npm start                     # API: http://localhost:3001

# Frontend — khi phát triển (hot reload, proxy /api sang 3001)
cd server/frontend
npm install
npm run dev                   # http://localhost:5173

# Frontend — khi triển khai: build xong, backend phục vụ luôn tại http://localhost:3001
npm run build

# AI service (terminal khác)
cd server/ai
python -m venv .venv && .venv/Scripts/activate   # Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
```

## Triển khai edge (Raspberry Pi)

```bash
# Từ máy tính (Git Bash): đẩy edge/ tới raspberrypi@10.115.62.222:~/face-attendance-edge,
# cài .venv (pip, không cần sudo) và tạo .env nếu chưa có
bash edge/scripts/deploy_edge.sh

# Trên Pi
cd ~/face-attendance-edge
nano .env                     # SERVER_BASE_URL, EDGE_DEVICE_KEY, CAMERA_BACKEND=rpicam
bash scripts/test_camera.sh
.venv/bin/python3 main.py --live-test   # thử camera + nhận diện, KHÔNG ghi điểm danh (port 8080)
.venv/bin/python3 main.py               # chạy điểm danh thật (port 5000), Ctrl+C để dừng

# Chạy nền khi Pi khởi động
sudo cp systemd/face-attendance-edge.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now face-attendance-edge
journalctl -u face-attendance-edge -f
```

| Địa chỉ trên Pi (port 5000) | Nội dung |
|---|---|
| `/` | Trang debug: video + chỉ số + kết quả nhận diện |
| `/kiosk` | Giao diện màn hình kiosk: video toàn màn hình + "Xin chào / Tạm biệt" |
| `/health` | JSON trạng thái camera, model, server |

Thử nhận diện bằng ảnh (không cần camera): `.venv/bin/python3 recognize_image.py <ảnh|thư mục>`
— thêm `--dry-run` để không gửi sự kiện.

### Màn hình kiosk

Màn hình HDMI gắn với Pi hiển thị trang `/kiosk` bằng Chromium toàn màn hình:

```bash
sudo apt install -y chromium                         # một lần
~/face-attendance-edge/scripts/kiosk.sh &            # mở ngay (chạy được từ SSH)

# Tự mở mỗi khi Pi khởi động vào desktop
echo '/home/raspberrypi/face-attendance-edge/scripts/kiosk.sh >/tmp/kiosk.log 2>&1 &' >> ~/.config/labwc/autostart
```

Thoát kiosk: `Alt+F4`, hoặc `pkill -f attendance-kiosk` qua SSH. Xem màn hình Pi từ
laptop: bật VNC (`sudo apt install -y wayvnc && sudo raspi-config nonint do_vnc 0`)
rồi dùng RealVNC Viewer kết nối `10.115.62.222`.

## Kết nối mạng

Pi và máy chạy server cùng nằm trong một mạng ZeroTier, nên Pi cắm vào bất kỳ
mạng nào có Internet đều kết nối được:

| Thiết bị | IP ZeroTier |
|---|---|
| Raspberry Pi (`attendance-pi`) | `10.115.62.222` |
| Laptop chạy server | `10.115.62.233` |

`SERVER_BASE_URL` trong `edge/.env` nên trỏ tới IP ZeroTier của máy chạy server,
ví dụ `http://10.115.62.233:3001`.

Máy chạy server phải cho phép kết nối vào cổng 3001/8001 từ mạng ZeroTier. Trên
Windows chạy Docker Desktop với WSL `networkingMode=mirrored`, mở bằng PowerShell
(Run as administrator):

```powershell
New-NetFirewallHyperVRule -Name AttendanceSystem -DisplayName "AttendanceSystem web+ai" -Direction Inbound -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -Protocol TCP -LocalPorts 3001,8001 -RemoteAddresses 10.115.62.0/24 -Action Allow
New-NetFirewallRule -DisplayName "AttendanceSystem web+ai" -Direction Inbound -Protocol TCP -LocalPort 3001,8001 -RemoteAddress 10.115.62.0/24 -Action Allow -Profile Any
```
