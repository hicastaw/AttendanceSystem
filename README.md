# 🎓 Hướng Dẫn Sử Dụng Hệ Thống Nhận Diện Khuôn Mặt (PTIT)

Hệ thống này thực hiện so sánh khuôn mặt từ Webcam thời gian thực với một ảnh thẻ có sẵn để đưa ra kết luận về danh tính sinh viên.

## 🛠 Hướng Dẫn Cấu Hình (Setup)
Để chương trình hoạt động đúng ý muốn, cậu cần thực hiện bước quan trọng nhất là thiết lập **Ảnh đối chiếu (Reference Image):**
1. **Chuẩn bị ảnh:** Đảm bảo cậu đã có một file ảnh rõ mặt (ví dụ: vinh.jpg hoặc hung.jpg) nằm cùng thư mục với file main_recognition.py.
2. **Sửa đường dẫn trong code:** Mở file main_recognition.py, tìm dòng số 9 và thay đổi tên file ảnh của cậu vào:
   VD: Thay "hung.jpg" bằng tên file ảnh của bạn
   ```bash
			img_path = "ten_anh_cua_ban.jpg"
   ```
🚀 Cách Chạy Chương TrìnhMở Terminal (hoặc CMD) tại thư mục dự án.Gõ lệnh sau để khởi động:
```Bash
python main_recognition.py
```
3. **Hoạt động:** Một cửa sổ camera sẽ hiện lên ở chế độ Toàn màn hình (Full Screen).
- Cậu hãy đứng trước webcam sao cho rõ mặt nhất.
- Nhấn phím 'q' nếu muốn thoát chương trình thủ công.

## 📊 Kết Quả Đầu Ra (Output)
Sau khi AI trích xuất thành công khuôn mặt từ camera, nó sẽ tự động tính toán độ tương đồng dựa trên công thức **Cosine Similarity:**

$$\text{similarity} = \frac{\mathbf{v_1} \cdot \mathbf{v_2}}{\|\mathbf{v_1}\| \|\mathbf{v_2}\|}$$

Kết quả sẽ được hiển thị ngay tại Terminal dưới hai dạng:
| Dữ liệu hiển thị| Ý nghĩa | 
| :-- | :-- |
| Số thập phân (Ví dụ: 0.9245) | Chỉ số tương đồng giữa 2 khuôn mặt.|
| "Cùng một người" | Xuất hiện nếu chỉ số Similarity > 0.50. |
| "Khác người" | Xuất hiện nếu chỉ số Similarity <= 0.50. | 
## ⚠️ Lưu Ý Quan Trọng
1. Môi trường: Cần đủ ánh sáng để webcam bắt được đặc điểm khuôn mặt chính xác nhất.
2. Thoát chương trình: Vòng lặp while sẽ tự động break ngay khi nhận diện thành công 1 frame ảnh từ camera.
