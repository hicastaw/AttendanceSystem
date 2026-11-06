---
version: 1
slug: "server-frontend"
primary_target: "server/frontend"
related_targets: []
---

# Trang quản trị Lab Access (server/frontend)

Mode: Operate. Người dùng: giảng viên/quản lý lab trên laptop. Việc chính: ai đang ở lab,
thống kê có mặt (ngày + giờ theo tuần/tháng), quản lý thành viên và khuôn mặt. Phụ: xuất
CSV, chỉ báo thiết bị gọn, chế độ tối. Chỉ dùng component MUI (@mui/material,
@mui/icons-material, @mui/x-data-grid, @mui/x-charts, @mui/x-date-pickers).

Màn hình: Đăng nhập · Tổng quan · Thống kê · Lịch sử ra/vào · Thành viên (+ chi tiết).
Quy tắc số liệu: reset vào/ra theo ngày; giờ tính theo cặp VÀO→RA; VÀO ngày trước không có
RA = "Thiếu lượt ra", không cộng giờ; VÀO hôm nay chưa RA = đang ở lab VÀ được cộng giờ tới
thời điểm hiện tại (người dùng xác nhận). Không sửa tay sự
kiện. Xoá thành viên = xoá hẳn kèm lịch sử, có xác nhận. Không bịa số liệu mẫu.

## Direction contract

THESIS: Admin Material tiêu chuẩn làm đúng chuẩn, ngang Google Analytics / template MUI /
Firebase console; từ chối mọi "cá tính" tự chế và mọi component ngoài MUI.

OWN-WORLD: Material Design của MUI: AppBar primary xanh Material, Drawer trắng 240px,
nền xám rất nhạt, Card phẳng viền mảnh (outlined, như Google Analytics / Firebase console — đổi từ "nổi nhẹ" sau rà soát), Roboto, chip trạng thái màu semantic (success = đang ở
lab, warning = cần đăng ký lại / thiếu RA / thiết bị offline, error = lỗi). Chế độ tối qua
colorSchemes, cùng vai trò màu.

STORY: Mở trang là biết ngay bao nhiêu người đang ở lab và là ai; sang Thống kê chọn khoảng
thời gian để xem giờ có mặt từng người và xuất CSV; Thành viên để thêm/sửa/khoá/xoá và đăng
ký khuôn mặt.

FIRST VIEWPORT: AppBar trên (tên trang, chip thiết bị, nút sáng/tối, đăng xuất); Drawer trái
(Tổng quan, Thống kê, Lịch sử ra/vào, Thành viên). Tổng quan: hàng 4 thẻ số liệu (Đang ở lab,
Lượt vào hôm nay, Thành viên, Cần đăng ký lại); dưới: biểu đồ số người có mặt theo giờ hôm
nay (trái, rộng) + bảng Đang có mặt (phải); dưới nữa: lượt ra/vào gần nhất.

FORM: canon (category standard, user-chosen) — seed:f438aeb4db8d1868

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
