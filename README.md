# AttendanceSystem — Điểm danh ra/vào phòng lab bằng khuôn mặt

Camera gắn trên thiết bị biên (Raspberry Pi 5) tự nhận diện khuôn mặt và ghi nhận
**check-in / check-out**. Server (máy tính riêng) lưu dữ liệu và cung cấp trang quản
trị để đăng ký khuôn mặt, xem lịch sử ra/vào.

```
                ZeroTier (mạng riêng ảo)
 ┌──────────────────────────┐        ┌──────────────────────────────────┐
 │ Raspberry Pi 5 (edge)    │  HTTP  │ Máy chạy server (Docker)         │
 │ Camera → nhận diện tại   │ ─────▶ │ web :3001  trang quản trị + API  │
 │ chỗ → gửi sự kiện VÀO/RA │        │ ai  :8001  trích embedding       │
 │ Màn hình kiosk (HDMI)    │        │ SQLite                           │
 └──────────────────────────┘        └──────────────────────────────────┘
```

## Mục lục

1. [Cấu trúc thư mục](#cấu-trúc-thư-mục)
2. [Yêu cầu](#yêu-cầu)
3. [Bắt đầu nhanh](#bắt-đầu-nhanh)
4. [Cấu hình `.env`](#cấu-hình-env)
5. [Server](#server)
6. [Edge (Raspberry Pi)](#edge-raspberry-pi)
7. [Mạng và quyền truy cập](#mạng-và-quyền-truy-cập)
8. [Sử dụng hằng ngày](#sử-dụng-hằng-ngày)
9. [Xử lý sự cố](#xử-lý-sự-cố)
10. [Cách hệ thống hoạt động](#cách-hệ-thống-hoạt-động)

## Cấu trúc thư mục

```
AttendanceSystem/
├── docker-compose.yml    Đóng gói server: web (3001) + ai (8001)
├── server/               Chạy trên máy server
│   ├── backend/          Node/Express API + SQLite, phục vụ luôn bản build frontend
│   ├── frontend/         Trang quản trị React + Vite
│   └── ai/               FastAPI: kiểm tra ảnh + trích embedding EdgeFace khi đăng ký
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
│   └── tests/            unittest
└── docs/                 Kiến trúc đề xuất + sơ đồ
```

## Yêu cầu

**Máy chạy server** (Windows / Linux / macOS):

| Phần mềm | Ghi chú |
|---|---|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) (hoặc Docker Engine + Compose) | Cách chạy khuyên dùng |
| [ZeroTier One](https://www.zerotier.com/download/) | Để Pi kết nối tới server |
| Git, và **Git Bash** nếu dùng Windows | Để chạy script deploy edge |
| Node.js 22+, Python 3.11 | Chỉ cần khi chạy server **không** qua Docker |

**Thiết bị biên:** Raspberry Pi 5 (đã thử với 8GB), Raspberry Pi OS 64-bit (Debian 13),
Camera Module 3 cắm cổng CSI, màn hình HDMI (tuỳ chọn, cho kiosk). Pi cần có Internet.

## Bắt đầu nhanh

Làm theo đúng thứ tự. Phần chi tiết của từng bước nằm ở các mục bên dưới.

**Bước 1 — Dựng server**

```bash
git clone https://github.com/hicastaw/AttendanceSystem.git
cd AttendanceSystem
cp server/backend/.env.example server/backend/.env
# Sửa ADMIN_PASSWORD và EDGE_DEVICE_KEY trong server/backend/.env (xem mục Cấu hình .env)
docker compose up -d --build
```

Mở http://localhost:3001 và đăng nhập bằng `ADMIN_PASSWORD` vừa đặt.

**Bước 2 — Vào mạng ZeroTier.** Cài ZeroTier trên máy server, join network của nhóm
(hỏi người quản lý network ID), chờ được duyệt trên https://my.zerotier.com. Ghi lại
IP ZeroTier của máy server (`10.115.62.x`). Xem [Mạng và quyền truy cập](#mạng-và-quyền-truy-cập).

**Bước 3 — Mở firewall** cổng 3001/8001 cho mạng ZeroTier trên máy server.
Xem [Firewall](#firewall-trên-máy-server).

**Bước 4 — Cài edge lên Pi** (từ máy của bạn, trong Git Bash):

```bash
SSH_KEY=~/.ssh/<key-cua-ban> bash edge/scripts/deploy_edge.sh
```

Sau đó SSH vào Pi, sửa `~/face-attendance-edge/.env`: `SERVER_BASE_URL` = IP ZeroTier
của máy server, `EDGE_DEVICE_KEY` **giống hệt** bên server. Rồi bật service:

```bash
sudo cp ~/face-attendance-edge/systemd/face-attendance-edge.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now face-attendance-edge
```

**Bước 5 — Đăng ký khuôn mặt** trên trang quản trị (tab *Người dùng & khuôn mặt*),
rồi chạy `sudo systemctl restart face-attendance-edge` trên Pi để edge tải ngay.

**Bước 6 — Kiểm tra.** Đứng trước camera → xem `http://<IP_PI>:5000/kiosk` hoặc màn
hình kiosk → sự kiện xuất hiện ở tab *Lịch sử ra/vào*.

## Cấu hình `.env`

Có **2 file `.env` riêng**, không commit lên git (đã có trong `.gitignore`):

| File | Nằm ở | Tạo từ |
|---|---|---|
| Server | `server/backend/.env` | `server/backend/.env.example` |
| Edge | `~/face-attendance-edge/.env` trên Pi | `edge/.env.example` (script deploy tự tạo) |

Tạo chuỗi ngẫu nhiên cho mật khẩu/khoá:

```bash
openssl rand -hex 24      # hoặc: python -c "import secrets; print(secrets.token_hex(24))"
```

### Server — `server/backend/.env`

| Biến | Bắt buộc sửa | Ý nghĩa |
|---|---|---|
| `ADMIN_PASSWORD` | **Có** | Mật khẩu đăng nhập trang quản trị |
| `EDGE_DEVICE_KEY` | **Có** | Khoá bí mật dùng chung với Pi. **Phải giống hệt** `EDGE_DEVICE_KEY` của edge |
| `PORT` | Không | Port backend, mặc định `3001` |
| `AI_SERVICE_URL` | Không | Địa chỉ AI service. Khi chạy Docker được tự đặt thành `http://ai:8001` |
| `DB_PATH` | Không | File SQLite. Khi chạy Docker nằm trong volume `web-data` |

Sau khi sửa: `docker compose up -d` để container nhận giá trị mới.

### Edge — `~/face-attendance-edge/.env` trên Pi

| Biến | Bắt buộc sửa | Ý nghĩa |
|---|---|---|
| `SERVER_BASE_URL` | **Có** | `http://<IP ZeroTier máy server>:3001` |
| `EDGE_DEVICE_KEY` | **Có** | Giống hệt bên server |
| `CAMERA_BACKEND` | Kiểm tra | `rpicam` cho Camera Module 3 (CSI), `v4l2` cho webcam USB |
| `DEVICE_ID` | Nên sửa nếu có nhiều Pi | Tên thiết bị hiện trong lịch sử ra/vào |
| `AI_SERVICE_URL` | Không | Chỉ dùng cho chế độ legacy `EMBEDDING_BACKEND=remote` |
| `SIMILARITY_THRESHOLD` | Không | Ngưỡng nhận diện, mặc định `0.60` |
| `ATTENDANCE_COOLDOWN_SECONDS` | Không | Khoảng cách tối thiểu giữa 2 lần ghi của cùng 1 người, mặc định `60` |
| `FACE_DATA_REFRESH_SECONDS` | Không | Chu kỳ tải lại danh sách khuôn mặt từ server, mặc định `300` |
| `STREAM_PORT` | Không | Port stream/kiosk/health, mặc định `5000` |

Sau khi sửa: `sudo systemctl restart face-attendance-edge`.

## Server

### Chạy bằng Docker (khuyên dùng)

```bash
docker compose up -d --build      # build + chạy nền
docker compose logs -f            # xem log
docker compose down               # dừng (giữ dữ liệu)
```

| Container | Nội dung | Port |
|---|---|---|
| `attendance-web` | Frontend (đã build) + backend Express + SQLite | 3001 |
| `attendance-ai` | FastAPI trích embedding EdgeFace | 8001 |

Dữ liệu SQLite nằm trong Docker volume `web-data`, không mất khi rebuild/restart.
`docker compose down -v` sẽ **xoá luôn dữ liệu**.

Sao lưu / khôi phục database:

```bash
docker cp attendance-web:/app/backend/data/attendance.db ./attendance-backup.db
docker cp ./attendance-backup.db attendance-web:/app/backend/data/attendance.db && docker compose restart web
```

### Chạy không dùng Docker (khi phát triển)

```bash
# Backend
cd server/backend
cp .env.example .env
npm install
npm start                     # http://localhost:3001

# Frontend — hot reload, tự proxy /api sang 3001
cd server/frontend
npm install
npm run dev                   # http://localhost:5173
npm run build                 # build xong, backend phục vụ luôn tại :3001

# AI service (terminal khác)
cd server/ai
python -m venv .venv && .venv/Scripts/activate   # Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
```

## Edge (Raspberry Pi)

### Chuẩn bị Pi mới (một lần)

1. Flash **Raspberry Pi OS 64-bit** bằng Raspberry Pi Imager: đặt hostname, user,
   mật khẩu, bật SSH (dán public key nếu muốn đăng nhập bằng key).
2. Cắm Camera Module 3 vào cổng CSI, kiểm tra: `rpicam-hello --list-cameras` phải
   liệt kê `imx708`.
3. Cài ZeroTier và join network (xem [ZeroTier](#zerotier)).
4. Gói hệ thống cần có (thường đã có sẵn): `sudo apt install -y python3-venv rpicam-apps`.

### Cài đặt / cập nhật code

Chạy **từ máy của bạn** (Git Bash trên Windows), ở thư mục gốc repo:

```bash
SSH_KEY=~/.ssh/<key-cua-ban> bash edge/scripts/deploy_edge.sh
```

Script đẩy `edge/` tới `raspberrypi@10.115.62.222:~/face-attendance-edge`, cài `.venv`
bằng pip (không cần sudo) và tạo `.env` từ `.env.example` nếu chưa có. Script **không
ghi đè** `.env`, `.venv`, `data/` đã có trên Pi.

- Đổi Pi đích: `EDGE_HOST=<ip> EDGE_USER=<user> bash edge/scripts/deploy_edge.sh`
- Đăng nhập bằng mật khẩu: bỏ `SSH_KEY=...` (sẽ phải nhập mật khẩu vài lần).
- Sau khi cập nhật code: `sudo systemctl restart face-attendance-edge`.

### Chạy

```bash
cd ~/face-attendance-edge
bash scripts/test_camera.sh               # kiểm tra camera
.venv/bin/python3 main.py --live-test     # thử nhận diện, KHÔNG ghi điểm danh (port 8080)
.venv/bin/python3 main.py                 # điểm danh thật (port 5000), Ctrl+C để dừng
```

Chạy nền khi Pi khởi động (service đã đặt sẵn đường dẫn `/home/raspberrypi/face-attendance-edge`;
user khác thì sửa `User=`, `Group=` và đường dẫn trong file service):

```bash
sudo cp systemd/face-attendance-edge.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now face-attendance-edge
journalctl -u face-attendance-edge -f     # xem log
```

Không chạy `main.py` bằng tay khi service đang chạy — hai tiến trình sẽ tranh camera.

| Địa chỉ trên Pi (port 5000) | Nội dung |
|---|---|
| `/` | Trang debug: video + chỉ số + kết quả nhận diện |
| `/kiosk` | Giao diện kiosk: video toàn màn hình + "Xin chào / Tạm biệt" |
| `/health` | JSON trạng thái camera, model, kết nối server |

Thử nhận diện bằng ảnh (không cần camera):
`.venv/bin/python3 recognize_image.py <ảnh|thư mục>` — thêm `--dry-run` để không gửi sự kiện.

Chạy test: `.venv/bin/python3 -m unittest discover -s tests`.

### Màn hình kiosk

Màn hình HDMI gắn với Pi hiển thị trang `/kiosk` bằng Chromium toàn màn hình:

```bash
sudo apt install -y chromium                         # một lần
~/face-attendance-edge/scripts/kiosk.sh &            # mở ngay (chạy được từ SSH)

# Tự mở mỗi khi Pi khởi động vào desktop
mkdir -p ~/.config/labwc
echo '/home/raspberrypi/face-attendance-edge/scripts/kiosk.sh >/tmp/kiosk.log 2>&1 &' >> ~/.config/labwc/autostart
```

Thoát kiosk: `Alt+F4`, hoặc `pkill -f attendance-kiosk` qua SSH.

Xem/điều khiển màn hình Pi từ laptop: `sudo apt install -y wayvnc && sudo raspi-config nonint do_vnc 0`
trên Pi, rồi dùng [RealVNC Viewer](https://www.realvnc.com/en/connect/download/viewer/)
kết nối `<IP_PI>` bằng user/mật khẩu của Pi. Chỉ cần xem: mở `http://<IP_PI>:5000/kiosk`.

## Mạng và quyền truy cập

### ZeroTier

Pi và máy server nằm chung một mạng ZeroTier nên Pi cắm vào bất kỳ mạng nào có
Internet đều kết nối được, IP không đổi.

| Thiết bị | IP ZeroTier hiện tại |
|---|---|
| Raspberry Pi (`attendance-pi`) | `10.115.62.222` |
| Laptop chạy server | `10.115.62.233` |

Thêm một máy vào mạng:

1. Cài ZeroTier: Windows/macOS tải ở https://www.zerotier.com/download,
   Linux/Pi: `curl -s https://install.zerotier.com | sudo bash`.
2. Join: `sudo zerotier-cli join <NETWORK_ID>` (Windows: icon ZeroTier → *Join New Network*).
   Hỏi người quản lý network ID.
3. Người quản lý vào https://my.zerotier.com → network → *Members* → tick **Authorized**,
   nên gán IP cố định và đặt tên thiết bị.
4. Kiểm tra IP: `sudo zerotier-cli listnetworks`.

Đổi máy chạy server → cập nhật `SERVER_BASE_URL` trong `.env` của Pi theo IP ZeroTier mới.

### SSH vào Pi

```bash
ssh raspberrypi@10.115.62.222
```

Pi hiện cho phép đăng nhập bằng mật khẩu và SSH key (hỏi người quản lý). Để dùng key
của mình, sau khi vào được Pi lần đầu:

```bash
# Trên máy của bạn (tạo key nếu chưa có): ssh-keygen -t ed25519
# Trên Pi: dán nội dung file ~/.ssh/id_ed25519.pub của bạn
echo "<public key>" >> ~/.ssh/authorized_keys
```

### Firewall trên máy server

Pi là bên **chủ động gọi** tới server, nên máy server phải cho phép kết nối vào cổng
3001/8001 — kể cả khi đã có VPN. Chỉ cần mở cho dải ZeroTier `10.115.62.0/24`.

**Windows + Docker Desktop** (WSL `networkingMode=mirrored`) — PowerShell *Run as administrator*:

```powershell
New-NetFirewallHyperVRule -Name AttendanceSystem -DisplayName "AttendanceSystem web+ai" -Direction Inbound -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -Protocol TCP -LocalPorts 3001,8001 -RemoteAddresses 10.115.62.0/24 -Action Allow
New-NetFirewallRule -DisplayName "AttendanceSystem web+ai" -Direction Inbound -Protocol TCP -LocalPort 3001,8001 -RemoteAddress 10.115.62.0/24 -Action Allow -Profile Any
```

Gỡ: `Remove-NetFirewallHyperVRule -Name AttendanceSystem; Remove-NetFirewallRule -DisplayName "AttendanceSystem web+ai"`.

**Linux (ufw):** `sudo ufw allow from 10.115.62.0/24 to any port 3001,8001 proto tcp`.

Kiểm tra từ Pi: `curl http://<IP_SERVER>:3001/api/health` phải trả `{"status":"ok",...}`.
Trên Windows mirrored, máy server không gọi được chính IP ZeroTier của nó — đó là bình
thường, trên máy server dùng `localhost`.

## Sử dụng hằng ngày

- **Đăng ký người mới:** trang quản trị → *Người dùng & khuôn mặt* → nhập mã + họ tên
  → chụp/tải ảnh rõ mặt, nhìn thẳng, đủ sáng → *Lưu khuôn mặt*. Edge tự tải lại danh
  sách mỗi `FACE_DATA_REFRESH_SECONDS` (mặc định 5 phút); muốn nhận ngay thì
  `sudo systemctl restart face-attendance-edge`.
- **VÀO/RA:** mỗi lần được nhận diện, trạng thái người đó được đảo (VÀO → RA → VÀO…),
  cách nhau ít nhất `ATTENDANCE_COOLDOWN_SECONDS` (mặc định 60 giây).
- **"Cần đăng ký lại"** trên trang quản trị: khuôn mặt được tạo bằng model cũ, edge sẽ
  bỏ qua — đăng ký lại ảnh cho người đó.
- **Đổi model nhận diện:** phải thay ở **cả** `edge/model` và `server/ai/model` (cùng
  file), cập nhật code tiền xử lý ở cả hai phía cho khớp, rồi đăng ký lại toàn bộ khuôn mặt.

## Xử lý sự cố

| Hiện tượng | Kiểm tra / cách xử lý |
|---|---|
| Pi không gọi được server (`server_reachable: false`, log `Không tải được face-data`) | Từ Pi: `curl http://<IP_SERVER>:3001/api/health`. Không được → container chưa chạy (`docker compose ps`), firewall chưa mở, hoặc máy server/Pi chưa online trên ZeroTier |
| Server trả `401 Device key không hợp lệ` | `EDGE_DEVICE_KEY` hai bên không khớp |
| Edge báo `Embedding server chưa xác minh cùng EdgeFace` | Server chưa build bản mới hoặc model hai bên khác nhau → `docker compose up -d --build`, đăng ký lại khuôn mặt |
| Log `faces=0` mãi | Camera không thấy mặt: xem `http://<IP_PI>:5000/`, chỉnh góc camera, thêm ánh sáng |
| Người đã đăng ký nhưng hiện `Unknown` | Chưa tới chu kỳ tải lại (restart service), ảnh đăng ký kém, hoặc ánh sáng/góc quá khác ảnh đăng ký |
| `Thiếu rpicam-vid` / camera không mở | `rpicam-hello --list-cameras`; kiểm tra cáp CSI; `CAMERA_BACKEND=rpicam` trong `.env` |
| Service không chạy | `systemctl status face-attendance-edge`, `journalctl -u face-attendance-edge -n 50` |
| Màn hình kiosk trống | Edge chưa chạy (`curl localhost:5000/health` trên Pi); xem `/tmp/kiosk.log` |
| Pi đổi mạng xong không SSH được | Chờ 1–2 phút cho Pi khởi động và ZeroTier kết nối; Pi cần có Internet ở mạng mới |

## Cách hệ thống hoạt động

1. Admin đăng ký khuôn mặt trên trang quản trị → AI service trích embedding EdgeFace →
   lưu vào SQLite kèm metadata `pipeline` (sha256 model + cách tiền xử lý).
2. Edge tải danh sách embedding (`GET /api/face-data`) và trạng thái ra/vào gần nhất
   (`GET /api/last-state`) khi khởi động, làm mới định kỳ.
3. Edge nhận diện tại chỗ trên CPU của Pi (~25ms/khuôn mặt), đảo trạng thái vào/ra theo
   từng người, gửi `POST /api/access-events`.
4. Admin xem lịch sử ra/vào trên trang quản trị.

Edge xác thực với server bằng header `X-Device-Key`. Server và edge **phải dùng cùng
model** (`edgeface_xs_gamma_06.onnx`) và cùng cách align/tiền xử lý; `/api/face-data`
chỉ trả embedding đúng pipeline hiện tại, edge từ chối dữ liệu không khớp.

Kiến trúc đề xuất chi tiết: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
