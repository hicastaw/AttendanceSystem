# R50 webcam demo

Mở Docker Desktop (Linux containers), tại thư mục này chạy:

```powershell
docker compose up
```

Mở **http://localhost:3080**. Dùng `Admin password` được in trong terminal,
đăng nhập, bấm **Bật webcam** và cấp quyền camera. Giữ tab camera mở; các link
tạo thành viên/enrollment/kiosk/dashboard mở trong tab mới.

`docker compose down` giữ dữ liệu enrollment/điểm danh trong volume demo.
`docker compose down --volumes` xóa toàn bộ dữ liệu demo của project này.
Sau khi sửa source, chạy `docker compose up --build`.

[Hướng dẫn và xử lý lỗi đầy đủ](../../docs/test/R50_DOCKER_GUIDE.md).
