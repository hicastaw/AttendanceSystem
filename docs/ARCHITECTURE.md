# Kiến trúc đề xuất cho hệ thống điểm danh phòng lab

## 1. Mục tiêu tài liệu

Tài liệu này mô tả kiến trúc mục tiêu của hệ thống điểm danh và ghi nhận ra/vào phòng lab bằng khuôn mặt. Nội dung tập trung vào cấu trúc hệ thống, pipeline xử lý tại thiết bị biên, cơ chế lưu trữ cục bộ và đồng bộ với server.

Phần lựa chọn, đánh giá và huấn luyện mô hình AI được trình bày trong tài liệu riêng. Trong tài liệu này, các mô hình chỉ được xem như những thành phần của pipeline suy luận.

> **Phạm vi triển khai:** một phòng lab, một cửa, một camera Logitech C920 và khoảng 20–30 người dùng.

### 1.1. Mục tiêu chính

- Xử lý nhận diện khuôn mặt hoàn toàn tại thiết bị biên.
- Không phụ thuộc vào kết nối mạng trong đường xử lý thời gian thực.
- Tiếp tục ghi nhận sự kiện khi server hoặc mạng gặp sự cố.
- Tự động đồng bộ dữ liệu sau khi kết nối được khôi phục.
- Hiển thị hướng dẫn và kết quả trực tiếp trên màn hình tại cửa.
- Có khả năng vận hành liên tục 24/7.
- Cho phép nâng cấp hoặc thay thế mô hình AI mà không phải thay đổi toàn bộ hệ thống.

---

## 2. Tổng quan kiến trúc

Hệ thống được thiết kế theo hai nguyên tắc:

- **Edge-first:** Orange Pi tự thực hiện toàn bộ quá trình nhận diện và quyết định sự kiện.
- **Offline-first:** dữ liệu được ghi cục bộ trước, sau đó mới đồng bộ với server.

Kiến trúc gồm ba khối chính:

1. **Thiết bị đầu cuối:** camera Logitech C920 và màn hình HDMI.
2. **Thiết bị biên:** Orange Pi 5 xử lý camera, AI, nghiệp vụ, giao diện và lưu trữ offline.
3. **Server trung tâm:** quản lý người dùng, dữ liệu khuôn mặt, lịch sử sự kiện và trạng thái thiết bị.

<!-- IMAGE_PLACEHOLDER: system-overview -->
> **Ảnh cần bổ sung:** Sơ đồ tổng quan Camera → Orange Pi 5 → Server, trong đó màn hình và SQLite nằm tại edge.

### 2.1. Luồng dữ liệu tổng quát

```text
Logitech C920
    ↓
Camera Service
    ↓
AI Inference Pipeline
    ↓
Matching & Temporal Confirmation
    ↓
Attendance Engine
    ├──→ Kiosk UI
    ├──→ SQLite Edge
    └──→ Sync Service → Server API → Database
```

Server không tham gia vào quyết định nhận diện thời gian thực. Nếu server không khả dụng, các khối từ camera đến Attendance Engine vẫn tiếp tục hoạt động.

---

## 3. Kiến trúc thiết bị biên

Orange Pi 5 là thiết bị xử lý trung tâm tại cửa phòng lab. Các chức năng được tách thành những thành phần độc lập để dễ kiểm thử, giám sát và khởi động lại khi xảy ra lỗi.

| Thành phần | Trách nhiệm |
|---|---|
| Camera Service | Mở camera, đọc frame, reconnect khi camera bị ngắt |
| AI Inference Service | Phát hiện, căn chỉnh và trích xuất embedding khuôn mặt |
| Quality Gate | Kiểm tra độ nét, ánh sáng, kích thước và góc khuôn mặt |
| Matching Service | So khớp embedding đầu vào với dữ liệu cục bộ |
| Temporal Confirmation | Tổng hợp kết quả qua nhiều frame liên tiếp |
| Attendance Engine | Áp dụng cooldown và quyết định sự kiện vào/ra |
| Local Repository | Quản lý SQLite, embedding cache và hàng đợi sự kiện |
| Sync Service | Đồng bộ dữ liệu hai chiều với server |
| Kiosk UI | Hiển thị hướng dẫn, kết quả và trạng thái hệ thống |
| Health Monitor | Giám sát camera, NPU, nhiệt độ, mạng và dung lượng |

<!-- IMAGE_PLACEHOLDER: edge-components -->
> **Ảnh cần bổ sung:** Sơ đồ các service chạy trong Orange Pi và quan hệ giữa chúng.

### 3.1. Phân bổ tài nguyên xử lý

