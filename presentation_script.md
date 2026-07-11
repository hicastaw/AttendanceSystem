# 🎓 Kịch Bản Báo Cáo Lab — AttendanceSystem
### Hệ Thống Điểm Danh Khuôn Mặt | Nhóm 2 | Báo cáo ngày 7/5/2026

> **Giảng viên hướng dẫn:** Thầy Phan Văn Khôi
> **Người trình bày:** Trần Trung Hiếu
> **Thời lượng:** 15–20 phút + 5–10 phút Q&A

| Thành viên | Vai trò |
|---|---|
| Lê Quang Vinh | Thành viên |
| Trần Quốc Việt | Thành viên |
| Trần Trung Hiếu | Người trình bày |

---

## 📑 CẤU TRÚC BÀI BÁO CÁO (12 SLIDE)

| # | Tiêu đề | Thời lượng ước tính |
|---|---|---|
| 1 | Trang bìa & Giới thiệu | ~30 giây |
| 2 | Yêu cầu bài toán & Ứng dụng thực tế | ~1–2 phút |
| 3 | Hướng phát triển & Giải pháp đề xuất | ~1–2 phút |
| 4 | Luồng nghiệp vụ tổng quan | ~1 phút |
| 5 | Kiến trúc hệ thống | ~2 phút |
| 6 | Tech Stack | ~1 phút |
| 7 | Kỹ thuật 1: Luồng Đăng ký khuôn mặt | ~1–2 phút |
| 8 | Kỹ thuật 2: Luồng Điểm danh Realtime | ~2 phút |
| 9 | Kỹ thuật 3: Luồng Quản lý & Thống kê | ~1 phút |
| 10 | Luồng Admin — Quản trị hệ thống | ~1 phút |
| 11 | Tổng kết: Yêu cầu gốc vs. Bonus | ~1 phút |
| 12 | Lời cảm ơn & Demo trực tiếp | ~3–4 phút |

---

## 🎬 KỊCH BẢN TỪNG SLIDE

---

### SLIDE 1 — TRANG BÌA & GIỚI THIỆU

**Lời dẫn:**

> *"Kính chào thầy. Em xin phép bắt đầu phần báo cáo kết quả thực hiện đề tài **Hệ Thống Điểm Danh Khuôn Mặt** của Nhóm 2 — gồm các thành viên Lê Quang Vinh, Trần Quốc Việt và em là Trần Trung Hiếu.*
>
> *Bài báo cáo hôm nay em sẽ trình bày theo thứ tự: bắt đầu từ yêu cầu đề tài và bài toán thực tế, tiếp đến là giải pháp nhóm đề xuất, kiến trúc hệ thống, các luồng nghiệp vụ đã cài đặt, và cuối cùng là demo trực tiếp. Kính mời thầy theo dõi."*

---

### SLIDE 2 — YÊU CẦU BÀI TOÁN & ỨNG DỤNG THỰC TẾ

**Lời dẫn:**

> *"Đề tài thầy giao cho nhóm gồm 3 yêu cầu chính: một là triển khai luồng nhận diện khuôn mặt; hai là luồng đăng ký ảnh và nhận diện; ba là hệ thống quản lý điểm danh theo giờ và xuất bảng Excel.*
>
> *Khi áp vào thực tế, nhóm em nhận thấy bài toán điểm danh hiện nay vẫn còn nhiều điểm yếu. Điểm danh thủ công bằng cách gọi tên hoặc ký giấy tốn từ 5 đến 10 phút mỗi buổi, lại dễ sai sót khi tổng hợp và khó theo dõi lịch sử. Còn quẹt thẻ từ hay mã QR thì sinh viên có thể nhờ bạn làm hộ — không đảm bảo người đó thực sự có mặt trong lớp.*
>
> *Từ đó nhóm em đặt ra câu hỏi: làm thế nào để điểm danh **đúng người, đúng giờ, tự động** — và không thể gian lận?"*

---

### SLIDE 3 — HƯỚNG PHÁT TRIỂN & GIẢI PHÁP ĐỀ XUẤT

**Lời dẫn:**

