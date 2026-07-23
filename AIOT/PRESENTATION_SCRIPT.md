# Kịch bản báo cáo — PoC Điểm danh khuôn mặt trên thiết bị biên (Orange Pi)

> Bản rút gọn 13 slide (từ 16 slide): giữ nguyên slide 1–6, thêm slide "Công
> nghệ dự kiến sử dụng", gộp các slide trùng ý (kết nối mạng + xem camera;
> tối ưu + khó khăn; kế hoạch + tiêu chí hoàn thành), bỏ hẳn slide "Luồng xử
> lý điểm danh" vì trùng nội dung với slide 5 và 6.

---

## Slide 1 — Đặt vấn đề và mục tiêu

### Nội dung chính trên slide

**Xây dựng hệ thống điểm danh bằng khuôn mặt trên thiết bị biên**

**Hiện trạng:**

* Hệ thống điểm danh đã chạy được trên máy tính.
* Camera, xử lý AI, backend và giao diện đang chạy tập trung trên máy tính.
* Chưa thể hiện rõ mô hình AIoT và xử lý tại biên.

**Mục tiêu:**

* Chuyển phần xử lý camera và nhận diện khuôn mặt sang Orange Pi.
* Gửi kết quả điểm danh về laptop qua mạng LAN.
* Laptop lưu dữ liệu và hiển thị kết quả.
* Xây dựng bản PoC đơn giản để kiểm chứng kiến trúc.

### Script nói

Trước đây, hệ thống điểm danh bằng khuôn mặt của em đã chạy được trên máy tính. Tuy nhiên, toàn bộ quá trình từ đọc camera, nhận diện khuôn mặt, lưu dữ liệu đến hiển thị giao diện đều chạy tập trung trên cùng một máy.

Cách triển khai này chưa thể hiện rõ đặc trưng của một hệ thống AIoT, trong đó dữ liệu cần được xử lý ngay tại thiết bị gần nguồn thu thập.

Vì vậy, mục tiêu của giai đoạn này là chuyển phần đọc camera và xử lý AI sang Orange Pi. Sau khi nhận diện thành công, thiết bị chỉ gửi kết quả điểm danh về laptop thông qua mạng LAN. Laptop tiếp tục đảm nhiệm backend, database và giao diện quản lý.

---

## Slide 2 — Phạm vi của bản PoC

### Nội dung chính trên slide

**Phạm vi triển khai:**

* 1 camera rời.
* 1 thiết bị biên Orange Pi.
* 1 laptop đóng vai trò server.
* 1 người đứng trước camera tại một thời điểm.
* Kết nối thông qua mạng LAN.

**Chưa triển khai:**

* Nhiều thiết bị và nhiều địa điểm.
* Cloud, Kubernetes hoặc microservices.
* Quản lý thiết bị từ xa.
* Cập nhật model tự động.
* Hệ thống production hoàn chỉnh.

### Script nói

Ở giai đoạn hiện tại, em chỉ tập trung xây dựng một bản Proof of Concept để kiểm chứng khả năng triển khai hệ thống trên thiết bị biên.

Phạm vi gồm một camera rời, một Orange Pi và một laptop. Camera được kết nối trực tiếp với Orange Pi. Orange Pi thực hiện xử lý nhận diện, còn laptop nhận và lưu kết quả điểm danh.

Bản PoC chỉ cần xử lý một người đứng trước camera tại một thời điểm. Em chưa triển khai các thành phần phức tạp như cloud, nhiều thiết bị, quản lý từ xa hoặc kiến trúc microservices.

---

## Slide 3 — Thiết bị biên sử dụng

### Nội dung chính trên slide

**Thiết bị: Xunlong Orange Pi PC**

**Cấu hình:**

* CPU ARMv7, 4 nhân.
* Xung nhịp tối đa khoảng 1,3 GHz.
* RAM khoảng 1 GB.
* Swap khoảng 495 MB.
* Thẻ nhớ microSD khoảng 29 GB dung lượng khả dụng.
* Kiến trúc ARM 32-bit.

**Hệ điều hành:**