- **NPU:** chạy các mô hình phát hiện và trích xuất embedding đã chuyển sang RKNN.
- **CPU:** đọc camera, tiền/hậu xử lý, căn chỉnh hình học, đối sánh vector và nghiệp vụ.
- **GPU/VPU:** hỗ trợ hiển thị giao diện và giải mã video khi phù hợp.
- **RAM:** chứa model runtime, frame buffer, embedding của người dùng và trạng thái ứng dụng.
- **NVMe:** chứa hệ điều hành, SQLite, log và dữ liệu đang chờ đồng bộ.

---

## 4. Pipeline xử lý nhận diện

Pipeline nhận diện được thực hiện hoàn toàn tại Orange Pi.

<!-- IMAGE_PLACEHOLDER: recognition-pipeline -->
> **Ảnh cần bổ sung:** Infographic pipeline từ camera đến kết quả điểm danh.

### 4.1. Bước 1 — Thu nhận hình ảnh

Camera Logitech C920 được truy cập thông qua V4L2.

Cấu hình khởi điểm đề xuất:

- Capture ở độ phân giải `1280 × 720`.
- Tốc độ camera tối đa 30 FPS.
- Định dạng MJPEG để giảm tải truyền dữ liệu qua USB.
- Giao diện có thể hiển thị 20–30 FPS.
- Pipeline AI chỉ cần xử lý khoảng 10–15 FPS cho bài toán chấm công.

Camera Service phải có khả năng phát hiện lỗi đọc frame, giải phóng camera và tự kết nối lại mà không cần khởi động toàn bộ thiết bị.

### 4.2. Bước 2 — Phát hiện khuôn mặt

Detector nhận frame đã resize và trả về:

- Bounding box của khuôn mặt.
- Điểm tin cậy phát hiện.
- Năm landmark: hai mắt, mũi và hai khóe miệng.

Trong kiến trúc mục tiêu, detector dự kiến chạy trên NPU. Tên model và cấu hình lượng tử hóa có thể thay đổi mà không ảnh hưởng tới các tầng phía sau nếu giữ nguyên interface đầu ra.

### 4.3. Bước 3 — Kiểm tra chất lượng

Frame chỉ được chuyển sang nhận diện khi đáp ứng các điều kiện chất lượng:

- Có đúng số lượng khuôn mặt cho phép.
- Điểm phát hiện vượt ngưỡng.
- Khuôn mặt đủ lớn trong khung hình.
- Ảnh không bị mờ đáng kể.
- Độ sáng nằm trong khoảng cho phép.
- Góc quay và độ nghiêng không vượt giới hạn.
- Khuôn mặt không bị cắt khỏi khung hình.

Nếu không đạt, giao diện hướng dẫn người dùng điều chỉnh vị trí thay vì tiếp tục suy luận không cần thiết.

### 4.4. Bước 4 — Căn chỉnh khuôn mặt

Năm landmark được dùng để tính phép biến đổi hình học. Khuôn mặt được xoay, căn thẳng và đưa về kích thước chuẩn `112 × 112`.

Căn chỉnh giúp giảm sai lệch do:

- Người dùng đứng lệch vị trí.
- Camera được lắp không hoàn toàn ngang.
- Khuôn mặt hơi nghiêng hoặc xoay.
- Khoảng cách giữa người dùng và camera thay đổi.

### 4.5. Bước 5 — Trích xuất embedding

Ảnh đã căn chỉnh được đưa vào recognizer để tạo embedding 512 chiều. Embedding sau đó được chuẩn hóa L2 trước khi đối sánh.

Tầng này chỉ trả về vector đặc trưng, không trực tiếp quyết định danh tính.

### 4.6. Bước 6 — Đối sánh đa mẫu

Mỗi người có từ 5–10 embedding được thu ở các góc và điều kiện khác nhau. Toàn bộ embedding được nạp vào RAM khi edge khởi động hoặc sau khi nhận bản cập nhật từ server.

Với 30 người, mỗi người 10 mẫu và mỗi embedding gồm 512 số `float32`, dung lượng xấp xỉ:

```text
30 × 10 × 512 × 4 byte ≈ 0,59 MB
```

Do quy mô dữ liệu nhỏ, hệ thống có thể so sánh trực tiếp bằng cosine similarity mà không cần vector database.

Matching Service trả về tối thiểu:

- Danh tính có điểm cao nhất.
- Điểm top-1.
- Điểm top-2.
- Khoảng cách giữa top-1 và top-2.
- Mẫu khuôn mặt đã tạo ra điểm top-1.

### 4.7. Bước 7 — Xác nhận qua nhiều frame