> *"Để trả lời câu hỏi đó, nhóm em đề xuất hướng giải quyết bằng nhận diện khuôn mặt AI. Đây là hướng nhóm tự đưa ra trong quá trình phát triển, không phải yêu cầu bắt buộc của đề tài.*
>
> *Lý do cốt lõi là: khuôn mặt là dữ liệu sinh trắc học duy nhất của mỗi người — không thể nhờ ai mang đến thay. Điều đó giải quyết triệt để vấn đề gian lận.*
>
> *Ngoài ra, với AI, toàn bộ quy trình diễn ra tự động: khi giảng viên kích hoạt phiên, camera tự quét, phát hiện khuôn mặt và đối chiếu với database — không cần thao tác thủ công thêm gì. Trạng thái đến sớm, đúng giờ hay đi muộn cũng được tính ngay tại thời điểm quét.*
>
> *Về tính khả thi, các mô hình AI nhận diện khuôn mặt hiện nay đã đạt độ chính xác cao và có thể chạy hoàn toàn local — không phụ thuộc vào cloud. Như thầy thấy trong bảng so sánh, đây là lợi thế rõ ràng so với phương pháp truyền thống."*

---

### SLIDE 4 — LUỒNG NGHIỆP VỤ TỔNG QUAN

**Lời dẫn:**

> *"Từ hướng giải quyết đó, nhóm em xác định 3 luồng nghiệp vụ cần xây dựng, kết nối với nhau theo thứ tự.*
>
> *Luồng 1 là đăng ký khuôn mặt — sinh viên cần đăng ký ảnh vào hệ thống trước, đây là bước tiền đề bắt buộc vì không có dữ liệu thì không có gì để so sánh.*
>
> *Luồng 2 là điểm danh realtime — đây là luồng cốt lõi. Giảng viên mở phiên, camera tự động nhận diện và ghi nhận từng sinh viên.*
>
> *Luồng 3 là quản lý và thống kê — đầu ra cuối cùng dành cho giảng viên: xem kết quả, chỉnh sửa nếu cần, và xuất file Excel.*
>
> *Từ 3 luồng này, nhóm em tiến hành thiết kế kiến trúc hệ thống."*

---

### SLIDE 5 — KIẾN TRÚC HỆ THỐNG

**Lời dẫn:**

> *"Để đáp ứng 3 luồng nghiệp vụ đó, nhóm em thiết kế hệ thống theo mô hình **4 service độc lập**, kết nối với nhau qua Docker network.*
>
> *Người dùng truy cập qua trình duyệt vào Frontend React chạy ở cổng 5173. Frontend giao tiếp với Backend Node.js qua proxy API. Backend điều phối hai phần còn lại: AI Service viết bằng Python FastAPI ở cổng 8001, và PostgreSQL ở cổng 5432.*
>
> *Điểm đáng chú ý nhất là AI Service được tách hoàn toàn khỏi Backend. Lý do thực tế là Python mới có đủ hệ sinh thái để xử lý ảnh — OpenCV, ONNX Runtime — trong khi Node.js mạnh ở phần API và nghiệp vụ. Tách ra thì mỗi service làm đúng việc của nó.*
>
> *Về database, nhóm em dùng PostgreSQL kết hợp extension pgvector để lưu vector embedding khuôn mặt và tìm kiếm similarity — không cần thêm một hệ thống database riêng."*

---

### SLIDE 6 — TECH STACK

**Lời dẫn:**

> *"Về tech stack, nhìn qua bảng thì điểm đáng nói nhất là pgvector.*
>
> *Thông thường để lưu và tìm kiếm vector embedding, người ta sẽ dùng thêm một vector database riêng như Pinecone hay Weaviate. Nhóm em chọn cách khác: dùng extension pgvector ngay trong PostgreSQL. Với HNSW index, tốc độ tìm kiếm cosine similarity vẫn đảm bảo hiệu năng kể cả khi database có hàng nghìn sinh viên — mà hạ tầng đơn giản hơn rất nhiều, chỉ cần quản lý một database duy nhất.*
>
> *Về phần deploy, toàn bộ hệ thống được đóng gói qua Docker Compose — khởi động chỉ bằng một lệnh duy nhất."*

---

