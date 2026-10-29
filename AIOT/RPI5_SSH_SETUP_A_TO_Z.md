# Raspberry Pi 5 từ A đến Z cho người mới
## Cài Raspberry Pi OS Lite, thiết lập mạng, SSH, Camera Module 3 và chuẩn bị cho AI HAT+ 2

> **Đối tượng:** Người mới hoàn toàn với Raspberry Pi/Linux/SSH.  
> **Máy tính hướng dẫn chính:** Windows 10/11.  
> **Phần cứng đích:** Raspberry Pi 5 + microSD + nguồn 27W + Ethernet + Raspberry Pi Camera Module 3.  
> **Dự án sau khi bring-up:** Edge AI Kiosk, `SCRFD-10G + ArcFace R50` trên Raspberry Pi AI HAT+ 2 / Hailo-10H.  
> **Mục tiêu của tài liệu này:** Đưa Raspberry Pi từ trạng thái “bo mạch mới/thẻ mới” tới trạng thái bạn có thể ngồi trên laptop, SSH vào Pi, chạy lệnh Linux, truyền file, kiểm tra camera và sẵn sàng cài Hailo.

---

# Mục lục

1. [Hiểu đúng trước khi bắt đầu](#1-hiểu-đúng-trước-khi-bắt-đầu)
2. [Những thứ cần chuẩn bị](#2-những-thứ-cần-chuẩn-bị)
3. [Phần mềm cần cài trên máy tính](#3-phần-mềm-cần-cài-trên-máy-tính)
4. [Cài Raspberry Pi OS lên thẻ nhớ](#4-cài-raspberry-pi-os-lên-thẻ-nhớ)
5. [Thiết lập SSH ngay trong Raspberry Pi Imager](#5-thiết-lập-ssh-ngay-trong-raspberry-pi-imager)
6. [Lắp thẻ, mạng và bật Raspberry Pi lần đầu](#6-lắp-thẻ-mạng-và-bật-raspberry-pi-lần-đầu)
7. [Cách kết nối mạng nên dùng](#7-cách-kết-nối-mạng-nên-dùng)
8. [Tìm Raspberry Pi trên mạng](#8-tìm-raspberry-pi-trên-mạng)
9. [SSH vào Raspberry Pi bằng Windows PowerShell](#9-ssh-vào-raspberry-pi-bằng-windows-powershell)
10. [Các lệnh Linux đầu tiên cần biết](#10-các-lệnh-linux-đầu-tiên-cần-biết)
11. [Update hệ điều hành lần đầu](#11-update-hệ-điều-hành-lần-đầu)
12. [Kiểm tra Pi 5 có hoạt động ổn định không](#12-kiểm-tra-pi-5-có-hoạt-động-ổn-định-không)
13. [Truyền file giữa Windows và Raspberry Pi](#13-truyền-file-giữa-windows-và-raspberry-pi)
14. [Dùng VS Code để code trực tiếp trên Raspberry Pi](#14-dùng-vs-code-để-code-trực-tiếp-trên-raspberry-pi)
15. [Thiết lập SSH key](#15-thiết-lập-ssh-key)
16. [Gắn và kiểm tra Camera Module 3](#16-gắn-và-kiểm-tra-camera-module-3)
17. [Test Camera Module 3 khi Pi không có màn hình](#17-test-camera-module-3-khi-pi-không-có-màn-hình)
18. [Test Picamera2 bằng Python](#18-test-picamera2-bằng-python)
19. [Chuẩn bị AI HAT+ 2 / Hailo-10H](#19-chuẩn-bị-ai-hat-2--hailo-10h)
20. [Checklist trước khi bắt đầu code dự án](#20-checklist-trước-khi-bắt-đầu-code-dự-án)
21. [Các lỗi thường gặp và cách sửa](#21-các-lỗi-thường-gặp-và-cách-sửa)
22. [Cheat sheet lệnh thường dùng](#22-cheat-sheet-lệnh-thường-dùng)
23. [Lộ trình tiếp theo cho Edge AI Kiosk](#23-lộ-trình-tiếp-theo-cho-edge-ai-kiosk)
24. [Tài liệu chính thức](#24-tài-liệu-chính-thức)

---

# 1. Hiểu đúng trước khi bắt đầu

## 1.1 Raspberry Pi không giống một bo Arduino

Raspberry Pi 5 là một máy tính hoàn chỉnh.

Nó cần:

```text
Raspberry Pi 5
    +
microSD có hệ điều hành
    +
nguồn điện
    +
mạng
    =
một máy Linux có thể SSH vào
```

Bạn sẽ dùng Raspberry Pi OS giống như dùng Ubuntu/Linux trên một máy tính khác.

---

## 1.2 SSH là gì?

SSH = **Secure Shell**.

Nó cho phép bạn ngồi ở laptop và điều khiển terminal của Raspberry Pi qua mạng.

Ví dụ:

```text
Laptop Windows
      |
      |  mạng LAN / Wi-Fi
      |
      v
Raspberry Pi 5
```

Trên laptop bạn gõ:

```bash
ssh ten_user@rpi5-kiosk.local
```

Sau đó terminal đang hiện trên laptop thực chất là terminal của Raspberry Pi.

Bạn có thể:

- cài phần mềm;
- sửa file;
- chạy Python;
- clone Git repository;
- chạy camera;
- cài Hailo;
- chạy service;
- đọc log;
- reboot Pi;

mà **không cần màn hình và bàn phím cắm trực tiếp vào Pi**.

---

## 1.3 SSH KHÔNG dùng để cài OS lên một thẻ trắng

Đây là điểm cần nhớ.

Quy trình đúng:

```text
THẺ TRẮNG
    |
    v
Laptop ghi Raspberry Pi OS bằng Raspberry Pi Imager
    |
    v
Cắm thẻ vào Pi
    |
    v
Pi boot Raspberry Pi OS
    |
    v
SSH mới hoạt động
```

Không thể:

```text
thẻ trắng
    -> SSH
    -> cài OS
```

vì khi chưa có OS thì Raspberry Pi chưa có SSH server để bạn kết nối.

---

# 2. Những thứ cần chuẩn bị

## 2.1 Tối thiểu để cài OS và SSH

Bạn cần:

- Raspberry Pi 5.
- Nguồn USB-C phù hợp, dự án hiện tại dùng nguồn 27W 5.1V/5A.
- Một thẻ microSD.
- **Khe đọc microSD/SD trên laptop hoặc USB card reader.**
- Laptop/PC.
- Kết nối mạng.

Tốt nhất có thêm:

- cáp Ethernet RJ45;
- router/modem mạng;
- Active Cooler cho Raspberry Pi 5.

---

## 2.2 Camera chưa cần cho việc cài OS

Camera Module 3 chỉ cần sau khi:

```text
OS OK
-> SSH OK
-> update hệ thống OK
-> mới test camera
```

---

## 2.3 AI HAT+ 2 cũng chưa cần trong bước đầu

Bạn có thể hoàn thành toàn bộ:

```text
flash OS
boot
SSH
update
camera
Python/Picamera2
```

trước khi cài AI HAT+ 2.

Nếu đã có AI HAT+ 2, chỉ lắp khi Pi **đã tắt nguồn hoàn toàn**.

---

# 3. Phần mềm cần cài trên máy tính

## 3.1 Raspberry Pi Imager — bắt buộc

Dùng để ghi Raspberry Pi OS vào thẻ nhớ.

Trang chính thức:

https://www.raspberrypi.com/software/

Cài **Raspberry Pi Imager** cho Windows.

---

## 3.2 Windows Terminal hoặc PowerShell — nên dùng

Windows 10/11 thường đã có PowerShell và OpenSSH Client.

Bạn có thể mở:

```text
Start
-> gõ "PowerShell"
-> Enter
```

Hoặc cài **Windows Terminal** từ Microsoft Store để dùng terminal dễ hơn.

Kiểm tra SSH:

```powershell
ssh -V
```

Nếu thấy kiểu:

```text
OpenSSH_for_Windows_...
```

thì đã dùng được.

---

## 3.3 Visual Studio Code — rất nên cài

Trang:

https://code.visualstudio.com/

Sau này bạn có thể code trên Raspberry Pi qua SSH mà giao diện vẫn là VS Code trên laptop.

Extension cần:

```text
Remote - SSH
```

---

## 3.4 WinSCP — tùy chọn

Nếu chưa quen lệnh `scp`, WinSCP giúp kéo-thả file bằng giao diện.

Trang:

https://winscp.net/

Không bắt buộc.

---

# 4. Cài Raspberry Pi OS lên thẻ nhớ

> Nếu bạn đang dùng thẻ tạm đã có OS thì có thể bỏ qua phần này.  
> Khi chuyển sang Samsung PRO Plus 128GB mới, bạn cần làm phần này.

## 4.1 Tắt Raspberry Pi trước khi tháo thẻ

Nếu Pi đang chạy:

```bash
sudo shutdown -h now
```

Đợi LED/ngắt hoạt động rồi mới rút nguồn và tháo thẻ.

Không rút điện đột ngột nếu không cần thiết.

---

## 4.2 Cắm microSD vào laptop

Nếu laptop có khe:

```text
microSD -> adapter SD (nếu cần) -> laptop
```

Nếu không có:

```text
microSD -> USB card reader -> laptop
```

---

## 4.3 Mở Raspberry Pi Imager

Chọn:

### Device

```text
Raspberry Pi 5
```

### Operating System

Đối với giai đoạn SSH/headless của dự án:

```text
Raspberry Pi OS (other)
    -> Raspberry Pi OS Lite (64-bit)
```

Ưu tiên bản **64-bit Trixie**.

Không cần Desktop ở bước đầu.

Lý do:

- nhẹ;
- ít dịch vụ không cần thiết;
- phù hợp SSH;
- phù hợp edge device;
- Hailo-10H yêu cầu Raspberry Pi OS 64-bit Trixie trong tài liệu hiện tại.

### Storage

Chọn đúng thẻ:

```text
Samsung PRO Plus 128GB
```

hoặc thẻ bạn đang cài.

**Cẩn thận:** ghi image sẽ xóa dữ liệu trên thẻ.

---

# 5. Thiết lập SSH ngay trong Raspberry Pi Imager

Đây là bước rất quan trọng.

Imager hiện có phần **OS Customisation**.

Bạn nên thiết lập trước khi ghi thẻ.

---

## 5.1 Hostname

Đặt:

```text
rpi5-kiosk
```

Sau này bạn có thể thử SSH bằng:

```bash
ssh USERNAME@rpi5-kiosk.local
```

---

## 5.2 Username

Ví dụ:

```text
kiosk
```

Bạn có thể dùng tên khác.

**Không giả định username mặc định là `pi`.**

Các bản Raspberry Pi OS hiện đại yêu cầu bạn tạo user.

Trong tài liệu này, từ đây tôi sẽ dùng ví dụ:

```text
username = kiosk
hostname = rpi5-kiosk
```

Nếu bạn chọn user khác, hãy thay `kiosk` bằng user của bạn.

---

## 5.3 Password

Đặt password đủ mạnh.

Ví dụ KHÔNG nên dùng:

```text
123456
raspberry
password
```

Hãy ghi nhớ password này vì SSH lần đầu sẽ hỏi.

---

## 5.4 Wi-Fi

Dù có Ethernet, nên cấu hình luôn Wi-Fi nhà bạn.

Điền:

```text
SSID: tên Wi-Fi
Password: mật khẩu Wi-Fi
Country: VN
```

Như vậy nếu tháo Ethernet, Pi vẫn có thể lên mạng.

---

## 5.5 Timezone

Chọn:

```text
Asia/Ho_Chi_Minh
```

Keyboard layout có thể chọn phù hợp.

---

## 5.6 Bật SSH

Trong phần Remote Access:

```text
Enable SSH = ON
```

Ban đầu có thể chọn:

```text
Use password authentication
```

Sau khi SSH chạy ổn, ta sẽ chuyển sang SSH key.

---

## 5.7 Ghi thẻ

Bấm:

```text
NEXT / WRITE
```

Xác nhận xóa thẻ.

Chờ:

```text
Writing
-> Verifying
-> Complete
```

Sau khi hoàn tất, eject thẻ an toàn.

---

# 6. Lắp thẻ, mạng và bật Raspberry Pi lần đầu

## 6.1 Trình tự

Khi Pi đang **không có nguồn**:

1. Cắm microSD vào Raspberry Pi 5.
2. Nếu dùng Ethernet, cắm Ethernet.
3. Nếu đã lắp Active Cooler, kiểm tra dây quạt.
4. Chưa cần camera ở lần boot đầu nếu bạn muốn làm đơn giản.
5. Cuối cùng mới cắm nguồn USB-C.

---

## 6.2 Chờ lần boot đầu

Lần boot đầu có thể lâu hơn bình thường.

Chờ khoảng một lúc để hệ thống:

- mở rộng filesystem;
- tạo user;
- cấu hình SSH;
- nhận DHCP;
- khởi động service.

Không rút nguồn chỉ vì chưa SSH vào được ngay.

---

# 7. Cách kết nối mạng nên dùng

Có nhiều cách. Với người mới, dùng cách A.

---

## Cách A — Khuyến nghị: Pi và laptop cùng router

Ví dụ:

```text
                 +-------------+
Laptop --Wi-Fi-->|             |
                 |   Router    |
Pi -----Ethernet>|             |
                 +-------------+
```

Hoặc cả hai đều Ethernet.

Đây là cách dễ nhất vì router cấp IP DHCP tự động.

Bạn **không nhất thiết phải nối cáp Ethernet trực tiếp Pi -> laptop**.

---

## Cách B — Pi dùng Wi-Fi

Nếu bạn đã cấu hình Wi-Fi trong Imager:

```text
Laptop --- Wi-Fi --- Router --- Wi-Fi --- Pi
```

SSH vẫn hoạt động.

---

## Cách C — Ethernet trực tiếp laptop -> Pi

Có thể làm nhưng phức tạp hơn cho người mới vì cần IP/DHCP hoặc Internet Connection Sharing.

Nếu chưa hiểu networking, **đừng chọn cách này làm lần đầu**.

Nếu bắt buộc phải dùng trực tiếp trên Windows, một phương án là bật Internet Connection Sharing từ Wi-Fi của laptop sang Ethernet. Windows thường tạo một mạng riêng và cấp IP cho thiết bị phía Ethernet, nhưng hành vi có thể thay đổi tùy cấu hình máy.

Ưu tiên dùng router/switch nếu có.

---

# 8. Tìm Raspberry Pi trên mạng

## 8.1 Thử hostname trước

Mở PowerShell:

```powershell
ping rpi5-kiosk.local
```

Nếu được, bạn sẽ thấy IP.

Sau đó SSH:

```powershell
ssh kiosk@rpi5-kiosk.local
```

---

## 8.2 Nếu `.local` không hoạt động

Tìm IP theo một trong các cách sau.

### Cách 1 — Router

Vào trang quản trị router.

Tìm:

```text
Connected devices
DHCP clients
LAN clients
```

Tìm hostname:

```text
rpi5-kiosk
```

Ví dụ IP:

```text
192.168.1.57
```

SSH:

```powershell
ssh kiosk@192.168.1.57
```

---

### Cách 2 — PowerShell

Xem ARP table:

```powershell
arp -a
```

Nếu mạng nhỏ, bạn có thể nhận ra IP mới xuất hiện.

---

### Cách 3 — ping hostname

```powershell
ping rpi5-kiosk
```

hoặc:

```powershell
ping rpi5-kiosk.local
```

---

# 9. SSH vào Raspberry Pi bằng Windows PowerShell

Giả sử:

```text
username: kiosk
hostname: rpi5-kiosk
```

Gõ:

```powershell
ssh kiosk@rpi5-kiosk.local
```

Hoặc theo IP:

```powershell
ssh kiosk@192.168.1.57
```

---

## 9.1 Lần đầu sẽ hỏi fingerprint

Ví dụ:

```text
The authenticity of host ... can't be established.
Are you sure you want to continue connecting (yes/no/[fingerprint])?
```

Nếu đây đúng là Pi của bạn, gõ:

```text
yes
```

Enter.

---

## 9.2 Nhập password

Khi terminal hỏi:

```text
kiosk@rpi5-kiosk.local's password:
```

hãy nhập password đã tạo trong Raspberry Pi Imager.

**Lưu ý:** khi gõ password, terminal thường không hiện `*` hay ký tự nào.

Đó là bình thường.

Nhập xong rồi Enter.

---

## 9.3 Dấu hiệu SSH thành công

Bạn sẽ thấy prompt kiểu:

```text
kiosk@rpi5-kiosk:~ $
```

Từ thời điểm này:

> Mọi lệnh bạn nhập trong cửa sổ đó đang chạy trên Raspberry Pi.

---

## 9.4 Thoát SSH

```bash
exit
```

hoặc:

```text
Ctrl + D
```

---

# 10. Các lệnh Linux đầu tiên cần biết

## Bạn đang là user nào?

```bash
whoami
```

---

## Tên máy

```bash
hostname
```

---

## Xem thư mục hiện tại

```bash
pwd
```

---

## Liệt kê file

```bash
ls
```

Chi tiết hơn:

```bash
ls -lah
```

---

## Đi vào thư mục

```bash
cd ten_thu_muc
```

Về home:

```bash
cd ~
```

Lùi một cấp:

```bash
cd ..
```

---

## Tạo thư mục

```bash
mkdir test
```

---

## Tạo file

```bash
touch hello.txt
```

---

## Xem file text

```bash
cat hello.txt
```

---

## Sửa file bằng nano

```bash
nano hello.txt
```

Trong nano:

```text
Ctrl+O  = save
Enter   = xác nhận tên
Ctrl+X  = thoát
```

---

## Xóa file

```bash
rm hello.txt
```

Xóa thư mục rỗng:

```bash
rmdir test
```

**Cẩn thận với `rm -rf`.**

---

## Quyền admin: sudo

Ví dụ:

```bash
sudo apt update
```

`sudo` có nghĩa là chạy lệnh với quyền quản trị.

Không dùng `sudo` bừa bãi.

---

# 11. Update hệ điều hành lần đầu

Sau khi SSH thành công:

```bash
sudo apt update
```

Sau đó:

```bash
sudo apt full-upgrade -y
```

Có thể mất một lúc.

Sau đó reboot:

```bash
sudo reboot
```

SSH sẽ bị ngắt.

Chờ Pi boot lại rồi SSH lại:

```powershell
ssh kiosk@rpi5-kiosk.local
```

---

# 12. Kiểm tra Pi 5 có hoạt động ổn định không

Sau SSH:

## Architecture

```bash
uname -m
```

Kỳ vọng:

```text
aarch64
```

---

## OS version

```bash
cat /etc/os-release
```

Kiểm tra là Raspberry Pi OS 64-bit/Trixie theo cấu hình dự án.

---

## Kernel

```bash
uname -a
```

---

## RAM

```bash
free -h
```

---

## Dung lượng thẻ

```bash
df -h
```

---

## CPU info

```bash
lscpu
```

---

## IP hiện tại

```bash
hostname -I
```

Hoặc:

```bash
ip addr
```

---

## Nhiệt độ CPU

```bash
vcgencmd measure_temp
```

---

## Kiểm tra throttling/undervoltage

```bash
vcgencmd get_throttled
```

Trạng thái lý tưởng:

```text
throttled=0x0
```

Nếu có flag khác, cần điều tra nguồn/nhiệt.

---

# 13. Truyền file giữa Windows và Raspberry Pi

SSH cho terminal.

`scp` dùng để copy file qua SSH.

---

## 13.1 Copy file từ Windows sang Pi

Trong PowerShell trên Windows:

```powershell
scp C:\Users\YOUR_NAME\Desktop\test.py kiosk@rpi5-kiosk.local:/home/kiosk/
```

Sau đó SSH vào Pi:

```bash
ls -lah
```

Bạn sẽ thấy `test.py`.

---

## 13.2 Copy file từ Pi về Windows

Ví dụ lấy ảnh camera:

```powershell
scp kiosk@rpi5-kiosk.local:/home/kiosk/test.jpg C:\Users\YOUR_NAME\Desktop\
```

---

## 13.3 Copy cả thư mục

Windows -> Pi:

```powershell
scp -r C:\Users\YOUR_NAME\Desktop\project kiosk@rpi5-kiosk.local:/home/kiosk/
```

---

# 14. Dùng VS Code để code trực tiếp trên Raspberry Pi

Đây là cách tôi khuyên dùng khi bắt đầu code project.

## 14.1 Cài extension

Mở VS Code.

Extensions:

```text
Remote - SSH
```

Install.

---

## 14.2 Kết nối

Nhấn:

```text
Ctrl + Shift + P
```

Tìm:

```text
Remote-SSH: Connect to Host...
```

Nhập:

```text
kiosk@rpi5-kiosk.local
```

Hoặc IP.

VS Code sẽ mở cửa sổ mới.

Ở góc dưới bạn sẽ thấy đang kết nối remote.

---

## 14.3 Mở thư mục code

Ví dụ tạo:

```bash
mkdir -p ~/projects/attendance
```

Trong VS Code Remote:

```text
File
-> Open Folder
-> /home/kiosk/projects/attendance
```

Từ đây:

- VS Code hiển thị trên laptop;
- file thực tế nằm trên Raspberry Pi;
- terminal VS Code chạy trên Raspberry Pi;
- Python chạy trên Raspberry Pi.

---

# 15. Thiết lập SSH key

Ban đầu password là đủ.

Sau khi SSH ổn định, nên dùng SSH key.

---

## 15.1 Tạo key trên Windows

PowerShell:

```powershell
ssh-keygen -t ed25519 -C "rpi5-kiosk"
```

Có thể nhấn Enter để dùng path mặc định:

```text
C:\Users\YOUR_NAME\.ssh\id_ed25519
```

Nó tạo:

```text
id_ed25519       <- PRIVATE KEY, không chia sẻ
id_ed25519.pub   <- PUBLIC KEY
```

---

## 15.2 Copy public key sang Pi

PowerShell:

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh kiosk@rpi5-kiosk.local "umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys"
```

Nhập password lần cuối.

---

## 15.3 Test

Thoát rồi:

```powershell
ssh kiosk@rpi5-kiosk.local
```

Nếu cấu hình đúng, bạn có thể không cần password tài khoản nữa.

---

## 15.4 Chưa tắt password authentication ngay

Với người mới, chỉ tắt password sau khi:

```text
SSH key đã test thành công
+
bạn có backup private key
```

Tránh tự khóa mình khỏi Pi.

---

# 16. Gắn và kiểm tra Camera Module 3

## 16.1 Tắt Pi hoàn toàn

Trước khi gắn/rút camera:

```bash
sudo shutdown -h now
```

Sau đó rút nguồn USB-C.

**Không cắm/rút cáp camera khi Pi còn nguồn.**

---

## 16.2 Cáp Camera Module 3 với Raspberry Pi 5

Dự án của bạn cần đúng loại:

```text
Raspberry Pi 5 side:
mini 22-pin

Camera Module 3 side:
standard 15-pin
```

Tức:

```text
22-pin <-> 15-pin FPC
```

Không lấy nhầm cáp 15-pin <-> 15-pin đời Pi cũ.

---

## 16.3 Kiểm tra chiều cáp

Đầu FPC phải:

- vào thẳng;
- không lệch;
- khóa connector đóng đúng;
- không bị gập mạnh;
- không bị HAT/vỏ kẹp.

Nếu camera không nhận, lỗi chiều/cắm cáp là một trong những thứ đầu tiên cần kiểm tra.

---

# 17. Test Camera Module 3 khi Pi không có màn hình

Sau khi cắm camera và bật lại Pi:

SSH vào.

---

## 17.1 Liệt kê camera

```bash
rpicam-hello --list-cameras
```

Nếu nhận Camera Module 3, bạn sẽ thấy sensor kiểu:

```text
imx708
```

---

## 17.2 Vì bạn đang headless, đừng phụ thuộc preview

Lệnh `rpicam-hello` thường dùng preview.

Khi không có màn hình, cách thực tế hơn là chụp ảnh không preview:

```bash
rpicam-still -n -o ~/test_camera.jpg
```

Sau đó kiểm tra file:

```bash
ls -lh ~/test_camera.jpg
```

---

## 17.3 Copy ảnh về laptop

Trên Windows PowerShell:

```powershell
scp kiosk@rpi5-kiosk.local:/home/kiosk/test_camera.jpg C:\Users\YOUR_NAME\Desktop\
```

Mở ảnh trên laptop.

Nếu ảnh rõ, camera cơ bản đã hoạt động.

---

## 17.4 Quay video headless

Ví dụ 5 giây:

```bash
rpicam-vid -n -t 5000 -o ~/test_camera.h264
```

Kiểm tra:

```bash
ls -lh ~/test_camera.h264
```

---

# 18. Test Picamera2 bằng Python

Dự án của bạn sau này dùng Picamera2.

---

## 18.1 Kiểm tra Python

```bash
python3 --version
```

---

## 18.2 Kiểm tra Picamera2

```bash
python3 -c "from picamera2 import Picamera2; print('Picamera2 OK')"
```

Nếu báo module chưa có:

```bash
sudo apt update
sudo apt install -y python3-picamera2
```

---

## 18.3 Tạo script test

```bash
mkdir -p ~/projects/camera-test
cd ~/projects/camera-test
nano test_picamera2.py
```

Dán:

```python
from picamera2 import Picamera2
from time import sleep

picam2 = Picamera2()

config = picam2.create_still_configuration()
picam2.configure(config)

picam2.start()

# Cho autofocus/exposure ổn định một chút
sleep(2)

output = "picamera2_test.jpg"
picam2.capture_file(output)

picam2.stop()

print(f"Saved: {output}")
```

Save:

```text
Ctrl+O
Enter
Ctrl+X
```

Chạy:

```bash
python3 test_picamera2.py
```

Kiểm tra:

```bash
ls -lh picamera2_test.jpg
```

---

## 18.4 Copy ảnh về Windows

PowerShell:

```powershell
scp kiosk@rpi5-kiosk.local:/home/kiosk/projects/camera-test/picamera2_test.jpg C:\Users\YOUR_NAME\Desktop\
```

Nếu ảnh đúng:

```text
Camera hardware
+ cable
+ Raspberry Pi camera stack
+ Picamera2
```

đều đã hoạt động.

---

# 19. Chuẩn bị AI HAT+ 2 / Hailo-10H

> Phần này chỉ làm khi bạn đã có AI HAT+ 2 và lắp đúng phần cứng.  
> Đây là bước bắt đầu gần với dự án AI, không phải điều kiện để SSH.

## 19.1 Tắt nguồn trước khi lắp

```bash
sudo shutdown -h now
```

Rút USB-C.

---

## 19.2 Thứ tự phần cứng

Theo kế hoạch dự án:

1. Active Cooler trên Raspberry Pi 5.
2. Cáp Camera Module 3.
3. Heatsink đi kèm AI HAT+ 2.
4. Spacer/stacking hardware.
5. PCIe cable.
6. AI HAT+ 2.
7. Kiểm tra cáp camera không bị kẹp.
8. Cấp nguồn.

---

## 19.3 Cài runtime Hailo-10H

Sau khi Pi boot và SSH lại:

```bash
sudo apt update
sudo apt full-upgrade -y
```

Cài:

```bash
sudo apt install -y dkms
sudo apt install -y hailo-h10-all
```

**AI HAT+ 2 / Hailo-10H dùng `hailo-h10-all`.**

Không cài nhầm:

```text
hailo-all
```

đó là package khác cho họ Hailo-8/8L.

Reboot:

```bash
sudo reboot
```

---

## 19.4 Xác minh Hailo

SSH lại:

```bash
hailortcli fw-control identify
```

Xem version:

```bash
hailortcli --version
```

Package:

```bash
apt policy hailo-h10-all
```

Nếu identify thành công, bạn đã hoàn thành bring-up cơ bản của Hailo-10H.

---

# 20. Checklist trước khi bắt đầu code dự án

Đừng nhảy vào SCRFD/ArcFace trước khi checklist này xanh.

## Hardware

- [ ] Raspberry Pi 5 boot ổn định.
- [ ] Active Cooler hoạt động.
- [ ] Nguồn ổn định.
- [ ] microSD hoạt động.
- [ ] Camera Module 3 nhận đúng.
- [ ] Cáp camera đúng 22-pin -> 15-pin.
- [ ] AI HAT+ 2 nhận đúng nếu đã lắp.

## OS

- [ ] Raspberry Pi OS Lite 64-bit.
- [ ] Trixie.
- [ ] `uname -m` -> `aarch64`.
- [ ] `apt update/full-upgrade` xong.

## Network

- [ ] Pi có IP.
- [ ] SSH bằng hostname hoặc IP được.
- [ ] Reboot xong SSH lại được.

## Camera

- [ ] `rpicam-hello --list-cameras` thấy IMX708.
- [ ] `rpicam-still -n` chụp được ảnh.
- [ ] copy ảnh về laptop được.
- [ ] Picamera2 Python chạy được.

## Power / thermal

- [ ] `vcgencmd get_throttled` không báo bất thường.
- [ ] `vcgencmd measure_temp` hợp lý.

## Hailo — nếu đã lắp HAT

- [ ] `hailo-h10-all` cài thành công.
- [ ] `hailortcli fw-control identify` thấy Hailo-10H.

Sau checklist này mới chuyển sang:

```text
SCRFD-10G
-> 5 landmarks
-> alignment 112x112
-> ArcFace R50
-> embedding
-> matching
```

---

# 21. Các lỗi thường gặp và cách sửa

# Lỗi 1 — `ssh: Could not resolve hostname rpi5-kiosk.local`

Nguyên nhân:

- mDNS không resolve;
- Pi chưa boot;
- hostname khác;
- không cùng mạng.

Thử dùng IP:

```powershell
ssh kiosk@192.168.1.57
```

Tìm IP trên router.

---

# Lỗi 2 — SSH timeout

Ví dụ:

```text
Connection timed out
```

Kiểm tra:

1. Pi có nguồn?
2. Thẻ có OS?
3. Ethernet có link LED?
4. Pi và laptop có cùng router?
5. Router có cấp IP?
6. SSH có bật trong Imager?

---

# Lỗi 3 — `Connection refused`

Pi có IP nhưng SSH server chưa chạy/bị tắt.

Nếu bạn đang dùng thẻ tạm và có cách vào terminal Pi:

```bash
sudo systemctl enable --now ssh
```

Kiểm tra:

```bash
systemctl status ssh
```

---

# Lỗi 4 — `Permission denied`

Thường do:

- sai username;
- sai password;
- nhầm user `pi`;
- key sai.

Nhớ username chính là user bạn tạo trong Raspberry Pi Imager.

Ví dụ:

```powershell
ssh kiosk@rpi5-kiosk.local
```

không phải mặc định:

```powershell
ssh pi@...
```

nếu bạn chưa tạo user `pi`.

---

# Lỗi 5 — Reflash thẻ xong SSH báo host key changed

Ví dụ:

```text
WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!
```

Nếu bạn vừa tự reflash đúng Pi đó, xóa key cũ:

```powershell
ssh-keygen -R rpi5-kiosk.local
```

Nếu dùng IP:

```powershell
ssh-keygen -R 192.168.1.57
```

Sau đó SSH lại.

---

# Lỗi 6 — Camera không được phát hiện

Chạy:

```bash
rpicam-hello --list-cameras
```

Nếu không thấy camera:

1. shutdown;
2. rút nguồn;
3. kiểm tra lại FPC;
4. kiểm tra đúng cáp 22-pin -> 15-pin;
5. kiểm tra chiều cáp;
6. đóng khóa connector;
7. boot lại;
8. update OS.

Không tháo/cắm FPC khi đang cấp nguồn.

---

# Lỗi 7 — `rpicam-hello` không hiện preview qua SSH

Điều này không nhất thiết có nghĩa camera lỗi.

Bạn đang headless.

Dùng:

```bash
rpicam-still -n -o test.jpg
```

rồi `scp` ảnh về laptop.

---

# Lỗi 8 — Pi mất SSH sau reboot

Trước tiên thử:

```powershell
ping rpi5-kiosk.local
```

Có thể IP DHCP đã đổi.

Kiểm tra router hoặc dùng hostname `.local`.

---

# Lỗi 9 — Pi bị undervoltage/throttle

Kiểm tra:

```bash
vcgencmd get_throttled
```

Và:

```bash
vcgencmd measure_temp
```

Nếu nguồn/nhiệt có vấn đề:

- dùng nguồn đúng chuẩn;
- kiểm tra cáp;
- dùng Active Cooler;
- tránh cấp nhiều peripheral từ Pi trong lúc debug;
- nếu sau này màn hình gây thiếu headroom, cân nhắc cấp màn hình riêng.

---

# Lỗi 10 — Hailo không identify

Kiểm tra:

```bash
uname -m
cat /etc/os-release
apt policy hailo-h10-all
hailortcli --version
```

Đảm bảo:

```text
Pi 5
Raspberry Pi OS 64-bit Trixie
AI HAT+ 2
hailo-h10-all
```

Không trộn package `hailo-all` và `hailo-h10-all`.

---

# 22. Cheat sheet lệnh thường dùng

## SSH từ Windows

```powershell
ssh kiosk@rpi5-kiosk.local
```

Theo IP:

```powershell
ssh kiosk@192.168.1.57
```

---

## Thoát SSH

```bash
exit
```

---

## Update

```bash
sudo apt update
sudo apt full-upgrade -y
```

---

## Reboot

```bash
sudo reboot
```

---

## Shutdown an toàn

```bash
sudo shutdown -h now
```

---

## IP

```bash
hostname -I
```

---

## OS

```bash
cat /etc/os-release
```

---

## Architecture

```bash
uname -m
```

---

## RAM

```bash
free -h
```

---

## Disk

```bash
df -h
```

---

## Temperature

```bash
vcgencmd measure_temp
```

---

## Throttle

```bash
vcgencmd get_throttled
```

---

## Camera

```bash
rpicam-hello --list-cameras
```

Chụp ảnh headless:

```bash
rpicam-still -n -o ~/test_camera.jpg
```

Video 5 giây:

```bash
rpicam-vid -n -t 5000 -o ~/test_camera.h264
```

---

## Hailo-10H

```bash
hailortcli fw-control identify
```

```bash
hailortcli --version
```

---

## Process

```bash
ps aux
```

---

## Service

```bash
systemctl status ssh
```

---

## Log service

```bash
journalctl -u ssh -n 100 --no-pager
```

---

## Copy Windows -> Pi

```powershell
scp C:\path\file.py kiosk@rpi5-kiosk.local:/home/kiosk/
```

---

## Copy Pi -> Windows

```powershell
scp kiosk@rpi5-kiosk.local:/home/kiosk/file.jpg C:\Users\YOUR_NAME\Desktop\
```

---

# 23. Lộ trình tiếp theo cho Edge AI Kiosk

Sau khi hoàn thành tài liệu này, thứ tự dự án nên là:

```text
PHASE 0
OS + SSH
    |
    v
PHASE 1
Camera Module 3
    |
    v
PHASE 2
AI HAT+ 2 / Hailo-10H bring-up
    |
    v
PHASE 3
Official Hailo baseline
SCRFD-10G + ArcFace R50
    |
    v
PHASE 4
Custom fine-tuned ArcFace R50
ONNX
    |
    v
PHASE 5
Compile HEF
    |
    v
PHASE 6
Compare ONNX vs HEF
    |
    v
PHASE 7
Embedding enrollment + threshold calibration
    |
    v
PHASE 8
Attendance logic + SQLite + server
    |
    v
PHASE 9
Kiosk UI / 7-inch display
    |
    v
PHASE 10
Soak test / thermal / network recovery
```

Đối với dự án hiện tại, **đừng fine-tune model ngay trên Raspberry Pi**.

Training/fine-tuning:

```text
Kaggle GPU
```

Compile Hailo custom model:

```text
Ubuntu x86_64 / môi trường DFC phù hợp
```

Inference production:

```text
Raspberry Pi 5 + AI HAT+ 2
```

---

# 24. Tài liệu chính thức

## Raspberry Pi Imager / cài OS

https://www.raspberrypi.com/software/

---

## SSH / Remote Access

https://www.raspberrypi.com/documentation/computers/remote-access.html

Raspberry Pi OS mặc định không nhất thiết bật SSH. Với fresh image, nên bật SSH trực tiếp trong Raspberry Pi Imager ở phần Remote Access.

---

## Camera software

https://www.raspberrypi.com/documentation/computers/camera_software.html

Các lệnh chính:

```text
rpicam-hello
rpicam-still
rpicam-jpeg
rpicam-vid
rpicam-raw
```

---

## AI HAT+ / AI HAT+ 2

https://www.raspberrypi.com/documentation/accessories/ai-hat-plus.html

---

## AI software / Hailo

https://www.raspberrypi.com/documentation/computers/ai.html

Với AI HAT+ 2 / Hailo-10H:

```bash
sudo apt install dkms
sudo apt install hailo-h10-all
sudo reboot
hailortcli fw-control identify
```

---

# Phần quan trọng nhất cần nhớ

Nếu bạn quên mọi thứ khác, hãy nhớ flow này:

```text
1. microSD mới
2. cắm microSD vào laptop bằng card reader
3. Raspberry Pi Imager
4. Raspberry Pi OS Lite 64-bit Trixie
5. tạo username/password
6. Enable SSH
7. cấu hình Wi-Fi + hostname
8. WRITE
9. cắm thẻ vào Pi
10. Pi + Ethernet/router + nguồn
11. tìm hostname/IP
12. ssh USER@rpi5-kiosk.local
13. sudo apt update
14. sudo apt full-upgrade -y
15. sudo reboot
16. SSH lại
17. test camera
18. test Picamera2
19. sau đó mới Hailo
20. sau Hailo mới SCRFD-10G + ArcFace R50
```

Nếu bước nào lỗi, **không nhảy qua bước sau**.

Hãy sửa cho đến khi từng tầng hoạt động ổn định.

---

# Checklist buổi setup đầu tiên

Bạn có thể tick trực tiếp:

- [ ] Có Raspberry Pi 5.
- [ ] Có nguồn.
- [ ] Có microSD.
- [ ] Có card reader/khe đọc thẻ.
- [ ] Có Ethernet hoặc Wi-Fi.
- [ ] Cài Raspberry Pi Imager.
- [ ] Flash Raspberry Pi OS Lite 64-bit Trixie.
- [ ] Tạo username.
- [ ] Tạo password.
- [ ] Đặt hostname `rpi5-kiosk`.
- [ ] Enable SSH.
- [ ] Boot Pi thành công.
- [ ] Ping được Pi.
- [ ] SSH được.
- [ ] `uname -m` là `aarch64`.
- [ ] Update hệ thống.
- [ ] Reboot.
- [ ] SSH lại được sau reboot.
- [ ] `vcgencmd get_throttled` bình thường.
- [ ] Gắn Camera Module 3 khi đã tắt nguồn.
- [ ] `rpicam-hello --list-cameras` thấy IMX708.
- [ ] Chụp được ảnh headless.
- [ ] Copy ảnh về Windows bằng SCP.
- [ ] Picamera2 chạy được.
- [ ] Nếu đã có AI HAT+ 2: `hailortcli fw-control identify` thành công.

**Khi tất cả mục trên hoàn thành, Raspberry Pi của bạn đã sẵn sàng để bắt đầu phần Edge AI Kiosk.**
