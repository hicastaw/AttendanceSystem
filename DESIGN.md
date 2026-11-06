---
name: Lab Access Admin
description: He thong quan tri diem danh ra vao phong lab bang nhan dien khuon mat
colors:
  primary: "#1976d2"
  primary-dark: "#1565c0"
  primary-light: "#42a5f5"
  neutral-bg-light: "#f5f5f5"
  neutral-paper-light: "#ffffff"
  neutral-bg-dark: "#121212"
  neutral-paper-dark: "#1e1e1e"
  success: "#2e7d32"
  warning: "#ed6c02"
  error: "#d32f2f"
  text-primary-light: "rgba(0, 0, 0, 0.87)"
  text-secondary-light: "rgba(0, 0, 0, 0.6)"
  text-primary-dark: "#ffffff"
  text-secondary-dark: "rgba(255, 255, 255, 0.7)"
  border-light: "rgba(0, 0, 0, 0.12)"
  border-dark: "rgba(255, 255, 255, 0.12)"
typography:
  headline:
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif'
    fontSize: "1.5rem"
    fontWeight: 500
    lineHeight: 1.334
  title:
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif'
    fontSize: "1.25rem"
    fontWeight: 500
    lineHeight: 1.6
  body:
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif'
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif'
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.66
rounded:
  sm: "4px"
  md: "8px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "6px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-dark}"
  card-outlined:
    backgroundColor: "{colors.neutral-paper-light}"
    rounded: "{rounded.md}"
    padding: "16px"
  chip-status:
    rounded: "{rounded.full}"
    padding: "0 8px"
    height: "24px"
---

# Design System: Lab Access Admin

## Overview

**Creative North Star: "The Standard Operational Deck"**

Hệ thống quản trị điểm danh phòng lab được thiết kế theo chuẩn mực Material Design (hướng Canon), lấy sự chuẩn xác, rõ ràng và kiềm chế tối đa làm tôn chỉ. Toàn bộ giao diện phục vụ đối tượng giảng viên và quản trị viên phòng lab làm việc trên máy tính xách tay với nhiệm vụ then chốt: nắm bắt tức thì ai đang có mặt trong lab, tra cứu thống kê số giờ tham gia theo chu kỳ và kiểm soát danh sách thành viên cùng ảnh khuôn mặt.

Giao diện từ chối các hiệu ứng trang trí thừa thãi, các thủ pháp "cá tính tự chế" hay font chữ cách điệu không cần thiết. Thước đo thẩm mỹ và trải nghiệm được đối chiếu trực tiếp với các hệ thống quản trị chuyên nghiệp chuẩn mực như Google Analytics, Firebase Console và bộ template chính thức của Material UI (MUI). Mọi thành phần đều xuất phát từ hệ sinh thái MUI (@mui/material, @mui/x-data-grid, @mui/x-charts, @mui/x-date-pickers) để đảm bảo tính nhất quán và khả năng mở rộng lâu dài.

**Key Characteristics:**
- **Chuẩn mực Material Design:** Tuân thủ chặt chẽ cấu trúc AppBar, Drawer điều hướng 240px, phân cấp bề mặt phẳng với đường viền mảnh (outlined).
- **Chính trực về mặt số liệu:** Trình bày đúng hiện thực vận hành; các trường hợp bất thường như "Thiếu lượt ra" được nêu rõ ràng qua màu cảnh báo ngữ nghĩa, không tính giờ khống và không bịa số liệu mẫu.
- **Tính khả dụng tác vụ cao (Operate Mode):** Dữ liệu dạng bảng và số liệu đều sử dụng `fontVariantNumeric: 'tabular-nums'` để dễ dàng so sánh cột số; các thao tác quan trọng có xác nhận và trạng thái phản hồi tức thì.
- **Hỗ trợ toàn diện chế độ sáng/tối (Dual ColorSchemes):** Đồng bộ màu ngữ nghĩa và độ tương phản văn bản chuẩn WCAG 2.1 AA trên cả hai nền.

## Colors

Hệ màu tuân theo bảng màu cơ bản của Material Design v5 với màu xanh dương chuẩn công vụ làm điểm nhấn điều hướng và hệ thống màu ngữ nghĩa (semantic) chuẩn hóa cho mọi trạng thái.

### Primary
- **Material Blue** (`#1976d2`): Màu chủ đạo dùng cho thanh tiêu đề AppBar, các nút bấm hành động chính (Thêm thành viên, Đăng nhập), thẻ sự kiện "VÀO", và màu highlight khi chọn văn bản (`::selection`).