### SLIDE 7 — KỸ THUẬT 1: LUỒNG ĐĂNG KÝ KHUÔN MẶT

**Lời dẫn:**

> *"Bắt đầu từ luồng đăng ký. Khi sinh viên upload ảnh lên, AI Service sẽ xử lý qua một pipeline gồm nhiều bước.*
>
> *Bước đầu tiên là dùng model YuNet để phát hiện khuôn mặt trong ảnh và trả về bounding box cùng 5 điểm landmark — tương ứng với hai mắt, mũi và hai khóe miệng. Trước khi đi tiếp, hệ thống kiểm tra độ sắc nét của vùng mặt bằng chỉ số Laplacian Variance: nếu nhỏ hơn 100 thì ảnh bị coi là mờ và bị từ chối ngay — tránh lưu dữ liệu kém chất lượng vào database.*
>
> *Nếu ảnh đạt yêu cầu, hệ thống căn chỉnh khuôn mặt theo 5 landmark đó, rồi đưa vào model MBF để trích xuất vector embedding 512 chiều. Model này được train trên 600 nghìn danh tính nên có khả năng phân biệt khá tốt. Vector sau khi trích xong được normalize L2 để đảm bảo tính toán cosine similarity chính xác.*
>
> *Người dùng sẽ thấy preview kết quả để xác nhận trước khi lưu. Khi xác nhận, Backend INSERT vào bảng students và face_profiles — và vector đó trở thành 'dấu vân khuôn mặt' của sinh viên trong hệ thống."*

---

### SLIDE 8 — KỸ THUẬT 2: LUỒNG ĐIỂM DANH REALTIME

**Lời dẫn:**

> *"Đây là luồng cốt lõi của hệ thống. Khi giảng viên tạo phiên và kích hoạt, hệ thống lập tức tạo sẵn bản ghi vắng mặt cho toàn bộ sinh viên trong lớp — đây là thiết kế chủ động: mặc định tất cả là vắng, ai quét được thì mới cập nhật.*
>
> *Camera tự động capture mỗi 2 giây — khoảng thời gian này có thể điều chỉnh được. Mỗi frame được gửi sang AI Service và đi qua một pipeline 3 bước.*
>
> *Bước một là phát hiện khuôn mặt bằng YuNet, giống như trong luồng đăng ký. Bước hai — đây là điểm nhóm em bổ sung thêm — là kiểm tra **tính sống thực** bằng hai model MiniFASNet. Model đầu cắt vùng mặt ở tỷ lệ 2.7 để phân tích các đặc trưng vi mô như kết cấu da. Model thứ hai cắt rộng hơn ở tỷ lệ 4.0 để phát hiện các dấu hiệu vật lý của thiết bị giả mạo — như viền điện thoại hay mép giấy in. Chỉ khi cả hai model đều xác nhận đây là người thật, hệ thống mới tiếp tục bước ba.*
>
> *Bước ba là trích xuất embedding bằng MBF rồi dùng pgvector để tìm sinh viên có cosine similarity cao nhất trong database. Nếu đạt ngưỡng 60% trở lên, hệ thống ghi nhận có mặt và tự động tính trạng thái: đến sớm nếu trước giờ bắt đầu, đúng giờ nếu trong khoảng cho phép, đi muộn nếu vượt quá mốc. Frontend hiển thị log với màu sắc tương ứng ngay lập tức.*
>
> *Khi giảng viên chốt phiên, những sinh viên chưa quét được sẽ giữ nguyên trạng thái vắng mặt."*

---

### SLIDE 9 — KỸ THUẬT 3: LUỒNG QUẢN LÝ & THỐNG KÊ

**Lời dẫn:**

> *"Luồng thứ ba là phần dành cho giảng viên sau khi phiên kết thúc.*
>
> *Giảng viên vào Dashboard có thể xem danh sách tất cả phiên với 4 trạng thái: draft, open, submitted và closed. Mở chi tiết một phiên sẽ thấy bảng kết quả điểm danh của từng sinh viên.*
>
> *Trong trường hợp đặc biệt — ví dụ sinh viên có mặt nhưng camera không nhận được do ánh sáng yếu hoặc góc mặt lệch — giảng viên có thể dùng Manual Override để sửa thủ công. Nếu sau đó muốn hoàn tác, hệ thống sẽ tự tính lại dựa trên thời điểm check-in gốc.*
>
> *Sau khi kiểm tra xong, giảng viên chốt phiên để khóa nghiệp vụ, rồi xuất file Excel. File này bao gồm đầy đủ tên sinh viên, mã sinh viên, trạng thái điểm danh, thời điểm check-in thực tế và thông tin phiên học."*

