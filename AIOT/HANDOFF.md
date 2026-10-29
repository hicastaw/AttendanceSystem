# Bàn giao và tiến độ hiện tại — AIOT Lab Access

> Cập nhật trạng thái: **14-10-2026 (Asia/Saigon)**. Nguồn chi tiết, bằng chứng kiểm thử và danh sách giới hạn: [SOFTWARE_IMPLEMENTATION_REPORT.md](../SOFTWARE_IMPLEMENTATION_REPORT.md). Nội dung PoC/Orange Pi PC bên dưới là lịch sử triển khai; không dùng nó để khẳng định trạng thái phần cứng của phiên bản hiện tại.

## Trạng thái hiện tại

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| MVP AIOT trên laptop Windows | `DONE_VERIFIED` | Backend SQLite, admin, kiosk, outbox/retry và luồng mô phỏng end-to-end đã được kiểm thử cục bộ. |
| Nghiệp vụ điểm danh | `DONE_VERIFIED` | Chỉ ghi nhận **đến** theo sự kiện; không thêm check-out mới. Sáng 07:00–12:00, chiều 13:00–18:00, T2–T7 (UTC+7); ngoài sự kiện vẫn lưu timestamp với context null. |
| Kiểm thử tự động cục bộ | `DONE_VERIFIED` | Báo cáo 14-10 ghi nhận 127 Python, 11 Node, 2 browser, API smoke và kiểm tra syntax/model đều PASS. Chưa chạy CI từ xa. |
| Enrollment và nhận diện thật | `INCOMPLETE` | Legacy/mock API đã kiểm thử; chưa có enrollment nhiều frame với R50 và 30 người thật, chưa hiệu chỉnh accuracy/threshold. |
| Raspberry Pi 5, Hailo-10H, CSI, màn hình, SSD | `BLOCKED_HARDWARE` | Chưa deploy, HIL, cold boot, soak hoặc đo hiệu năng trên thiết bị. |
| SCRFD/R50, HEF và bộ dữ liệu đánh giá | `BLOCKED_ARTIFACT` | Chưa có checkpoint/model artifact/dataset đủ điều kiện để xác minh hoặc hiệu chỉnh. |
| Deploy/systemd/CI remote | `EXISTS_UNVERIFIED` | Template và kiểm tra syntax có sẵn; chưa xác minh trên Linux/Pi hoặc GitHub Actions. |

## Việc cần làm tiếp theo

