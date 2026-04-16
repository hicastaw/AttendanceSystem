# Hệ thống điểm danh khuôn mặt (Attendance System)

> Ứng dụng điểm danh sinh viên thông minh thời gian thực dựa trên nhận diện khuôn mặt (Facial Recognition), hỗ trợ chế độ điểm danh linh hoạt toàn cục (Global Attendance).

## 🚀 Giới thiệu chung

Dự án được xây dựng với mục tiêu tự động hóa quá trình điểm danh sinh viên bằng camera. Nhờ luồng xử lý nhận diện được tối ưu hoá và tích hợp AI có độ chính xác cao, hệ thống giải quyết trực tiếp các vấn đề về sai sót và tốn thời gian của cách điểm danh truyền thống.

**Tính năng nổi bật:**
- Đăng ký và quản lý hồ sơ sinh viên, tự động trích xuất vector khuôn mặt và đánh giá độ nét (Sharpness) ngay từ khâu upload ảnh.
- Điểm danh thông qua luồng camera thời gian thực (Real-time tracking), quét định kỳ tự động và phân loại tình trạng (đến sớm, đúng giờ, muộn).
- Hỗ trợ cấu hình **Global Attendance** (điểm danh toàn trường) - không bắt buộc sinh viên phải map cứng vào danh sách lớp, miễn là hồ sơ khuôn mặt có tồn tại trên cơ sở dữ liệu hệ thống.

## 🛠 Công nghệ sử dụng (Tech Stack)

Hệ thống được phát triển theo kiến trúc microservices chia làm các components nhỏ:
- **Frontend Web:** React 18 + Vite + TailwindCSS v4 thuần.
- **Backend API:** Node.js 20 + Express 4.
- **AI Service:** Python FastAPI, kết hợp pipeline FaceEngine sử dụng mô hình ONNX (YuNet cho Phát hiện khuôn mặt + MBF cho Trích xuất Embedding).
- **Cơ sở dữ liệu:** PostgreSQL 16 hỗ trợ extension `pgvector` cho phép so khớp khoảng cách **Cosine** của các vector khuôn mặt trực tiếp ngay trên truy vấn SQL.
- **Triển khai:** Toàn bộ hệ thống chạy trên Docker containers.

## ⚡ Cài đặt & Khởi động nhanh (Quick Start)

Cách nhanh nhất để chạy toàn bộ hệ thống (bao gồm DB, API, AI, Web UI, và pgAdmin) là sử dụng Docker Compose cài đặt sẵn ở thư mục gốc:

```bash
git clone <repository_url>
cd AttendanceSystem
docker compose up -d --build
```

**Các dịch vụ sẽ có sẵn tại:**
- 🌐 Giao diện Web: [http://localhost:5173](http://localhost:5173)
- ⚙️ Backend API: [http://localhost:3001](http://localhost:3001)
- 🤖 AI Service Docs: [http://localhost:8001/docs](http://localhost:8001/docs)
- 🗄️ Database Management (pgAdmin): [http://localhost:5050](http://localhost:5050)
  *Tài khoản mặc định: `admin@example.com` / Mật khẩu: `admin123`*

*(Để chạy độc lập từng module trong giai đoạn phát triển, vui lòng tham khảo chi tiết tại bộ tài liệu dự án bên dưới).*

## 📚 Tài liệu kỹ thuật chi tiết

Các tài liệu về:
- API Endpoints chi tiết.
- Cấu trúc kiến trúc luồng dữ liệu của AI nhận diện (Extracting, Vectorizing, Database indexing).
- Quy trình điểm danh và sơ đồ kiến trúc hệ thống.

👉 **Vui lòng đọc tại: [document.md](./document.md)**.