Hệ thống không tạo sự kiện từ một kết quả đơn lẻ. Một danh tính chỉ được xác nhận khi:

```text
Chất lượng khuôn mặt đạt yêu cầu
AND điểm top-1 vượt threshold
AND khoảng cách top-1/top-2 vượt margin
AND cùng danh tính xuất hiện ít nhất 3/5 frame gần nhất
```

Nếu không đủ điều kiện, hệ thống yêu cầu người dùng thử lại. Cách tiếp cận này ưu tiên tránh nhận nhầm hơn việc cố gắng chấp nhận mọi lượt quét.

### 4.8. Bước 8 — Tạo sự kiện

Sau khi xác nhận, Attendance Engine:

1. Kiểm tra cooldown để chống quét lặp.
2. Xác định loại sự kiện theo quy tắc nghiệp vụ.
3. Sinh `event_id` dạng UUID.
4. Ghi sự kiện xuống SQLite.
5. Cập nhật giao diện.
6. Đưa sự kiện vào hàng đợi đồng bộ.

---

## 5. Cơ chế đăng ký khuôn mặt

Mỗi người nên được đăng ký từ 5–10 mẫu thay vì chỉ một ảnh.

Các tư thế đề xuất:

- Chính diện.
- Nghiêng nhẹ sang trái.
- Nghiêng nhẹ sang phải.
- Hơi ngẩng.
- Hơi cúi.
- Có kính nếu người dùng thường xuyên đeo kính.

Hệ thống tự động thu mẫu trong một khoảng thời gian ngắn. Chỉ những frame đạt Quality Gate và đủ khác với các mẫu đã thu mới được chấp nhận.

<!-- IMAGE_PLACEHOLDER: face-enrollment -->
> **Ảnh cần bổ sung:** Minh họa quá trình thu nhiều góc mặt và tạo nhiều embedding cho một người.

### 5.1. Quy trình đăng ký

```text
Admin tạo người dùng
    ↓
Camera thu các frame đạt chất lượng
    ↓
Phát hiện và căn chỉnh khuôn mặt
    ↓
Tạo 5–10 embedding
    ↓
Lưu trên server và tăng phiên bản dữ liệu
    ↓
Orange Pi tải bản cập nhật về SQLite
```

Để dữ liệu gần với môi trường vận hành, nên ưu tiên đăng ký bằng chính camera và vị trí lắp đặt của hệ thống.

---

## 6. Cơ chế lưu trữ cục bộ

SQLite trên Orange Pi là nguồn dữ liệu vận hành khi thiết bị offline.

### 6.1. Các nhóm dữ liệu chính

| Bảng đề xuất | Nội dung |
|---|---|
| `users` | Thông tin người dùng được phép nhận diện |
| `face_embeddings` | Nhiều embedding của từng người |
| `access_events` | Lịch sử sự kiện được tạo tại edge |
| `sync_queue` | Các thao tác đang chờ gửi lên server |
| `device_state` | Phiên bản dữ liệu và trạng thái đồng bộ |
| `recognition_metrics` | Thống kê vận hành và thời gian xử lý, nếu cần |

### 6.2. Nguyên tắc ghi dữ liệu

Sự kiện luôn được ghi cục bộ trước khi gửi lên server:

```text
Nhận diện thành công
    ↓
BEGIN TRANSACTION
    ↓
Ghi access_events
    ↓
Ghi sync_queue
    ↓
COMMIT
    ↓
Hiển thị kết quả và thử đồng bộ
```

Cách này bảo đảm sự kiện không bị mất nếu mạng hoặc tiến trình đồng bộ gặp lỗi ngay sau khi nhận diện.

SQLite nên sử dụng WAL mode để giảm xung đột giữa luồng ghi sự kiện và luồng đồng bộ.

---

## 7. Cơ chế offline và đồng bộ

<!-- IMAGE_PLACEHOLDER: offline-sync -->
> **Ảnh cần bổ sung:** Sơ đồ hai nhánh online/offline và quá trình gửi lại hàng đợi.

### 7.1. Khi kết nối bình thường

1. Edge ghi sự kiện vào SQLite.
2. Sync Service gửi sự kiện lên server.
3. Server lưu sự kiện dựa trên `event_id`.
4. Server trả xác nhận.
5. Edge đánh dấu sự kiện là `synced`.

### 7.2. Khi mất mạng hoặc server lỗi

- Camera và pipeline AI tiếp tục hoạt động.
- Dữ liệu khuôn mặt được đọc từ cache cục bộ.
- Sự kiện mới được lưu với trạng thái `pending`.
- Giao diện hiển thị trạng thái offline.
- Sync Service retry theo khoảng thời gian tăng dần.