1. Cung cấp Pi 5/Hailo/camera/màn hình/SSD và xác minh từng hạng mục theo [báo cáo mục 7](../SOFTWARE_IMPLEMENTATION_REPORT.md#7-hardware-dependent-tasks).
2. Cung cấp artifact SCRFD/R50/HEF hợp lệ cùng dataset có consent để kiểm strict-load, parity và calibration.
3. Trước khi điểm danh người thật: thay/rotate mọi credential demo cũ, chạy HIL, recovery/power-loss và đánh giá accuracy; xem [P0](../SOFTWARE_IMPLEMENTATION_REPORT.md#p0--trước-khi-cho-điểm-danh-người-thật).

---

## Lịch sử PoC Orange Pi PC

> Cập nhật phần mềm 12-10-2026: mục tiêu là quản lý khoảng 30 thành viên, **chỉ điểm danh đến theo sự kiện**, không toggle Vào/Ra. Sáng 07:00–12:00, chiều 13:00–18:00, T2–T7 (UTC+7); ngoài sự kiện vẫn lưu giờ đến với liên kết null. Đã kiểm thử Windows/DB tạm, chưa deploy phần cứng. Xem [báo cáo Mục 4](../docs/SOFTWARE_STEP_04_CHECKIN_ONLY.md) và [prompt đã thực hiện](../docs/PROMPT_SOFTWARE_STEP_04_CHECKIN_ONLY.md). Nội dung PoC bên dưới là lịch sử triển khai, không phải xác nhận HIL cho code mới.

Cập nhật: 29-7-2026

Tài liệu này ghi lại trạng thái thực tế đã triển khai trên laptop và Orange Pi
PC. Đọc thêm `ARCHITECTURE.md` để hiểu thiết kế và `EDGE_DEPLOYMENT.md` để xem
hướng dẫn triển khai đầy đủ từ đầu.

## 1. Phạm vi hệ thống

PoC ghi nhận vào/ra phòng lab bằng khuôn mặt:

```text
Logitech C920
    -> Orange Pi: detect + embedding + cosine match + quyết định vào/ra
    -> HTTP qua LAN
    -> Laptop: Node/Express + SQLite + trang quản lý
```

Toàn bộ code PoC nằm trong `AIOT/`. Khi chạy PoC này không sử dụng `backend/`
và `frontend/` của hệ thống điểm danh gốc.

## 2. Trạng thái đã xác minh

| Hạng mục | Trạng thái | Bằng chứng/ghi chú |
|---|---|---|
| Node server trên laptop | Đạt | Port `3001`, `/api/health` trả JSON |
| AI Service trên laptop | Đạt | Port `8001`, endpoint `/` trả JSON |
| Trang quản lý và SQLite | Đạt | Đăng ký mặt, lưu và xem log được |
| LAN trực tiếp | Đạt | Laptop `192.168.137.1`, Orange Pi nhận IP DHCP |
| Logitech C920 | Đạt | `/dev/video0`, MJPG 640x480 |
| YuNet trên Orange Pi | Đạt | Load và detect được khuôn mặt |
| MobileFaceNet trên ARMv7 | Đạt | `cv2.dnn.readNetFromONNX` load và infer được |
| Đồng bộ embedding | Đạt | Edge tải được embedding từ laptop |
| Nhận diện và gửi event | Đạt | Đã ghi nhận `SV001` vào/ra, confidence 65-75% |
| MJPEG debug stream | Đạt | Port `5000`, có bounding box và cooldown |
| Benchmark hiệu năng | đã làm | Cần đo CPU, RAM, FPS, nhiệt độ và độ trễ |
| systemd/tự khởi động | Chưa làm | Chủ động dừng ở mức PoC chạy thủ công |
| Mất mạng/mất camera | đã làm | Cần kiểm thử lại có ghi chép |

Dữ liệu demo đã quan sát:

- User `SV001`.
- Một event `check_in`, confidence `72.23`.
- Một event `check_out`, confidence `74.85`.
- Sau khi gửi, stream hiện `[cooldown]` và không gửi lặp liên tục.

## 3. Môi trường đã dùng

### Laptop Windows

- Ethernet chia sẻ mạng: `192.168.137.1/24`.
- Node server: port `3001`.
- FastAPI AI Service: port `8001`.
- AI Service dùng CPython Windows 3.12. Không dùng Python MSYS2
  (`C:\msys64\...`) vì pip sẽ cố build OpenCV/Numpy từ source.
- Windows Firewall có inbound rule `AIOT TCP Ports` cho TCP `3001,8001`.

### Orange Pi PC

- Kiến trúc `armhf`/ARMv7, Armbian/Debian Trixie.
- Python hệ thống 3.13.5, OpenCV apt 4.10.0.
- Code deploy tại `/opt/face-attendance-edge`.
- Camera `/dev/video0`.
- IP DHCP đã đổi từ `192.168.137.233` sang `192.168.137.216` sau reboot;
  không coi `.216` là IP cố định. Hiện tại là 162
- MAC quan sát trên laptop: `02-81-48-68-28-72`.

## 4. Khởi động hệ thống hiện tại

### 4.1 AI Service trên laptop

```powershell
cd E:\Project\AttendanceSystem\AIOT\server\ai
.\.venv\Scripts\Activate.ps1
python -m uvicorn main:app --host 0.0.0.0 --port 8001
```

Kiểm tra tại `http://localhost:8001/docs`.

### 4.2 Node server trên laptop

Mở PowerShell thứ hai:

```powershell
cd E:\Project\AttendanceSystem\AIOT\server
npm run dev
```

- Trang quản lý: `http://localhost:3001`.
- Health: `http://localhost:3001/api/health`.

`ADMIN_PASSWORD` và `EDGE_DEVICE_KEY` nằm trong `AIOT/server/.env`. Không ghi
giá trị thật vào tài liệu hoặc commit lên Git.

### 4.3 Tìm IP Orange Pi

Trên laptop:

```powershell
arp -a
```

Tìm IP trong dải `192.168.137.x` có MAC `02-81-48-68-28-72`, sau đó:

```powershell
ssh root@<IP_ORANGE_PI>
```

Nếu có console trên Orange Pi, kiểm tra trực tiếp bằng `hostname -I`.

### 4.4 Chạy edge thủ công

Chỉ chạy một instance:

```bash
cd /opt/face-attendance-edge
bash scripts/run_edge.sh
```

Mở stream trên laptop: `http://<IP_ORANGE_PI>:5000`.

Log đúng phải cho thấy camera `/dev/video0`, hai model, embedding và vòng lặp
camera đều khởi động thành công.

Code mới nhất trong workspace có thêm log similarity mỗi 5 giây tại
`edge/main.py` và giữ lại điểm ứng viên tốt nhất tại
`edge/attendance_service.py`. Copy lại hai file này nếu Orange Pi chưa có bản
mới nhất.

## 5. Cấu hình edge cần kiểm tra

File trên Orange Pi: `/opt/face-attendance-edge/.env`.

```env
CAMERA_DEVICE=/dev/video0
CAMERA_WIDTH=640
CAMERA_HEIGHT=480
CAMERA_FPS=10
CAMERA_FOURCC=MJPG

EMBEDDING_BACKEND=cv2dnn

SERVER_BASE_URL=http://192.168.137.1:3001
AI_SERVICE_URL=http://192.168.137.1:8001
DEVICE_ID=ORANGE_PI_PC_01
EDGE_DEVICE_KEY=<phải khớp AIOT/server/.env trên laptop>
```

Trong quá trình debug đã có lúc hạ ngưỡng và tăng tải xử lý. Kiểm tra giá trị
thực tế trước khi benchmark:

```bash
grep -E '^(PROCESS_EVERY_N_FRAMES|DETECT_WIDTH|DETECTION_SCORE_THRESHOLD|SIMILARITY_THRESHOLD)=' \
  /opt/face-attendance-edge/.env
```

Baseline trong `.env.example`:

```env
PROCESS_EVERY_N_FRAMES=3
DETECT_WIDTH=320
DETECTION_SCORE_THRESHOLD=0.80
SIMILARITY_THRESHOLD=0.60
```

Similarity thực tế trong buổi test khoảng 46-53%. Ngưỡng debug `0.45` giúp
demo chạy nhưng quá thấp để kết luận an toàn. Cần đăng ký lại ảnh đủ sáng, đo
điểm đúng người/sai người rồi mới chốt threshold.

## 6. Benchmark còn phải làm

Đo ít nhất hai kịch bản: không có mặt và có mặt liên tục. Ghi lại cấu hình
`.env` cùng kết quả.

```bash
EDGE_PID=$(pgrep -f 'edge/main.py' | head -n1)
ps -p "$EDGE_PID" -o pid,etime,%cpu,%mem,rss,vsz,cmd
free -h
uptime
awk '{printf "Temperature: %.1f C\n", $1/1000}' \
  /sys/class/thermal/thermal_zone0/temp
curl -s http://127.0.0.1:5000/health
```

Cần ghi FPS, CPU, RSS RAM, nhiệt độ sau 5-10 phút, thời gian từ lúc đưa mặt
vào đến khi server hiện event, confidence đúng/sai người và ảnh hưởng của
`PROCESS_EVERY_N_FRAMES`/`DETECT_WIDTH`.

## 7. Lỗi đã gặp

### Ngược sáng

Khi cửa sổ sáng nằm sau người, YuNet không tạo bounding box. Đổi hướng camera,
đóng rèm hoặc chiếu sáng từ phía trước.

### Camera và port 5000 bị giữ

Nguyên nhân đã gặp là chạy hai `run_edge.sh` cùng lúc. Một process giữ camera,
process còn lại báo `Address already in use` và reconnect liên tục.

```bash
systemctl stop face-attendance-edge 2>/dev/null || true
pkill -TERM -f 'python3 edge/main.py' 2>/dev/null || true
sleep 2
ps -ef | grep '[e]dge/main.py'
ss -ltnp | grep ':5000'
fuser -v /dev/video0
```

Chỉ chạy lại khi không còn process cũ.

### Orange Pi đổi IP

Tìm lại bằng MAC hoặc `hostname -I`. IP laptop `192.168.137.1` mới là địa chỉ
ổn định trong topology ICS hiện tại.

### Script shell lỗi `pipefail`

Khi copy từ Windows, file shell có thể bị CRLF:

```bash
sed -i 's/\r$//' scripts/*.sh
sed -i 's/\r$//' systemd/*.service
sed -i 's/\r$//' .env.example
```

### Tên tiếng Việt thành dấu `?` trên stream

`cv2.putText` không render Unicode. Database và trang quản lý vẫn đúng. Có thể
chỉ hiện `user_code` ASCII hoặc dùng Pillow/FreeType để render font Unicode.

### `/health` có thể báo `server_reachable=false`

State chưa được cập nhật ngay sau lần tải embedding lúc startup. Xác minh bằng
log tải embedding/API; cần sửa `AppState` về sau.

### Remote embedding chưa được xác minh

`EMBEDDING_BACKEND=remote` chưa được test end-to-end. Hiện edge gửi ảnh đã align
nhưng `/ai/face/extract` lại detect và align lần nữa. Cần sửa và test contract
trước khi dùng fallback này.

## 8. Việc tiếp theo theo thứ tự

1. Benchmark và chốt cấu hình để Orange Pi không quá tải.
2. Thu điểm nhiều người, gồm đúng người/sai người, rồi chốt threshold.
3. Đăng ký lại ảnh mẫu trong điều kiện sáng gần camera edge.
4. Sửa overlay Unicode hoặc chỉ hiện `user_code`.
5. Sửa health state và hoàn thiện diagnostic có rate limit.
6. Sửa/test remote embedding fallback.
7. Test mất mạng, mất camera và khả năng tự phục hồi.
8. Khi các mục trên ổn định mới cấu hình `systemd` và test reboot.
9. Nếu vận hành lặp lại, cấp IP cố định/DHCP reservation cho Orange Pi.

## 9. Gói bàn giao

Nên gửi toàn bộ source/tài liệu trong `AIOT/`, gồm hai model `.onnx` trong
`edge/model/`.

Không gửi hoặc commit:

- `AIOT/server/.env` và `.env` trên Orange Pi.
- Bất kỳ `.venv*` nào.
- `node_modules/`.
- `AIOT/server/data/attendance.db`, trừ khi chủ động bàn giao dữ liệu demo và
  đã kiểm tra dữ liệu cá nhân.

Người nhận tự tạo `.env` từ `.env.example`, nhận key/password qua kênh riêng và
deploy source mới nhất vào `/opt/face-attendance-edge`.