### Neutral
- **Background Light** (`#f5f5f5`): Nền xám nhạt ở chế độ sáng, tạo độ tách bạch tự nhiên với các thẻ dữ liệu màu trắng.
- **Paper Light** (`#ffffff`): Nền thẻ (Card), Bảng (DataGrid), thanh điều hướng Drawer và hộp thoại Dialog ở chế độ sáng.
- **Background Dark** (`#121212`): Nền đen chuẩn Material Dark ở chế độ tối.
- **Paper Dark** (`#1e1e1e`): Bề mặt thẻ và hộp thoại ở chế độ tối.
- **Border Outline** (`rgba(0, 0, 0, 0.12)` / `rgba(255, 255, 255, 0.12)`): Đường phân cách mảnh 1px cho toàn bộ hệ thống Card, Table và Divider.

### Semantic Status
- **Success Green** (`#2e7d32`): Đại diện cho trạng thái an toàn, thành công: thành viên "Đang ở lab", khuôn mặt "Đã đăng ký".
- **Warning Amber** (`#ed6c02`): Đại diện cho trạng thái cần chú ý: thiết bị "offline", khuôn mặt "Cần đăng ký lại", phiên điểm danh "Thiếu lượt ra".
- **Error Red** (`#d32f2f`): Báo lỗi kết nối API, cảnh báo xóa vĩnh viễn thành viên.
- **Neutral Grey** (`default`): Trạng thái mặc định hoặc kết thúc: sự kiện "RA", thành viên "Đã khoá", "Chưa có khuôn mặt".

### Named Rules
**The Single-Meaning Semantic Rule.** Mỗi màu trạng thái mang đúng một ý nghĩa trên toàn bộ ứng dụng: Xanh lá luôn là đang ở lab / đã đăng ký; Cam luôn là thiếu lượt ra / cần đăng ký lại / thiết bị offline; Xám luôn là đã ra / chưa có. Không tái sử dụng màu trạng thái cho mục đích trang trí thông thường.

## Typography

**Body & Interface Font:** `"Roboto", "Helvetica", "Arial", sans-serif`  
**Tabular Figures:** Kích hoạt `fontVariantNumeric: 'tabular-nums'` toàn cục trên `<body>` để các con số căn thẳng hàng tuyệt đối trong bảng và thẻ số liệu.

**Character:** Nghiêm túc, trung tính, dễ đọc ở kích thước nhỏ (12–14px) và hỗ trợ đầy đủ ký tự tiếng Việt có dấu.

### Hierarchy
- **Headline / Page Title** (Medium 500, `1.5rem` / `24px`, line-height `1.334`): Tiêu đề màn hình trên AppBar ("Tổng quan", "Thống kê", "Lịch sử ra/vào", "Thành viên").
- **Title / Section Header** (Medium 500, `1.125rem`–`1.25rem`, line-height `1.4`): Tiêu đề nhóm thẻ dữ liệu ("Số người có mặt theo giờ hôm nay", "Đang có mặt (6)").
- **Metric Big Stat** (Regular 400, `2rem`–`2.125rem`, line-height `1.2`): Con số điểm nhấn trên 4 thẻ tổng quan ("6", "9", "12", "242,9 giờ").
- **Body 1** (Regular 400, `0.875rem` / `14px`, line-height `1.43`): Văn bản bảng biểu DataGrid, danh sách sự kiện, nội dung mô tả phụ.
- **Label / Caption** (Medium/Regular, `0.75rem` / `12px`, line-height `1.66`): Nhãn phụ của thẻ số liệu ("trên 11 thành viên đang hoạt động", "Hôm nay 16:40 · độ tin cậy 95,3%"), nhãn chip trạng thái.

### Named Rules
**The No-Uppercase-Action Rule.** Nút bấm và tab điều hướng giữ nguyên kiểu chữ tự nhiên (`textTransform: 'none'`), loại bỏ kiểu viết hoa toàn bộ (ALL-CAPS) mặc định của Material Design để tăng tốc độ nhận diện từ ngữ tiếng Việt.

## Layout

Hệ thống bố cục sử dụng khung cố định kết hợp dòng chảy linh hoạt (Fluid Grid):
- **Desktop (≥ 900px):**
  - **Top AppBar:** Cố định ở mép trên (`z-index: 1100`), chiều cao `64px`, chứa tiêu đề trang, chip thông tin thiết bị biên (RPI5_01), nút chuyển giao diện sáng/tối và nút đăng xuất.
  - **Left Drawer:** Cố định bên trái (`z-index: 1200`), chiều rộng `240px`, chứa logo/tiêu đề sản phẩm và 4 mục điều hướng chính kèm icon MUI.
  - **Main Content Canvas:** Padding `24px` (`spacing(3)`), bố trí dạng Grid responsive: hàng thẻ tóm tắt (4 cột trên desktop, 2 cột trên tablet, 1 cột trên mobile), theo sau là khu vực biểu đồ + bảng danh sách.
