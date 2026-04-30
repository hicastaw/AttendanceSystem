# Document — AttendanceSystem

> Tài liệu ghi lại toàn bộ quá trình xây dựng hệ thống điểm danh khuôn mặt PTIT.
> Cập nhật liên tục theo từng bước thực hiện.

---

## Tổng quan hệ thống

**Mục tiêu:** Xây dựng 2 trang web chính cho hệ thống điểm danh sinh viên bằng nhận diện khuôn mặt tại PTIT.

**Tech Stack:**
| Lớp | Công nghệ |
|---|---|
| Frontend | React 18 + Vite + TailwindCSS v4 (JSX thuần, không TypeScript) |
| Backend | Node.js 20 + Express 4 |
| AI Service | Python + FastAPI + FaceEngine (YuNet + MBF ONNX) |
| Database | PostgreSQL 16 + pgvector |

---

## Kiến trúc hệ thống

```
[Browser]
    │  HTTP (port 5173)
    ▼
[Frontend — React/Vite]
    │  /api/v1/* → proxy → localhost:3001
    ▼
[Backend — Node.js/Express] (port 3001)
    │  ├── /api/v1/students/*       → students.js route
    │  └── /api/v1/attendance/*     → attendance.js route
    │
    ├── HTTP (port 8001) ─────────► [AI Service — FastAPI] (port 8001)
    │                                    └── FaceEngine (YuNet + MBF ONNX)
    │
    └── TCP (port 5432) ──────────► [PostgreSQL + pgvector]
                                         ├── tables: students, face_profiles, ...
                                         ├── functions: upsert_attendance_record()
                                         └── views: vw_attendance_session_detail
```

---

## Cấu trúc thư mục

```
AttendanceSystem/
├── frontend/                    # React JSX frontend
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js           # Proxy /api → localhost:3001
│   └── src/
│       ├── App.jsx              # Router (/, /profile, /scan)
│       ├── index.css            # TailwindCSS v4 + custom animations
│       ├── main.jsx
│       ├── api/client.js        # Axios instance (baseURL: /api/v1)
│       ├── components/Layout.jsx
│       └── pages/
│           ├── Home.jsx
│           ├── StudentProfile.jsx  # Trang 1
│           └── AttendanceScan.jsx  # Trang 2
├── backend/
│   ├── package.json             # Node.js Express
│   ├── .env
│   ├── database/                # Docker + PostgreSQL (moved từ attendance_db_package)
│   │   ├── docker-compose.yml
│   │   ├── .env
│   │   └── docker-entrypoint-initdb.d/  # SQL init scripts
│   ├── src/
│   │   ├── index.js             # Express app (port 3001)
│   │   ├── db.js                # PostgreSQL pool
│   │   ├── upload.js            # Multer config
│   │   └── routes/
│   │       ├── students.js      # /api/v1/students/*
│   │       └── attendance.js    # /api/v1/attendance/*
│   └── ai/                      # Python FastAPI (port 8001)
│       ├── main.py
│       ├── requirements.txt
│       ├── core/face_engine.py
│       └── model/*.onnx
├── docker-compose.yml           # Cấu hình Docker Deploy toàn bộ hệ thống
├── document.md                  # Tài liệu dự án chi tiết
└── README.md                    # Hướng dẫn khởi động nhanh
```

---

## Hướng dẫn khởi động

### Cách 1: Triển khai bằng Docker Compose (Khuyên dùng)

Toàn bộ hệ thống (Database, Backend, AI Service, Frontend) đã được đóng gói và cấu hình liên kết mạng thông qua `docker-compose.yml` ở thư mục gốc. Bạn chỉ cần chạy lệnh sau:

```bash
# Tại thư mục dự án gốc (AttendanceSystem)
docker compose up -d --build
```

**Các dịch vụ sẽ hoạt động tại các cổng:**
- **Frontend Web UI:** `http://localhost:5173`
- **Backend API:** `http://localhost:3001`
- **AI Service Swagger:** `http://localhost:8001/docs`
- **Database (PostgreSQL):** `localhost:5432`
- **pgAdmin:** `http://localhost:5050` (admin@example.com / admin123)

---

### Cách 2: Khởi động thủ công (Môi trường Phát triển)

#### 1. Khởi động Database

```bash
# Tại thư mục gốc hoặc backend/database
docker compose up -d postgres pgadmin
```

#### 2. Khởi động AI Service

```bash
cd backend/ai
pip install -r requirements.txt
uvicorn main:app --port 8001 --reload
# Health check: http://localhost:8001/
```

#### 3. Khởi động Backend

```bash
cd backend
npm install
npm run dev
# http://localhost:3001/api/health
```

#### 4. Khởi động Frontend

```bash
cd frontend
npm install
npm run dev
# http://localhost:5173
```

---

## API Endpoints