* Armbian 26.2.0.
* Debian 13 Trixie.
* Kernel Linux 6.18.
* Chạy headless và quản lý bằng SSH.

### Script nói

Thiết bị biên em sử dụng là Orange Pi PC.

Sau khi kiểm tra trực tiếp trên thiết bị, Orange Pi có CPU ARMv7 bốn nhân, xung nhịp tối đa khoảng 1,3 GHz, RAM khoảng 1 GB và thẻ nhớ microSD khoảng 29 GB.

Thiết bị đang chạy Armbian dựa trên Debian 13 với kiến trúc ARM 32-bit. Do tài nguyên phần cứng khá hạn chế nên hệ thống cần sử dụng model nhẹ, độ phân giải thấp và hạn chế các thư viện tiêu tốn nhiều RAM.

Orange Pi được chạy ở chế độ headless và em quản lý thiết bị từ laptop thông qua SSH.

---

## Slide 4 — Camera và kết nối phần cứng

### Nội dung chính trên slide

**Camera: Logitech C920 Pro HD Webcam**

**Kết nối:**

* Camera kết nối với Orange Pi bằng USB.
* Orange Pi đã nhận đúng thiết bị USB.
* USB ID: `046d:08e5`.
* Hệ điều hành tạo các node:

  * `/dev/video0`
  * `/dev/video1`
  * `/dev/video2`

**Cấu hình dự kiến:**

* Độ phân giải: 640 × 480.
* Tốc độ: 5–10 FPS.
* Định dạng ưu tiên: MJPEG.

### Script nói

Camera được sử dụng là Logitech C920 Pro HD Webcam và được kết nối trực tiếp với Orange Pi qua cổng USB.

Sau khi cắm camera, hệ điều hành đã nhận đúng thiết bị với USB ID là `046d:08e5`. Linux cũng đã tạo các video device như `/dev/video0`, `/dev/video1` và `/dev/video2`.

Chương trình không cố định `/dev/video0` mà tự thử lần lượt các node và kiểm tra node nào thực sự đọc được hình ảnh trước khi sử dụng.

Do cấu hình của Orange Pi thấp, camera sẽ được cấu hình ở độ phân giải 640 nhân 480 và tốc độ khoảng 5 đến 10 FPS.

---

## Slide 5 — Kiến trúc tổng thể của hệ thống

### Nội dung chính trên slide

```text
Camera Logitech C920
          │ USB
          ▼
      Orange Pi PC
  - Camera Capture
  - Face Detection
  - Face Recognition
  - Attendance Decision (check-in / check-out)
  - Duplicate Prevention
          │ HTTP REST qua LAN
          ▼
         Laptop
  - Backend API
  - Database
  - Giao diện quản lý
  - Lịch sử ra/vào
```

### Script nói

Kiến trúc hệ thống được chia thành ba phần chính là camera, thiết bị biên và laptop.

Camera Logitech C920 thu hình ảnh và truyền trực tiếp vào Orange Pi qua USB.

Orange Pi thực hiện toàn bộ quá trình đọc camera, phát hiện khuôn mặt, nhận diện người dùng và tự quyết định đây là lượt vào hay lượt ra.

Sau khi nhận diện thành công, Orange Pi không gửi toàn bộ video về laptop mà chỉ gửi một sự kiện điểm danh nhỏ gọn thông qua HTTP REST API.

Laptop tiếp tục đảm nhiệm backend, database, quản lý người dùng và giao diện hiển thị kết quả.

---

## Slide 6 — Vai trò của thiết bị biên

### Nội dung chính trên slide

**Orange Pi thực hiện:**

* Đọc frame từ camera.
* Phát hiện khuôn mặt.
* Tiền xử lý khuôn mặt (căn chỉnh theo landmark).
* Nhận diện người dùng (so khớp với dữ liệu khuôn mặt đã đồng bộ từ laptop).
* Tính độ tin cậy.
* Tự quyết định check-in hay check-out cho người vừa nhận diện.
* Kiểm tra tránh ghi nhận trùng trong thời gian ngắn.
* Tạo sự kiện điểm danh.
* Gửi kết quả về laptop.
* Cung cấp video realtime phục vụ debug.

