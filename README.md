# AttendanceSystem — Hệ Thống Điểm Danh bằng Nhận Diện Khuôn Mặt

Hệ thống so sánh khuôn mặt từ Webcam thời gian thực với một ảnh tham chiếu để đưa ra kết luận về danh tính.

## Yêu cầu
- Python 3.8 hoặc mới hơn
- Các phụ thuộc được liệt kê trong [requirements.txt](requirements.txt)

Nội dung hiện tại của `requirements.txt`:

- `opencv-contrib-python>=4.7.0.72`
- `onnxruntime>=1.15.1`
- `numpy>=1.24.0`

## Thiết lập môi trường ảo (venv)
Khuyến nghị tạo môi trường ảo tên `.venv` để cô lập phụ thuộc.

- Windows (PowerShell):

```powershell
python -m venv .venv
\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

- Windows (CMD):

```cmd
python -m venv .venv
.venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
```

- macOS / Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Nếu bạn đang dùng VS Code, chọn interpreter là `.venv` để đảm bảo extension và terminal dùng đúng môi trường.

## Cấu hình ảnh tham chiếu
Mở file `main_recognition.py` và chỉnh `img_path` tới file ảnh tham chiếu của bạn. Để tránh lỗi đường dẫn (ví dụ OneDrive với ký tự Unicode), tốt nhất đặt ảnh trong thư mục dự án hoặc sử dụng đường dẫn ASCII.

Ví dụ:

```python
img_path = r"reference.jpg"  # đặt file vào cùng thư mục dự án
```

## Chạy chương trình
1. Kích hoạt môi trường ảo theo hướng dẫn phía trên.
2. Chạy:

```bash
python main_recognition.py
```

Chương trình sẽ mở webcam (nếu có) và hiển thị cửa sổ. Nhấn `q` để thoát.

## Ghi chú
- Nếu gặp lỗi đọc ảnh (ví dụ OpenCV báo không mở được file), kiểm tra lại đường dẫn và quyền truy cập, hoặc thử di chuyển ảnh vào thư mục dự án để loại trừ vấn đề mã hóa tên file/OneDrive.
- Ngưỡng nhận diện hiện mặc định là `0.50`; có thể chỉnh trong mã nếu cần.