### Students API (`/api/v1/students`)

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/students/classes` | Danh sách lớp hành chính |
| `GET` | `/students` | Danh sách tất cả sinh viên |
| `GET` | `/students/:code` | Thông tin 1 sinh viên |
| `POST` | `/students/face/validate` | Upload + validate ảnh khuôn mặt (AI) |
| `POST` | `/students/profile` | Lưu profile + embedding vào DB |
| `PUT` | `/students/:code` | Cập nhật thông tin sinh viên |

### Attendance API (`/api/v1/attendance`)

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/attendance/sections` | Danh sách học phần |
| `GET` | `/attendance/sessions` | Danh sách phiên điểm danh |
| `POST` | `/attendance/sessions` | Tạo phiên mới (draft) |
| `PUT` | `/attendance/sessions/:id/open` | Mở phiên → gọi `open_attendance_session()` |
| `PUT` | `/attendance/sessions/:id/close` | Đóng phiên → gọi `close_attendance_session()` |
| `GET` | `/attendance/sessions/:id/records` | Kết quả điểm danh của phiên |
| `POST` | `/attendance/recognize` | Nhận diện khuôn mặt từ frame camera |

### AI Service (`port 8001`)

| Method | Endpoint | Mô tả |
|---|---|---|
| `POST` | `/ai/face/validate` | Validate ảnh đăng ký (strict: sharpness + embedding) |
| `POST` | `/ai/face/extract` | Trích embedding từ frame (realtime, ít strict hơn) |

---

## Nghiệp vụ điểm danh

### Luồng đăng ký khuôn mặt (Trang 1)
```
Người dùng upload ảnh
    → Backend forward sang AI Service /ai/face/validate
    → AI: detect face → check sharpness (>100) → extract embedding
    → Backend trả kết quả (is_valid, embedding, sharpness_score)
    → Người dùng điền thông tin → nhấn Lưu hồ sơ
    → Backend INSERT/UPDATE students + face_profiles (embedding dạng vector)
```

### Luồng điểm danh realtime (Trang 2) & Global Attendance

Hệ thống hỗ trợ chế độ **Global Attendance** (Điểm danh toàn cục), cho phép linh động việc sinh viên không cần thiết phải bị ràng buộc bắt buộc vào một lớp học cố định để hệ thống có thể nhận diện.

```
Giảng viên chọn phiên → Kích hoạt
    → Backend gọi open_attendance_session() → tạo sẵn tất cả record absent
    → Camera quét mỗi 2 giây → capture frame
    → Backend forward frame sang AI Service /ai/face/extract
    → AI: detect face → extract embedding
    → Backend: vector search trong PostgreSQL (pgvector <=> cosine)
    → Nếu similarity >= 60%: gọi upsert_attendance_record()
    → PostgreSQL tự tính: early / on_time / late
    → Frontend hiển thị log với màu sắc tương ứng
Kết thúc → close_attendance_session() → record absent tự động cho SV không quét
```

### Quy tắc phân loại

| Điều kiện | Trạng thái |
|---|---|
| Checkin trước start_time | `early` — Đến sớm |
| Trong khoảng [start_time, start_time + late_after_minutes] | `on_time` — Đúng giờ |
| Sau mốc trên | `late` — Đi muộn |
| Không checkin | `absent` — Vắng mặt |
| Similarity < 60% | Từ chối — Không hợp lệ |
| Confidence AI < 80% | `low_confidence` → absent |
| Sharpness ≤ 100 | `blurry_rejected` → absent |

---

## Ghi chú kỹ thuật

### pgvector Vector Search
Hàm tìm sinh viên khớp nhất trong `attendance.js`:
```sql
SELECT s.student_id, s.student_code, s.full_name,
       1 - (fp.embedding <=> $1::vector) AS similarity
FROM face_profiles fp
JOIN students s ON fp.student_id = s.student_id
WHERE s.is_active = true
ORDER BY fp.embedding <=> $1::vector
LIMIT 1;
```
- `<=>` = cosine distance (pgvector)
- `1 - distance` = similarity (0.0 → 1.0)
- Index HNSW trên `face_profiles.embedding` đảm bảo tốc độ kể cả với hàng nghìn sinh viên

### AI Service — FaceEngine
- **Model 1:** `face_detection_yunet_2023mar.onnx` — Phát hiện khuôn mặt, trả về bounding box + landmarks
- **Model 2:** `w600k_mbf.onnx` — Trích xuất embedding 512 chiều (normalize L2)
- **Align face:** Căn chỉnh khuôn mặt theo 5 landmarks trước khi trích embedding
- **Sharpness check:** Laplacian variance, ngưỡng 100.0

### Camera (Trang 2)
- Dùng `navigator.mediaDevices.getUserMedia` — cần HTTPS hoặc localhost
- Capture frame qua `<canvas>` rồi gửi dưới dạng Blob (JPEG 85%)
- Auto-capture mỗi **2 giây** khi session đang open
- Mỗi sinh viên chỉ được log **1 lần** mỗi session (tránh spam, dùng `seenStudents` Set)

---

## TODO / Cải tiến tương lai

- [ ] Thêm xác thực JWT cho các API
- [ ] Trang báo cáo: xuất Excel từ `vw_attendance_student_summary`
- [ ] Trang giảng viên: manual override trực tiếp trên bảng điểm danh
- [ ] WebSocket thay polling cho log realtime (giảm latency)
- [x] Docker Compose cho toàn bộ hệ thống (db + ai + backend + frontend)
- [x] Triển khai chế độ Global Attendance (Điểm danh không phụ thuộc cứng class enrollment) 

---

*Cập nhật lần cuối: 2026-04-16*