### Script nói

Orange Pi là thành phần xử lý chính ở phía biên, và cũng là nơi đưa ra quyết định điểm danh cuối cùng.

Đầu tiên, thiết bị đọc hình ảnh từ camera bằng OpenCV. Sau đó hệ thống phát hiện khuôn mặt, căn chỉnh và đưa vào module nhận diện.

Kết quả nhận diện bao gồm mã người dùng và độ tin cậy. Vì hệ thống chỉ ghi nhận ra/vào chứ không theo phiên học như trước, Orange Pi tự lưu trạng thái gần nhất của từng người ngay trên thiết bị: nếu lần trước là vào thì lần này sẽ là ra, và ngược lại.

Trước khi gửi đi, hệ thống kiểm tra người này có vừa được ghi nhận trong khoảng thời gian gần nhất hay không để tránh tạo nhiều bản ghi liên tục khi một người đứng lâu trước camera.

Nếu hợp lệ, Orange Pi tạo sự kiện điểm danh và gửi về laptop. Ngoài ra, thiết bị cung cấp một luồng video realtime để phục vụ kiểm tra và trình diễn.

---

## Slide 7 — Công nghệ dự kiến sử dụng

### Nội dung chính trên slide

**Thiết bị biên (Orange Pi):**

* Python 3 + OpenCV — phát hiện khuôn mặt (YuNet) và chạy model nhận diện qua `cv2.dnn`.
* Flask — HTTP server phát luồng camera debug.
* Requests — gửi dữ liệu điểm danh qua HTTP.
* systemd — chạy nền, tự khởi động cùng thiết bị.

**Laptop (Server):**

* Node.js + Express — REST API.
* SQLite — lưu trữ dữ liệu, không cần cài đặt dịch vụ database riêng.
* Python + FastAPI — dịch vụ AI rút gọn, chỉ dùng khi đăng ký khuôn mặt mới.
* HTML/CSS/JavaScript thuần — trang quản lý, không cần công cụ build riêng.

**Model AI:**

* YuNet — phát hiện khuôn mặt.
* MobileFaceNet (ArcFace), 512 chiều — trích đặc trưng khuôn mặt.

### Script nói

Về mặt công nghệ, em chia làm hai phía tương ứng với hai vai trò khác nhau.

Trên Orange Pi, em dùng Python kết hợp OpenCV để đọc camera, phát hiện và nhận diện khuôn mặt. Một server Flask nhỏ được dùng để phát luồng camera debug qua HTTP, thư viện Requests dùng để gửi dữ liệu điểm danh, và toàn bộ chương trình được chạy nền bằng systemd để tự khởi động cùng thiết bị.

Trên laptop, em xây dựng server bằng Node.js và Express, lưu dữ liệu bằng SQLite thay vì phải cài đặt một dịch vụ database riêng. Một dịch vụ AI rút gọn viết bằng Python và FastAPI chỉ được dùng khi cần đăng ký khuôn mặt mới. Trang quản lý là HTML, CSS và JavaScript thuần, không cần công cụ build phức tạp.

Về model AI, em sử dụng YuNet để phát hiện khuôn mặt và MobileFaceNet theo kiến trúc ArcFace để trích đặc trưng khuôn mặt thành vector 512 chiều phục vụ nhận diện.

---

## Slide 8 — Dữ liệu truyền giữa Orange Pi và laptop

### Nội dung chính trên slide

**API dự kiến:**

```text
POST /api/access-events
```

**Dữ liệu gửi:**

```json
{
  "event_id": "b6f0b6b0-2b3a-4b8e-9c1d-6f2a1e8d4c77",
  "device_id": "ORANGE_PI_PC_01",
  "user_code": "SV001",
  "event_type": "check_in",
  "timestamp": "2026-07-14T08:15:30+07:00",
  "confidence": 91.2
}
```

**Nguyên tắc:**

* Chỉ gửi kết quả điểm danh, không truyền toàn bộ video.
* `event_id` sinh ngẫu nhiên tại Orange Pi để chống ghi trùng nếu gửi lặp do mất mạng.
* Có timeout khi gọi API, có thử lại nhẹ khi thất bại.
* Mất kết nối không làm chương trình camera dừng.