### 7.3. Khi kết nối được khôi phục

1. Sync Service kiểm tra các sự kiện `pending`.
2. Sự kiện được gửi theo thời gian phát sinh.
3. Server sử dụng `event_id` để chống ghi trùng.
4. Edge chỉ đánh dấu `synced` sau khi nhận xác nhận.
5. Hàng đợi tiếp tục được xử lý cho tới khi không còn sự kiện pending.

### 7.4. Đồng bộ dữ liệu khuôn mặt

Dữ liệu khuôn mặt được đồng bộ từ server xuống edge theo phiên bản:

1. Server tăng `face_data_version` khi người dùng hoặc embedding thay đổi.
2. Edge định kỳ kiểm tra phiên bản mới nhất.
3. Nếu phiên bản thay đổi, edge tải gói dữ liệu mới.
4. Gói dữ liệu được kiểm tra đầy đủ trước khi kích hoạt.
5. Edge thay cache theo một transaction để tránh trạng thái cập nhật dở dang.
6. Bản dữ liệu gần nhất được giữ lại để rollback nếu cần.

---

## 8. Vai trò của server

Server không thực hiện nhận diện trong đường xử lý chính. Các trách nhiệm gồm:

- Xác thực admin và thiết bị edge.
- Quản lý người dùng.
- Quản lý nhiều embedding của mỗi người.
- Cung cấp phiên bản dữ liệu cho edge.
- Nhận và lưu sự kiện vào/ra.
- Chống ghi trùng dựa trên `event_id`.
- Cung cấp trang quản trị và bộ lọc lịch sử.
- Theo dõi health và lần kết nối gần nhất của thiết bị.
- Sao lưu dữ liệu tập trung.

Kiến trúc này giúp server có thể tạm thời ngừng hoạt động mà không làm gián đoạn việc ghi nhận tại cửa.

---

## 9. Giao diện tại thiết bị

Kiosk UI chạy trên màn hình HDMI và có các trạng thái chính:

- Đang chờ người dùng.
- Vui lòng nhìn thẳng vào camera.
- Mặt quá xa, ảnh mờ hoặc ánh sáng không phù hợp.
- Đang nhận diện.
- Nhận diện thành công.
- Không nhận diện được, vui lòng thử lại.
- Thiết bị đang offline, sự kiện sẽ được đồng bộ sau.
- Camera hoặc dịch vụ AI gặp lỗi.

Giao diện không cần cảm ứng. Các thao tác quản trị được thực hiện trên trang web của server.

<!-- IMAGE_PLACEHOLDER: kiosk-states -->
> **Ảnh cần bổ sung:** Bộ mockup các trạng thái chính của giao diện kiosk.

---

## 10. Cơ chế check-in/check-out

Trong PoC hiện tại, loại sự kiện được xác định bằng cơ chế toggle:

```text
Chưa có trạng thái hoặc lần trước là check-out → check-in
Lần trước là check-in → check-out
```

Trạng thái gần nhất được lưu cục bộ và khôi phục sau khi thiết bị khởi động lại.

### 10.1. Giới hạn của toggle

Cơ chế có thể sai khi:

- Người dùng quên quét lúc ra.
- Người dùng quét hai lần không chủ ý.
- Trạng thái từ ngày hôm trước chưa được reset.
- Có nhiều cửa hoặc nhiều thiết bị cùng ghi nhận một người.

### 10.2. Hướng cải tiến

- Reset trạng thái theo ngày và lịch hoạt động của phòng lab.
- Đặt thời gian tối thiểu giữa check-in và check-out.
- Thêm hai nút vật lý “Vào” và “Ra”.
- Kết hợp cảm biến cửa.
- Sử dụng hai vùng theo dõi hoặc hai camera để suy ra hướng di chuyển.

Với một camera đơn và không có cảm biến bổ sung, hệ thống không thể xác định hướng vào/ra hoàn toàn chính xác chỉ dựa vào khuôn mặt.

---

## 11. Vận hành liên tục 24/7

### 11.1. Phần cứng

- Dùng NVMe thay vì chỉ dùng microSD.
- Trang bị tản nhiệt chủ động và quạt.
- Sử dụng nguồn ổn định, đúng công suất.
- Bố trí vỏ thông thoáng và có khả năng vệ sinh quạt.
- Ưu tiên Ethernet; nếu dùng Wi-Fi thì sử dụng adapter tương thích Linux ổn định.

### 11.2. Phần mềm

