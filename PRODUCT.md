# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: giảng viên / người quản lý phòng lab, dùng trang quản trị trên laptop.
Việc họ cần làm: biết ai đang có mặt trong lab ngay lúc này, xem thống kê có mặt
của các thành viên, và quản lý danh sách thành viên cùng ảnh khuôn mặt đăng ký.

Thành viên lab (khoảng 20–30 người) không dùng trang quản trị; họ chỉ tương tác với
camera và màn hình kiosk tại cửa.

## Product Purpose

Hệ thống điểm danh ra/vào phòng lab bằng nhận diện khuôn mặt. Thiết bị biên tại cửa
tự nhận diện và ghi nhận check-in / check-out; server lưu lịch sử và cung cấp trang
quản trị. Thành công là người quản lý nắm được tình hình có mặt mà không cần điểm
danh thủ công, và số liệu có mặt đủ tin cậy để dùng.

## Positioning

Nhận diện và quyết định VÀO/RA diễn ra ngay trên thiết bị tại cửa (edge-first), dữ
liệu được ghi cục bộ trước rồi mới đồng bộ (offline-first): mất mạng hay server tắt
thì cửa vẫn ghi nhận, sự kiện tự đồng bộ khi có kết nối lại.

## Operating Context

- Một phòng lab, một cửa, một thiết bị biên (Raspberry Pi 5 + Camera Module 3 + màn
  hình kiosk HDMI 1024×600).
- Server chạy trên máy tính riêng (Docker); thiết bị biên và server nối qua mạng
  riêng ảo ZeroTier.
- Quy trình: quản trị viên tạo người dùng và đăng ký ảnh khuôn mặt trên trang quản
  trị → thiết bị biên tải danh sách → thành viên đi qua cửa được ghi VÀO/RA.
- Loại sự kiện VÀO/RA được suy ra bằng cách đảo trạng thái gần nhất của từng người
  TRONG NGÀY (lần quét đầu tiên mỗi ngày luôn là VÀO), cách nhau tối thiểu 60 giây; một
  camera đơn không xác định được hướng đi, nên có thể sai khi người dùng quên quét lúc ra.
- Quy tắc tính giờ có mặt (đã xác nhận): ghép từng cặp VÀO → RA trong cùng ngày. VÀO của
  ngày trước không có RA = "Thiếu lượt ra", không cộng giờ, không sửa tay. VÀO hôm nay
  chưa có RA = đang ở lab, được cộng giờ tới thời điểm hiện tại.
- Xoá thành viên là xoá hẳn kèm khuôn mặt và toàn bộ lịch sử (có xác nhận); "Khoá" để tạm
  ngưng mà vẫn giữ lịch sử.

## Capabilities and Constraints

- Trang quản trị phải làm tốt: (1) ai đang ở trong lab ngay lúc này, (2) thống kê có
  mặt, (3) quản lý người dùng và ảnh khuôn mặt.
- Phạm vi giao diện hiện tại: chỉ trang quản trị web (`server/frontend`). Màn hình
  kiosk trên thiết bị biên làm ở đợt sau.
- Stack: React + Vite (`server/frontend`), backend Express + SQLite phục vụ API và bản
  build giao diện trên cùng cổng 3001.
- **UI chỉ dùng component của MUI (Material UI)** — ràng buộc do người dùng đặt.
- Ngôn ngữ giao diện: tiếng Việt.
- Đăng nhập quản trị: một mật khẩu admin chung, chưa có tài khoản/phân quyền riêng.
- Dữ liệu có sẵn từ API: người dùng (mã, họ tên, email, trạng thái, tình trạng khuôn
  mặt: đã đăng ký / cần đăng ký lại / chưa có), sự kiện ra/vào (thời gian, người,
  loại, độ tin cậy, thiết bị), trạng thái thiết bị biên (online, sự kiện chờ đồng bộ).
- Chưa có API thống kê; số liệu thống kê phải được tính từ sự kiện ra/vào.
- Phần embedding / pipeline AI đang được nhóm AI làm lại; giao diện đăng ký khuôn mặt
  có thể thay đổi theo (ví dụ nhiều ảnh mỗi người) — chưa chốt.

## Brand Commitments

- Trang quản trị theo chuẩn Material Design của MUI, làm đúng quy ước và kỹ lưỡng,
  không thêm "cá tính" riêng — người dùng chọn hướng này có chủ đích (06/11/2026).
- Thước đo chất lượng: Google Analytics (thống kê theo khoảng thời gian), template
  chính thức của MUI (dashboard/CRUD), Google Admin / Firebase console (bảng dữ liệu,
  bộ lọc, trạng thái).

## Evidence on Hand

- Dữ liệu thật hiện rất ít (1 người dùng đã đăng ký, vài sự kiện thử nghiệm). Không
  được bịa số liệu, người dùng hay biểu đồ mẫu trình bày như dữ liệu thật.
- Không có logo hay tài sản thương hiệu.

## Product Principles

1. Tình hình có mặt hiện tại phải đọc được trong một cái nhìn.
2. Số liệu phải trung thực về giới hạn của nó: sự kiện thiếu RA hay chưa đồng bộ được
   thể hiện rõ, không tự làm đẹp số liệu.
3. Quản lý người dùng và khuôn mặt phải nhanh, ít bước, báo lỗi rõ ràng bằng tiếng Việt.
4. Hệ thống vẫn chạy khi mất mạng; giao diện không giả định mọi thứ luôn online.