### Script nói

Orange Pi và laptop giao tiếp thông qua HTTP REST API.

Sau khi nhận diện và xác định xong lượt vào hay ra, Orange Pi gửi một yêu cầu POST đến endpoint `/api/access-events`.

Dữ liệu gồm mã sự kiện, mã thiết bị, mã người dùng, loại sự kiện là vào hay ra, thời gian và độ tin cậy tính theo phần trăm. Mã sự kiện được Orange Pi tự sinh ngẫu nhiên cho mỗi lần gửi, giúp phía laptop nhận biết và bỏ qua nếu vô tình nhận được cùng một sự kiện hai lần do lỗi mạng.

Hệ thống không truyền toàn bộ video về laptop mà chỉ gửi thông tin cần thiết, giúp giảm lượng dữ liệu truyền qua mạng và thể hiện đúng mục tiêu xử lý tại thiết bị biên.

Nếu laptop tạm thời không truy cập được, chương trình trên Orange Pi vẫn tiếp tục đọc camera, tự thử gửi lại, và không bị dừng hoàn toàn.

---

## Slide 9 — Kết nối mạng & xem camera realtime

### Nội dung chính trên slide

**Phương án kết nối cho PoC:**

* Orange Pi kết nối trực tiếp với laptop bằng cáp LAN.
* Laptop dùng Wi-Fi để vào Internet, chia sẻ sang cổng Ethernet (Windows Internet Connection Sharing).
* Laptop Ethernet: `192.168.137.1` — Orange Pi nhận IP trong dải `192.168.137.x`.

**Giao tiếp:** SSH quản lý · HTTP gửi dữ liệu điểm danh · Port 5000 xem camera realtime.

**Xem camera trực tiếp từ laptop:**
```text
http://<IP_ORANGE_PI>:5000            → trang xem trực tiếp
http://<IP_ORANGE_PI>:5000/video_feed → luồng MJPEG
http://<IP_ORANGE_PI>:5000/health     → kiểm tra tình trạng thiết bị
```
Hiển thị trên khung hình: bounding box, tên, confidence, trạng thái vào/ra, FPS.

### Script nói

Trong bản PoC, Orange Pi được kết nối trực tiếp với laptop bằng cáp LAN mà không cần router. Laptop vẫn kết nối Internet bằng Wi-Fi, sau đó chia sẻ kết nối sang cổng Ethernet bằng tính năng Internet Connection Sharing của Windows. Khi đó, cổng Ethernet của laptop có địa chỉ `192.168.137.1`, còn Orange Pi nhận một địa chỉ trong dải `192.168.137.x`.

Trên kết nối này, em dùng SSH để quản lý thiết bị, HTTP để gửi kết quả điểm danh, và riêng port 5000 để xem camera theo thời gian thực ngay trên trình duyệt laptop — phục vụ việc kiểm tra và trình diễn trực quan, không phải là dữ liệu chính được gửi về backend. Khung hình hiển thị thêm bounding box, tên người nhận diện, độ tin cậy, trạng thái vào/ra và FPS ước tính.

---

## Slide 10 — Khó khăn, rủi ro kỹ thuật & phương án tối ưu

### Nội dung chính trên slide

**Giới hạn phần cứng:** CPU ARM 32-bit · RAM khoảng 1 GB · không có GPU AI chuyên dụng.

**Khó khăn kỹ thuật đã gặp:**

* Thư viện `onnxruntime` dùng để nhận diện khuôn mặt không hỗ trợ ARMv7 32-bit.
* Camera có nhiều `/dev/video*`, không phải node nào cũng dùng được.
* IP Orange Pi có thể thay đổi sau khi khởi động lại; thiết bị có thể nóng khi xử lý liên tục.

**Phương án tối ưu & xử lý:**