---

### SLIDE 10 — LUỒNG ADMIN — QUẢN TRỊ HỆ THỐNG

**Lời dẫn:**

> *"Luồng thứ tư là Admin — vai trò quản trị toàn hệ thống.*
>
> *Admin có quyền truy cập không giới hạn vào 4 nhóm chức năng chính: quản lý sinh viên — xem toàn bộ danh sách, không bị lọc theo lớp; quản lý giảng viên và học phần; quản lý lớp học; và quản lý điểm danh — xem và override kết quả của bất kỳ phiên nào, kể cả phiên của giảng viên khác.*
>
> *Phân quyền được kiểm soát tập trung qua middleware requireRoles — mỗi API route chỉ chấp nhận đúng vai trò được khai báo, đảm bảo giảng viên không thể truy cập dữ liệu ngoài phạm vi của mình.*
>
> *Tài khoản admin được tạo tự động qua hàm bootstrapAuthSystem khi hệ thống khởi động lần đầu, đảm bảo luôn có người quản trị ngay từ đầu mà không cần thao tác thủ công."*

---

### SLIDE 11 — TỔNG KẾT: YÊU CẦU GỐC vs. BONUS

**Lời dẫn:**

> *"Tóm lại, nhóm em đã hoàn thành cả 3 yêu cầu gốc của đề tài. Luồng nhận diện khuôn mặt với camera realtime và cosine search — hoàn thành. Luồng đăng ký với face alignment và kiểm tra sharpness — hoàn thành. Và hệ thống quản lý điểm danh theo giờ, tự động phân loại trạng thái, xuất Excel — cũng hoàn thành.*
>
> *Ngoài các yêu cầu đó, nhóm em bổ sung thêm một số tính năng trong quá trình phát triển. Đáng kể nhất là Docker Compose — giúp khởi động toàn bộ hệ thống chỉ bằng một lệnh. Điểm danh realtime với camera quét liên tục cũng là tính năng vượt ra ngoài yêu cầu tối thiểu. Và Dashboard cho giảng viên với log hiển thị màu sắc realtime, Manual Override, cùng hệ thống phân quyền 3 vai trò tập trung qua middleware.*
>
> *Em xin phép chuyển sang phần demo để thầy thấy hệ thống hoạt động thực tế."*

---

### SLIDE 12 — LỜI CẢM ƠN & DEMO TRỰC TIẾP

> ⚠️ **Chuẩn bị trước:** Chạy `docker compose up --build` ít nhất **10 phút** trước khi vào phòng để đảm bảo toàn bộ container healthy.

**Kịch bản demo (3–4 phút):**

**[~30 giây] Kiểm tra hệ thống đang chạy**
- Show terminal: tất cả container đều ở trạng thái healthy
- Mở trình duyệt vào `localhost:5173`

**[~60 giây] Luồng đăng ký khuôn mặt** (`localhost:5173/profile`)
- Upload ảnh → AI validate → hiển thị sharpness score
- Xác nhận → Lưu hồ sơ thành công

**[~90 giây] Luồng điểm danh realtime** (`localhost:5173/teacher`)
- Xem danh sách phiên demo
- Mở phiên mới → Kích hoạt → Bật camera
- Đứng trước camera → Log xuất hiện realtime với màu trạng thái
- Chốt phiên → Export Excel → Mở file kiểm tra nhanh

**[~30 giây] Minh họa database** (`localhost:5050` — pgAdmin)
- Show bảng `attendance_records` với dữ liệu thực vừa ghi

**Lời dẫn mở đầu demo:**

> *"Em xin phép demo trực tiếp. Hệ thống đang chạy qua Docker — thầy thấy tất cả container đều healthy. Em sẽ demo lần lượt luồng đăng ký khuôn mặt, sau đó điểm danh realtime, và cuối cùng show dữ liệu trực tiếp trong database."*

