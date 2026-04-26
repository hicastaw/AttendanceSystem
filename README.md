# 🎓 AttendanceSystem – Hệ Thống Điểm Danh Khuôn Mặt

Hệ thống điểm danh tự động sử dụng nhận diện khuôn mặt, xây dựng với **React + Vite** (Frontend), **Node.js + Express** (Backend), **Python FastAPI** (AI Service) và **PostgreSQL + pgvector** (Database).

---


## ✅ Nâng cấp đã bổ sung trong bản hoàn chỉnh

- Thêm **manual override** cho bản ghi điểm danh trong Dashboard giáo viên.
- Thêm nút **chốt phiên (submit)** để khóa nghiệp vụ sau khi đã kiểm tra kết quả.
- Sửa API **global sessions** để tạo phiên hợp lệ theo nhiều học phần, không còn xung đột `section_id NOT NULL`.
- Hoàn thiện luồng **hủy manual override** để hệ thống tự tính lại trạng thái theo dữ liệu check-in gốc.
- Kiểm tra lại frontend và build thành công bằng Vite production build.

## 📋 Yêu cầu hệ thống

| Công cụ | Phiên bản khuyến nghị |
|---|---|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | ≥ 4.x |
| [Docker Compose](https://docs.docker.com/compose/) | ≥ 2.x (đi kèm Docker Desktop) |
| Node.js *(chỉ cần nếu chạy local)* | ≥ 20.x |
| Python *(chỉ cần nếu chạy local)* | ≥ 3.11 |

---

## 🚀 Cách 1: Chạy toàn bộ bằng Docker (Khuyên dùng)

> Đây là cách đơn giản nhất. Docker sẽ tự động cài đặt và khởi chạy tất cả dịch vụ.

### Bước 1: Clone repository

```bash
git clone https://github.com/hicastaw/AttendanceSystem.git
cd AttendanceSystem
```

### Bước 2: Khởi chạy toàn bộ hệ thống

```bash
docker compose up --build
```

> ⏳ **Lần đầu chạy sẽ mất khoảng 3–5 phút** để tải image và cài đặt dependencies.  
> Database sẽ tự động được khởi tạo cùng dữ liệu demo (160 sinh viên, 16 học phần, 64 phiên điểm danh).

### Bước 3: Truy cập ứng dụng

| Dịch vụ | URL |
|---|---|
| 🌐 Frontend (Giao diện chính) | http://localhost:5173 |
| 👨‍🏫 Dashboard Giáo viên | http://localhost:5173/teacher |
| 🔧 Backend API | http://localhost:3001 |
| 🤖 AI Service | http://localhost:8001 |
| 🗄️ pgAdmin (Quản lý DB) | http://localhost:5050 |

> **Đăng nhập pgAdmin:**  
> Email: `admin@example.com` | Mật khẩu: `admin123`

### Dừng hệ thống

```bash
# Dừng nhưng giữ lại dữ liệu
docker compose down

# Dừng và xóa toàn bộ dữ liệu (reset sạch)
docker compose down -v
```

### Reset và chạy lại từ đầu

```bash
docker compose down -v
docker compose up --build
```

---

## 🛠️ Cách 2: Chạy thủ công (Local Development)

Cần mở **4 terminal riêng biệt**, mỗi terminal chạy một dịch vụ.

### Yêu cầu trước khi chạy

- Cài **PostgreSQL 16** + extension **pgvector**
- Tạo database và chạy các file SQL trong thư mục `backend/database/docker-entrypoint-initdb.d/` theo **thứ tự tên file**

### Terminal 1 – Backend (Node.js)

```bash
cd backend
npm install
npm run dev
```

> Backend chạy tại: http://localhost:3001

### Terminal 2 – Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

> Frontend chạy tại: http://localhost:5173

### Terminal 3 – AI Service (Python FastAPI)

```bash
cd backend/ai
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
```

> AI Service chạy tại: http://localhost:8001

### Biến môi trường cho Backend (tạo file `backend/.env`)

```env
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=attendance_db
DB_USER=attendance_user
DB_PASSWORD=attendance_pass
AI_SERVICE_URL=http://localhost:8001
UPLOAD_DIR=uploads
```

---

## 🗂️ Cấu trúc thư mục

```
attsys_work/
├── docker-compose.yml        # Cấu hình Docker Compose
├── frontend/                 # React + Vite + TailwindCSS
│   ├── src/
│   │   ├── components/       # Các component React
│   │   └── pages/            # Các trang (Teacher, Student...)
│   └── Dockerfile
├── backend/
│   ├── src/                  # Node.js Express API
│   ├── ai/                   # Python FastAPI – nhận diện khuôn mặt
│   │   ├── main.py
│   │   ├── core/             # Logic nhận diện
│   │   ├── model/            # Model AI
│   │   └── requirements.txt
│   └── database/
│       └── docker-entrypoint-initdb.d/  # SQL khởi tạo database
└── README.md
```

---

## 🗄️ Thông tin Database

| Thông số | Giá trị |
|---|---|
| Host | `localhost` (hoặc `postgres` trong Docker) |
| Port | `5432` |
| Database | `attendance_db` |
| Username | `attendance_user` |
| Password | `attendance_pass` |

---

## 📊 Dữ liệu Demo

Hệ thống được tích hợp sẵn bộ dữ liệu demo bao gồm:

- 👥 **160 sinh viên** với hồ sơ đầy đủ
- 📚 **16 học phần** từ nhiều khoa
- 📅 **64 phiên điểm danh** ở các trạng thái khác nhau (draft, open, submitted, closed)

> Sau khi chạy, vào **Dashboard Giáo viên** tại http://localhost:5173/teacher để xem dữ liệu demo.

---

## ❗ Xử lý lỗi thường gặp

### Lỗi: `container attendance_pg is unhealthy`

Database cần nhiều thời gian để khởi tạo dữ liệu demo. Chạy lại:

```bash
docker compose up
```

*(Không cần `--build` lại, Docker sẽ tự nhận biết database đã sẵn sàng.)*

### Lỗi: Port đã bị chiếm dụng

Kiểm tra và dừng ứng dụng đang dùng cổng 5173, 3001, 8001, hoặc 5432.

```bash
# Windows – kiểm tra port 5173
netstat -ano | findstr :5173
```

### Reset toàn bộ dữ liệu

```bash
docker compose down -v
docker compose up --build
```

---

## 👥 Thành viên nhóm

| Tên | GitHub |
|---|---|
| Trần Trung Hiếu | [@hicastaw](https://github.com/hicastaw) |
| Lê Quang Vinh | [@vinlee15](https://github.com/vinlee15) |
| Vietsnowman | [@Vietsnowman](https://github.com/Vietsnowman) |