* Camera 640×480, 5–10 FPS, chỉ xử lý mỗi 3–5 frame, chỉ 1 người tại 1 thời điểm.
* Load model một lần khi khởi động; backend, database, giao diện giữ trên laptop.
* Đã kiểm chứng `onnxruntime` không có bản cài cho ARMv7 → chuyển sang chạy model nhận diện qua `cv2.dnn`, giữ nguyên model và độ chính xác.
* Có phương án dự phòng: chuyển nhận diện về laptop qua mạng nếu `cv2.dnn` không chạy được, chỉ cần đổi 1 dòng cấu hình.
* Cấu hình camera/server qua file `.env`, không hard-code; tự thử lại camera khi mất kết nối.

### Script nói

Khó khăn lớn nhất là Orange Pi PC có cấu hình khá thấp, chỉ khoảng 1 GB RAM, dùng CPU ARM 32-bit và không có GPU AI chuyên dụng.

Một rủi ro quan trọng em phát hiện khi phân tích là thư viện `onnxruntime` — vốn dùng để chạy model nhận diện khuôn mặt — không có bản cài đặt cho kiến trúc ARMv7, dù thử qua cả cài bằng pip lẫn cài bằng apt của Debian. Thay vì bỏ tính năng nhận diện tại biên, em chuyển sang chạy đúng model đó qua module `cv2.dnn` có sẵn trong OpenCV, giữ nguyên thuật toán và độ chính xác, chỉ đổi cách thực thi. Nếu cách này không chạy được trên phần cứng thật, em đã chuẩn bị sẵn phương án dự phòng là chuyển việc nhận diện về laptop, chỉ cần đổi một dòng cấu hình.

Ngoài ra, camera tạo nhiều video device nên chương trình tự xác định đúng node hỗ trợ lấy hình thay vì cố định sẵn. IP của Orange Pi cũng có thể đổi sau khi khởi động lại nên mọi địa chỉ kết nối đều được đưa vào file cấu hình. Về hiệu năng, em giảm độ phân giải xuống 640×480, chỉ xử lý 5–10 khung hình mỗi giây và không chạy AI trên mọi frame để giảm tải cho CPU.

---

## Slide 11 — Tiến độ đã thực hiện

### Nội dung chính trên slide

**Phần cứng & kết nối:**

* Xác định đúng model Orange Pi PC, kiểm tra CPU, RAM, bộ nhớ, hệ điều hành.
* SSH thành công từ laptop vào Orange Pi.
* Kết nối qua router và kết nối LAN trực tiếp đều thành công.
* Orange Pi nhận camera Logitech C920, xác định các node `/dev/video*`.

**Phần mềm — đã viết xong và kiểm thử:**

* Toàn bộ chương trình chạy trên Orange Pi: đọc camera, phát hiện khuôn mặt, nhận diện, quyết định vào/ra, chống trùng, gửi dữ liệu, luồng xem camera realtime.
* Toàn bộ server trên laptop: API nhận sự kiện, cơ sở dữ liệu, trang quản lý web để đăng ký khuôn mặt và xem lịch sử ra/vào.
* Đã kiểm thử server bằng kịch bản thực tế: tạo người dùng, gửi sự kiện điểm danh, xem log — hoạt động đúng như thiết kế.
* Script cài đặt, cấu hình, và dịch vụ chạy nền (systemd) cho Orange Pi đã hoàn tất.

### Script nói

Đến hiện tại, em đã hoàn thành các bước chuẩn bị về phần cứng và kết nối: xác định đúng thiết bị Orange Pi PC, kiểm tra cấu hình, SSH thành công, thử cả hai cách kết nối qua router và cắm LAN trực tiếp, và Orange Pi đã nhận đúng camera Logitech C920 qua USB.

Quan trọng hơn, em đã hoàn thành toàn bộ phần mềm cho cả hai phía. Trên Orange Pi, chương trình đọc camera, phát hiện, nhận diện, quyết định vào hay ra, chống trùng, gửi dữ liệu và phát luồng camera realtime đã được viết đầy đủ. Trên laptop, em đã xây dựng xong server nhận dữ liệu, cơ sở dữ liệu và một trang quản lý web để đăng ký khuôn mặt cũng như xem lại lịch sử ra vào.