- Quản lý các service bằng systemd.
- Tự khởi động lại service khi tiến trình thoát bất thường.
- Có watchdog phát hiện tiến trình bị treo.
- Tự reconnect camera và server.
- Cấu hình log rotation.
- Theo dõi nhiệt độ và dung lượng ổ đĩa.
- Đồng bộ thời gian bằng NTP.
- Có cơ chế graceful shutdown cho SQLite.

### 11.3. Health check

Health Monitor nên cung cấp trạng thái:

- Camera có đang đọc được frame không.
- Model và NPU runtime có hoạt động không.
- SQLite có thể đọc/ghi không.
- Server có kết nối được không.
- Số sự kiện đang chờ đồng bộ.
- Nhiệt độ CPU/NPU.
- RAM và dung lượng ổ đĩa còn lại.
- Thời điểm nhận diện và đồng bộ thành công gần nhất.

---

## 12. Bảo mật và quyền riêng tư

- Mỗi thiết bị có `device_id` và khóa xác thực riêng.
- Không lưu khóa hoặc mật khẩu trực tiếp trong source code.
- Ưu tiên HTTPS khi triển khai ngoài mạng lab tin cậy.
- Chỉ đồng bộ dữ liệu cần thiết.
- Hạn chế lưu ảnh khuôn mặt sau khi đã tạo embedding.
- Nếu cần lưu ảnh phục vụ kiểm tra, phải có thời hạn lưu và quyền truy cập rõ ràng.
- Database và bản sao lưu phải được bảo vệ khỏi truy cập trái phép.

---

## 13. Khả năng mở rộng

Kiến trúc có thể mở rộng theo hai hướng.

### 13.1. Mở rộng số người trong một phòng

Với vài trăm người, đối sánh cosine trực tiếp vẫn có thể đáp ứng. Khi dữ liệu lớn hơn, Matching Service có thể được thay bằng thư viện tìm kiếm vector mà không ảnh hưởng đến pipeline camera.

### 13.2. Mở rộng nhiều phòng hoặc nhiều cửa

- Mỗi Orange Pi có `device_id` riêng.
- Server quản lý phiên bản dữ liệu theo thiết bị hoặc địa điểm.
- Sự kiện luôn chứa thông tin thiết bị và cửa.
- Database server có thể chuyển từ SQLite sang PostgreSQL.
- Có thể bổ sung dashboard theo dõi nhiều thiết bị.

---

## 14. Những thay đổi cần thực hiện so với PoC

| Hạng mục | PoC hiện tại | Kiến trúc mục tiêu |
|---|---|---|
| AI runtime | OpenCV DNN trên CPU | RKNN Runtime trên NPU |
| Số mẫu mỗi người | Một embedding | 5–10 embedding |
| Xác nhận | Kết quả từng frame | Đồng thuận 3/5 frame |
| Lưu sự kiện khi mất mạng | Có thể bị bỏ | SQLite queue bền vững |
| Đồng bộ | Gửi trực tiếp | Retry có trạng thái và chống trùng |
| Giao diện edge | MJPEG debug | Kiosk UI trên màn hình HDMI |
| Health check | Cơ bản | Camera, NPU, DB, nhiệt độ và sync queue |
| Lưu trữ edge | Phụ thuộc môi trường | NVMe, WAL và log rotation |
| Vận hành | PoC thủ công | systemd, watchdog và tự phục hồi |

---

## 15. Trình tự triển khai

1. Cập nhật database để hỗ trợ nhiều embedding cho mỗi người.
2. Hoàn thiện quy trình đăng ký 5–10 mẫu.
3. Tích hợp model RKNN vào pipeline edge.
4. Bổ sung Quality Gate và xác nhận nhiều frame.
5. Xây dựng SQLite offline queue.
6. Hoàn thiện Sync Service và cơ chế chống trùng.
7. Xây dựng Kiosk UI.
8. Bổ sung health monitoring, watchdog và log rotation.
9. Benchmark trên Orange Pi 5.
10. Kiểm thử mất mạng, mất camera, restart và vận hành dài hạn.

---

## 16. Kết luận

Kiến trúc đề xuất phân tách rõ hai vai trò:

- **Orange Pi xử lý và quyết định tại chỗ.**
- **Server quản lý, đồng bộ và lưu trữ tập trung.**

Thiết kế edge-first giúp giảm độ trễ và không phụ thuộc mạng. Thiết kế offline-first giúp bảo đảm sự kiện được lưu an toàn trước khi đồng bộ. Việc tách pipeline AI, nghiệp vụ, lưu trữ và đồng bộ thành các thành phần độc lập giúp hệ thống dễ kiểm thử, bảo trì và mở rộng.

> **Nguyên tắc vận hành:** Edge tự xử lý — dữ liệu được lưu trước — server đồng bộ sau.

