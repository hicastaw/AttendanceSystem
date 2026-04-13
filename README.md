🎓 Hệ Thống Điểm Danh Sinh Viên PTIT (Face Recognition Attendance)
Dự án này là một hệ thống điểm danh tự động dựa trên nhận diện khuôn mặt thời gian thực, được phát triển nhằm mục đích tối ưu hóa việc quản lý sinh viên tại giảng đường. Hệ thống sử dụng các mô hình Deep Learning tiên tiến để đảm bảo độ chính xác và tốc độ xử lý trên các thiết bị laptop cá nhân như Asus ExpertBook.

🛠 Công Nghệ Sử Dụng (Technical Stack)
Hệ thống được xây dựng trên nền tảng ngôn ngữ Python và các thư viện chuyên dụng:

OpenCV: Xử lý hình ảnh, điều khiển Webcam và hiển thị giao diện người dùng.

ONNX Runtime: Thực thi các mô hình AI (.onnx) hiệu năng cao.

NumPy: Tính toán đại số tuyến tính cho các vector đặc trưng (Embedding).

YuNet: Mô hình phát hiện khuôn mặt (Face Detection) tốc độ cao.

MobileFaceNet: Mô hình trích xuất đặc trưng khuôn mặt (Face Recognition) với vector 512 chiều.
 
🚀 Nguyên Lý Hoạt Động (The Pipeline)
Luồng xử lý của file main_recognition.py bao gồm các bước sau:

Khởi tạo Singleton Engine: FaceEngine được thiết lập theo mẫu thiết kế Singleton để đảm bảo các mô hình AI chỉ được nạp vào RAM một lần duy nhất, giúp tiết kiệm tài nguyên.

Đăng ký dữ liệu mẫu: Hệ thống đọc ảnh thẻ sinh viên (vinh.jpg), căn chỉnh khuôn mặt (Align) và trích xuất vector đặc trưng Embedding 1.

Quét mặt thời gian thực:

Mở camera ở chế độ Full Screen để sinh viên dễ dàng quan sát.

Liên tục bắt khung hình và sử dụng YuNet để tìm kiếm khuôn mặt.

Kiểm tra độ mờ (Blurry check) bằng thuật toán Laplacian để đảm bảo chất lượng ảnh đầu vào.

Đối soát (Verification):

Trích xuất vector đặc trưng từ Camera.

Sử dụng Cosine Similarity (thông qua NumPy) để so sánh vector camera với vector ảnh thẻ.

Ra quyết định: Nếu độ tương đồng cao hơn 0.50, hệ thống xác nhận danh tính và in kết quả "Cùng một người".

💻 Hướng Dẫn Cài Đặt
Cài đặt môi trường ảo:

Bash
python -m venv .venv
source .venv/bin/activate  # Trên Windows: .venv\Scripts\activate
Cài đặt các thư viện:

Bash
pip install -r requirements.txt
Chạy ứng dụng:

Bash
python main_recognition.py
📝 Lưu Ý
Đảm bảo Webcam của bạn hoạt động bình thường và môi trường đủ ánh sáng.

Tên file ảnh thẻ phải trùng khớp với biến img_path khai báo trong code.

Nhấn phím 'q' để thoát khỏi màn hình điểm danh.
