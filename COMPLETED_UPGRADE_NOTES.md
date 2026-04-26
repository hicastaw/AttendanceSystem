# Completed Upgrade Notes

Thư mục này là bản đã được nâng cấp từ gói gốc để hệ thống hoàn chỉnh hơn.

## Những phần đã được hoàn thiện

1. Backend Attendance API
   - Thêm endpoint chốt phiên: `PUT /api/v1/attendance/sessions/:id/submit`
   - Thêm manual override cho bản ghi điểm danh:
     - `PUT /api/v1/attendance/sessions/:sessionId/records/:recordId/manual-override`
     - `DELETE /api/v1/attendance/sessions/:sessionId/records/:recordId/manual-override`
   - Sửa endpoint `POST /api/v1/attendance/global-sessions` để tạo phiên hợp lệ cho nhiều học phần thay vì chèn `section_id = NULL`.

2. Teacher Dashboard
   - Thêm nút **Chốt** trong quản lý phiên điểm danh.
   - Thêm modal **Chỉnh điểm danh thủ công**.
   - Hiển thị cờ `manual` cho bản ghi đã override.
   - Thêm nút **Bỏ override** để trả bản ghi về cách tính tự động.
   - Bổ sung lọc trạng thái `submitted`.

3. Kiểm tra build
   - Frontend đã được cài lại dependencies và build production thành công.
   - Backend đã được kiểm tra syntax cho các file route và file khởi động.

## Gợi ý chạy nhanh

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Backend
```bash
cd backend
npm install
npm run dev
```

### AI service
```bash
cd backend/ai
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
```

### Toàn hệ thống bằng Docker
```bash
docker compose up --build
```

## 2026-04-22 - Bo sung phan quyen (RBAC demo)

Da nang cap them co che phan quyen theo 3 vai tro:
- admin
- lecturer
- student

### Backend
- Them middleware RBAC dua tren cac header:
  - `X-User-Role`
  - `X-Lecturer-Code`
  - `X-Student-Code`
- Khoa cac API theo role:
  - `admin`: toan quyen
  - `lecturer`: chi duoc xem/sua hoc phan, session va ket qua thuoc phan cong cua minh
  - `student`: chi duoc xem/sua profile cua minh va diem danh bang ma SV cua minh
- Khoa manual override/export/session management chi cho lecturer chu quan hoac admin.
- Khoa `global-sessions` cho admin.

### Frontend
- Them bo chon quyen ngay tren header.
- Luu phien role trong localStorage de test nhanh.
- Route guard:
  - `/teacher` -> admin, lecturer
  - `/profile` -> admin, student
  - `/scan` -> admin, student
- Tu dong gan header role vao moi request API.
- Khoa ma giang vien/ma sinh vien theo phien hien tai o cac man hinh tuong ung.

### Luu y
- Day la RBAC demo/development, chua phai he thong dang nhap bang mat khau/JWT.
- Neu can, co the nang cap tiep len login that + token-based auth + bang users/roles/permissions trong CSDL.

## 2026-04-22 - Bo sung dang nhap that

Da nang cap he thong tu co che chon role thu cong sang dang nhap that co token.

### Backend
- Them bang `auth_users` cho tai khoan dang nhap.
- Them bootstrap tu dong khi backend khoi dong:
  - tao `auth_users` neu chua co
  - tao tai khoan `admin`
  - dong bo tai khoan cho toan bo giang vien va sinh vien tu du lieu demo
- Them API xac thuc:
  - `POST /api/v1/auth/login`
  - `GET /api/v1/auth/me`
  - `POST /api/v1/auth/change-password`
- Middleware RBAC nay doc Bearer token that; co giu fallback header cu de tranh vo cac luong demo cu.
- Token co han dung, ky HMAC SHA256 va khong can them package ngoai.

### Frontend
- Them trang `Login` that.
- Moi request API gui `Authorization: Bearer <token>`.
- Header da doi thanh giao dien tai khoan that: xem thong tin dang nhap, doi mat khau, dang xuat.
- Route guard se tu dong chuyen ve `/login` neu chua dang nhap.

### Tai khoan demo mac dinh
- Admin:
  - username: `admin`
  - password: `Admin@123`
- Giang vien demo:
  - username: `gv001`
  - password: `GV001@123`
- Sinh vien demo:
  - username: `sv0001`
  - password: `SV0001@123`

Quy uoc bootstrap:
- moi giang vien moi se co username = `lecturer_code` viet thuong
- mat khau mac dinh = `<LECTURER_CODE>@123`
- moi sinh vien moi se co username = `student_code` viet thuong
- mat khau mac dinh = `<STUDENT_CODE>@123`

Nen doi mat khau ngay sau lan dang nhap dau tien.