**Lời dẫn kết thúc demo:**

> *"Đó là toàn bộ phần demo. Em xin phép kết thúc báo cáo tại đây. Kính mời thầy có câu hỏi hoặc nhận xét về đề tài của nhóm."*

---

## ❓ CÂU HỎI DỰ KIẾN & GỢI Ý TRẢ LỜI

**Q1: Độ chính xác nhận diện của hệ thống là bao nhiêu?**
> *"Trong điều kiện ánh sáng tốt và camera cách mặt khoảng 50 đến 80cm, độ chính xác trên 90%. Ngưỡng 60% cosine similarity là điểm cân bằng nhóm em xác định qua thực nghiệm — thấp hơn thì dễ nhầm người, cao hơn thì từ chối oan khi góc mặt lệch hoặc ánh sáng không đều."*

**Q2: Hệ thống có chống được điểm danh hộ bằng ảnh in không?**
> *"Có — đây là điểm nhóm em đặc biệt chú ý. Hệ thống tích hợp hai model MiniFASNet để kiểm tra tính sống thực trước khi nhận diện. Model đầu phân tích kết cấu da ở cận cảnh, model thứ hai phát hiện dấu hiệu thiết bị giả mạo như viền điện thoại hay mép giấy in. Chỉ khi cả hai xác nhận đây là người thật, hệ thống mới tiếp tục trích embedding."*

**Q3: Tại sao dùng pgvector thay vì một vector database riêng?**
> *"Với quy mô vài trăm đến vài nghìn sinh viên, pgvector với HNSW index hoàn toàn đủ hiệu năng. Dùng chung PostgreSQL giúp hạ tầng đơn giản hơn rất nhiều — không cần quản lý thêm một dịch vụ, không cần đồng bộ dữ liệu giữa hai hệ thống khác nhau."*

**Q4: Tại sao camera quét 2 giây một lần thay vì liên tục?**
> *"2 giây là điểm cân bằng giữa tốc độ phản hồi và tải hệ thống. Mỗi lần quét phải chạy qua cả pipeline anti-spoofing và vector search — nếu quét quá dày sẽ tạo áp lực không cần thiết. Khoảng thời gian này có thể cấu hình được tùy theo phần cứng."*

**Q5: Admin khác giảng viên như thế nào về phân quyền?**
> *"Giảng viên chỉ thấy sinh viên và phiên điểm danh của lớp mình phụ trách — middleware lọc theo lecturer_code. Admin không bị ràng buộc đó: thấy tất cả sinh viên, tất cả phiên của mọi giảng viên, và có thể override bất kỳ bản ghi nào trong hệ thống."*

**Q6: Nếu ánh sáng trong phòng học không tốt thì sao?**
> *"Đây là hạn chế thực tế của hệ thống. Trong trường hợp đó, giảng viên có thể dùng chức năng Manual Override để sửa thủ công cho sinh viên bị bỏ sót. Về lâu dài, hướng cải thiện là dùng camera độ nhạy sáng cao hơn hoặc bổ sung bước tăng cường ảnh trước khi nhận diện."*

---

## 📋 CHECKLIST NGÀY 7/5

- [ ] Chạy `docker compose up --build` và kiểm tra tất cả container healthy
- [ ] Test luồng đăng ký khuôn mặt (upload ảnh thật, xác nhận lưu OK)
- [ ] Test luồng điểm danh realtime (camera bật được, log xuất hiện)
- [ ] Test anti-spoofing (thử giơ ảnh trước camera — phải bị từ chối)
- [ ] Test Manual Override — sửa trạng thái, sau đó hủy override kiểm tra hệ thống tự tính lại
- [ ] Test Export Excel — mở file kiểm tra dữ liệu đầy đủ
- [ ] Đăng nhập pgAdmin, show bảng `attendance_records` với dữ liệu thực
- [ ] Tắt tất cả notification hệ thống trước khi demo
- [ ] Chuẩn bị sẵn tab trình duyệt: `localhost:5173` · `localhost:5173/teacher` · `localhost:5050`
