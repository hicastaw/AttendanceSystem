# AttendanceSystem — Điểm danh ra/vào phòng lab bằng khuôn mặt

Camera gắn trên thiết bị biên (Raspberry Pi) tự nhận diện khuôn mặt và ghi nhận
check-in / check-out. Server trên máy tính lưu dữ liệu và cung cấp trang quản trị.

```
AttendanceSystem/
├── edge/                 Chạy trên Raspberry Pi
│   ├── main.py           Vòng lặp: camera → detect → embedding → so khớp → gửi sự kiện
│   ├── config.py         Đọc cấu hình từ .env
│   ├── camera.py, face_detector.py, face_recognizer.py
│   ├── attendance_service.py   Quyết định check_in/check_out + cooldown
│   ├── api_client.py     Gửi sự kiện về server (thread nền)
│   ├── stream_server.py  Stream MJPEG debug + /health (port 5000)
│   ├── model/            YuNet (detect) + w600k_mbf (embedding 512-D)
│   ├── scripts/          install / deploy / run / test_camera
│   ├── systemd/          Service tự chạy khi Pi khởi động
│   └── .env.example
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
`EDGE_DEVICE_KEY` ở cả `edge/.env` và `server/.env`.

## Chạy server (máy tính)

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
# Từ máy tính (cần ssh + rsync), mặc định đẩy tới raspberrypi@10.115.62.222
bash edge/scripts/deploy_edge.sh

# Trên Pi
cd /opt/face-attendance-edge
cp .env.example .env          # sửa SERVER_BASE_URL, EDGE_DEVICE_KEY, CAMERA_DEVICE
bash scripts/test_camera.sh
bash scripts/run_edge.sh      # chạy thử thủ công
sudo systemctl enable --now face-attendance-edge
journalctl -u face-attendance-edge -f
```

Debug stream: `http://<IP_PI>:5000/` — health: `http://<IP_PI>:5000/health`.

## Kết nối mạng

Pi và máy chạy server cùng nằm trong một mạng ZeroTier, nên Pi cắm vào bất kỳ
mạng nào có Internet đều kết nối được:

| Thiết bị | IP ZeroTier |
|---|---|
| Raspberry Pi (`attendance-pi`) | `10.115.62.222` |
| Laptop chạy server | `10.115.62.233` |

`SERVER_BASE_URL` trong `edge/.env` nên trỏ tới IP ZeroTier của máy chạy server,
ví dụ `http://10.115.62.233:3001`.