Phần server này em đã kiểm thử trực tiếp bằng cách tạo người dùng thử, gửi sự kiện điểm danh và xem log — mọi thứ hoạt động đúng như thiết kế. Em cũng đã chuẩn bị sẵn script cài đặt và dịch vụ chạy nền để Orange Pi tự khởi động chương trình sau khi bật máy.

---

## Slide 12 — Kế hoạch tiếp theo & tiêu chí hoàn thành PoC

### Nội dung chính trên slide

**Phần mềm đã sẵn sàng, các bước tiếp theo là chạy và xác nhận trên phần cứng thật:**

1. Triển khai code từ laptop sang Orange Pi.
2. Xác nhận camera mở đúng node, chụp ảnh thử thành công.
3. Xác nhận model nhận diện chạy được qua `cv2.dnn` trên phần cứng thật.
4. Đo FPS, độ trễ thực tế, tinh chỉnh cấu hình nếu cần.
5. Kiểm thử mất mạng / mất camera, xác nhận chương trình không dừng.
6. Cài đặt chạy nền bằng systemd, kiểm thử tự khởi động sau khi reboot.

**PoC được coi là hoàn thành khi:**

* Orange Pi đọc được camera, phát hiện và nhận diện được người dùng.
* Tự phân loại đúng lượt vào/ra và tránh ghi nhận liên tục.
* Gửi sự kiện điểm danh về laptop; laptop lưu và hiển thị đúng kết quả.
* Xem được camera realtime trên trình duyệt.
* Chương trình chạy headless và tự khởi động sau khi Orange Pi reboot.

### Script nói

Vì phần mềm cho cả Orange Pi và laptop đã được viết và kiểm thử xong ở mức có thể làm được trên máy tính phát triển, các bước tiếp theo tập trung vào việc chạy và xác nhận trên chính phần cứng thật: triển khai code sang Orange Pi, xác nhận camera mở đúng node, và quan trọng nhất là xác nhận model nhận diện chạy được qua `cv2.dnn` ngay trên thiết bị — đây là rủi ro kỹ thuật lớn nhất đã nêu ở phần trước. Sau đó em sẽ đo FPS, độ trễ thực tế, kiểm thử các tình huống mất mạng hoặc mất camera để đảm bảo chương trình không dừng, rồi cài đặt chạy nền bằng systemd và xác nhận Orange Pi tự khởi động lại chương trình sau khi reboot.

Bản PoC được coi là hoàn thành khi Orange Pi đọc được camera, phát hiện và nhận diện được một người đứng trước thiết bị, tự phân loại đúng đây là lượt vào hay lượt ra mà không ghi nhận liên tục, gửi kết quả về laptop để lưu và hiển thị, đồng thời có thể xem camera realtime qua trình duyệt, chạy ở chế độ headless và tự khởi động sau khi thiết bị được bật lại.

---

## Slide 13 — Kết luận

### Nội dung chính trên slide

**Kiến trúc được lựa chọn:**

```text
Camera USB
    ↓
Orange Pi xử lý AI và quyết định vào/ra
    ↓
HTTP REST qua LAN
    ↓
Laptop lưu dữ liệu và hiển thị
```

**Giá trị của phương án:**

* Thể hiện rõ mô hình AIoT.
* Xử lý dữ liệu ngay tại thiết bị biên.
* Giảm lượng video truyền qua mạng.
* Dễ triển khai và trình diễn.
* Tận dụng được hệ thống hiện có trên máy tính.

### Script nói

Tóm lại, phương án em lựa chọn là camera USB kết nối trực tiếp với Orange Pi, Orange Pi thực hiện xử lý AI, tự quyết định vào/ra và chỉ gửi kết quả điểm danh về laptop thông qua HTTP REST API.

Phương án này thể hiện rõ mô hình AIoT vì dữ liệu được xử lý ngay tại thiết bị biên thay vì gửi toàn bộ video về máy tính.

Đồng thời, kiến trúc vẫn tận dụng được backend, database và giao diện quản lý, giúp giảm thời gian chỉnh sửa và phù hợp với phạm vi của một bản PoC.

Em xin hết phần báo cáo và mong nhận được góp ý của thầy và các anh.