- **Mobile (< 900px):**
  - Drawer thu gọn thành Drawer tạm thời (Temporary Drawer) kích hoạt qua nút menu hamburger trên AppBar.
  - Các thẻ chỉ số xếp thành 2 cột hoặc 1 cột; bảng dữ liệu tự động chuyển sang chế độ hiển thị thẻ tóm tắt hoặc cuộn ngang.

## Elevation & Depth

Triết lý phẳng hóa có kiểm soát (Flat with Structural Borders):
- **Outlined by Default:** Toàn bộ `MuiCard` sử dụng `variant="outlined"` với đường viền mảnh `1px` thay vì bóng đổ (`box-shadow`), tạo cảm giác gọn gàng và trực quan tương tự Google Analytics.
- **Elevation-Free Buttons:** Toàn bộ nút bấm kích hoạt `disableElevation: true`. Độ sâu bề mặt chỉ xuất hiện khi cần bảo vệ tiêu điểm tương tác (Modal Dialog hoặc Popover menu).

### Named Rules
**The Border-Over-Shadow Rule.** Bề mặt thẻ, bảng và vùng chứa tại trạng thái nghỉ dùng đường viền mảnh `border: 1px solid var(--border-color)` thay cho bóng đổ mờ. Độ sâu bóng đổ chỉ dành riêng cho lớp phủ (overlay modal/popover).

## Shapes

- **Corner Radius:** Bo góc chuẩn `8px` (`theme.shape.borderRadius: 8`) cho Cards, Dialogs, TextFields và Buttons.
- **Status Chips:** Bo tròn toàn phần (`borderRadius: 9999px` / `size="small"` chiều cao `24px`) với padding ngang `8px`.
- **Avatars:** Tròn hoàn toàn (`50%`), hiển thị 2 chữ cái viết tắt của họ tên hoặc ảnh đại diện 40×40px.

## Components

### Buttons
- **Shape:** Bo góc `8px`.
- **Primary Action:** Nền `#1976d2`, chữ trắng, không đổ bóng (`disableElevation: true`), padding `6px 16px`, không viết hoa (`textTransform: 'none'`).
- **Outlined / Secondary:** Nền trong suốt, viền `1px solid rgba(25, 118, 210, 0.5)`, màu chữ `#1976d2`.
- **Icon Buttons:** Nút chuyển dark/light mode và đăng xuất trên AppBar với hover tròn mờ.

### Status Chips
- **Chip kích thước nhỏ (`size="small"`):** Chiều cao `24px`, font `0.75rem`.
- **Biến thể màu:**
  - `success`: Nền xanh lá `#2e7d32`, chữ trắng.
  - `warning`: Nền cam `#ed6c02`, chữ đen/trắng tương phản.
  - `default`: Nền xám nhạt `rgba(0, 0, 0, 0.08)` (sáng) hoặc `rgba(255, 255, 255, 0.16)` (tối).

### Cards & DataGrid
- **Card Container:** Nền trắng/xám đậm, viền `1px solid rgba(0, 0, 0, 0.12)`, padding trong `16px`.
- **DataGrid Table:** Phân trang dưới đáy, hỗ trợ thanh công cụ QuickFilter tìm kiếm và ẩn/hiện cột.

### Device Indicator Chip
- **DeviceChip:** Đặt cố định góc phải AppBar; hiển thị tên thiết bị và trạng thái kết nối (`online` xanh lá / `offline` cam / `unknown` xám).

## Do's and Don'ts

### Do:
- **Do** sử dụng các component chuẩn của MUI (`@mui/material`, `@mui/x-data-grid`, `@mui/x-charts`, `@mui/x-date-pickers`) cho mọi màn hình mới.
- **Do** dùng `fontVariantNumeric: 'tabular-nums'` cho mọi cột bảng và con số thống kê.
- **Do** hiển thị thông báo trung thực khi có bất thường về dữ liệu (ví dụ: cảnh báo "Thiếu lượt ra" màu cam thay vì âm thầm loại bỏ).
- **Do** cung cấp hộp thoại xác nhận khi thực hiện hành động phá hủy (xóa thành viên vĩnh viễn kèm lịch sử).

### Don't:
- **Don't** tự tạo component ngoài MUI hoặc thêm thư viện UI khác vào dự án.
- **Don't** dùng hiệu ứng bóng đổ tùy tiện (`box-shadow: 4px 4px 0` hoặc bóng gradient) lên các thẻ dữ liệu.
- **Don't** bịa số liệu ảo hoặc biểu đồ mẫu không bắt nguồn từ dữ liệu sự kiện thực tế.
- **Don't** viết hoa toàn bộ chữ trên nút bấm (`text-transform: uppercase`).
