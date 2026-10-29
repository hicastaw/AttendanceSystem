# Runbook SSH Raspberry Pi 5 qua cáp Ethernet nối trực tiếp với Windows

> Cập nhật: 07-10-2026  
> Máy đích: Raspberry Pi 5, Raspberry Pi OS Lite trên microSD 32 GB  
> Mục tiêu: laptop dùng Wi-Fi để vào Internet và chia sẻ mạng qua Ethernet cho Raspberry Pi, sau đó quản trị Pi bằng SSH.

## 1. Kết quả phiên thiết lập hiện tại

Các kiểm tra đã thực hiện từ laptop Windows:

| Hạng mục | Kết quả |
|---|---|
| Wi-Fi laptop | `192.168.88.32/24`, gateway `192.168.88.1` |
| Ethernet laptop | `192.168.137.1/24` |
| Trạng thái Ethernet | `Up`, liên kết `1 Gbps` |
| IP Raspberry Pi | `192.168.137.204` |
| MAC Raspberry Pi | `88-A2-9E-21-89-4F` |
| Tên DNS do Windows ICS cung cấp | `raspberrypi.mshome.net` |
| Ping | Thành công, dưới 1 ms, TTL 64 |
| SSH TCP/22 | Đóng (`TcpTestSucceeded: False`) |

Kết luận: Raspberry Pi đã boot, Ethernet và Windows Internet Connection Sharing hoạt động. SSH server trên hệ điều hành hiện tại chưa bật hoặc chưa lắng nghe. Không thể suy ra username từ IP, MAC hoặc ARP.

## 2. Sơ đồ mạng

```text
Internet
   |
Wi-Fi laptop: 192.168.88.32
   |
Windows Internet Connection Sharing
   |
Ethernet laptop: 192.168.137.1
   |
Cáp Ethernet
   |
Raspberry Pi: 192.168.137.204
```

IP của Pi có thể thay đổi sau khi reboot hoặc thay thẻ. Không viết cứng `192.168.137.204` vào ứng dụng production; tìm lại IP hoặc cấu hình DHCP reservation khi hệ thống ổn định.

## 3. Điều kiện bắt buộc để SSH

Phía Raspberry Pi phải có đủ cả ba điều kiện:

1. Đã tạo ít nhất một tài khoản Linux và biết username/password.
2. Dịch vụ OpenSSH Server đã được cài và bật.
3. Cổng TCP 22 đang lắng nghe.

Mạng đang hoạt động không đồng nghĩa SSH đã được bật.

## 4. Hoàn tất thẻ 32 GB hiện tại khi không có đầu đọc thẻ

Do SSH đang đóng, cần cắm tạm màn hình micro-HDMI và bàn phím USB vào Raspberry Pi.

### 4.1 Nếu màn hình first-boot yêu cầu tạo tài khoản

Tạo một tài khoản quản trị. Giá trị đề xuất:

```text
username: kiosk
hostname: rpi5-kiosk
```

Dùng mật khẩu mạnh và không ghi mật khẩu vào repository hoặc file runbook này.

### 4.2 Nếu Pi đã vào màn hình đăng nhập

Đăng nhập bằng tài khoản đã được tạo khi cài thẻ. Sau khi đăng nhập, xác nhận username:

```bash
whoami
```

Liệt kê các tài khoản người dùng thông thường:

```bash
getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 {print $1}'
```

### 4.3 Bật SSH trên Pi

Chạy tại terminal của Raspberry Pi:

```bash
sudo raspi-config nonint do_ssh 0
sudo systemctl enable --now ssh
sudo systemctl status ssh --no-pager
```

Kiểm tra cổng 22 trên Pi:

```bash
sudo ss -lntp | grep ':22'
```

Kỳ vọng có dòng `LISTEN` tại `0.0.0.0:22`, `[::]:22`, hoặc địa chỉ mạng tương ứng.

Lấy thông tin kết nối:

```bash
whoami
hostname
hostname -I
```

Sau đó có thể tháo màn hình và bàn phím. Tắt máy đúng cách trước khi thay đổi phần cứng:

```bash
sudo poweroff
```

## 5. SSH từ Windows sau khi đã bật dịch vụ

Kiểm tra mạng và cổng SSH:

```powershell
ping 192.168.137.204
Test-NetConnection 192.168.137.204 -Port 22
```

Kỳ vọng:

```text
PingSucceeded    : True
TcpTestSucceeded : True
```

Đăng nhập bằng username thực tế đã lấy từ `whoami`:

```powershell
ssh USERNAME@192.168.137.204
```

Ví dụ nếu đã chủ động tạo user `kiosk`:

```powershell
ssh kiosk@192.168.137.204
```

Có thể thử tên DNS do Windows ICS cung cấp:

```powershell
ssh kiosk@raspberrypi.mshome.net
```

Lần đầu kết nối, kiểm tra fingerprint đang nhắm đúng Pi rồi nhập `yes`. Mật khẩu không hiện ký tự khi gõ; đây là hành vi bình thường.

## 6. Kiểm tra Raspberry Pi ngay sau lần SSH đầu tiên

Chạy trên Pi:

```bash
whoami
hostnamectl
uname -m
cat /etc/os-release
ip -br address
df -h /
free -h
vcgencmd get_throttled
vcgencmd measure_temp
systemctl is-enabled ssh
systemctl is-active ssh
```

Kỳ vọng tối thiểu:

- Kiến trúc là `aarch64`.
- Ethernet có IP `192.168.137.x`.
- SSH là `enabled` và `active`.
- `vcgencmd get_throttled` trả về `throttled=0x0`.
- Phân vùng `/` còn tối thiểu 8 GB trống trước khi cập nhật/cài gói lớn.

## 7. Cập nhật hệ điều hành

Chỉ thực hiện sau khi SSH hoạt động ổn định và đã biết cách đăng nhập lại:

```bash
sudo apt update
sudo apt full-upgrade -y
sudo reboot
```

Chờ 2-5 phút rồi tìm lại IP và SSH lại. Sau reboot, IP có thể thay đổi.

## 8. Tìm lại Pi khi đổi IP hoặc đổi thẻ

Trên Windows:

```powershell
Get-NetAdapter -Name Ethernet
Get-NetIPConfiguration -InterfaceAlias Ethernet
Get-NetNeighbor -InterfaceAlias Ethernet -AddressFamily IPv4
```

Thiết bị hợp lệ trong phiên hiện tại có MAC:

```text
88-A2-9E-21-89-4F
```

Kiểm tra từng IP nghi ngờ:

```powershell
ping IP_CUA_PI
Test-NetConnection IP_CUA_PI -Port 22
```

Nếu dùng lại đúng thẻ này, thử:

```powershell
ping raspberrypi.mshome.net
```

Nếu dùng thẻ mới và đã đặt hostname `rpi5-kiosk`, thử:

```powershell
ping rpi5-kiosk.local
ssh kiosk@rpi5-kiosk.local
```

## 9. Quy trình cho thẻ nhớ mới

Khi có đầu đọc thẻ, dùng Raspberry Pi Imager và cấu hình trước khi ghi:

```text
Device: Raspberry Pi 5
OS: Raspberry Pi OS Lite 64-bit
Hostname: rpi5-kiosk
Username: kiosk
Timezone: Asia/Ho_Chi_Minh
Remote access: Enable SSH
Authentication: password cho lần đầu hoặc public key nếu đã chuẩn bị key
```

Sau khi ghi và verify:

1. Tắt nguồn Pi.
2. Lắp thẻ mới.
3. Cắm Ethernet trực tiếp với laptop.
4. Đảm bảo Wi-Fi của laptop đang chia sẻ sang Ethernet.
5. Cấp nguồn cho Pi và chờ 3-5 phút.
6. Tìm IP/hostname.
7. Kiểm tra TCP/22.
8. SSH bằng username đã cấu hình trong Imager.
9. Chạy bộ lệnh kiểm tra ở mục 6.

## 10. Thiết lập SSH key sau khi đăng nhập bằng mật khẩu thành công

Trên Windows, chỉ tạo key nếu chưa có:

```powershell
if (-not (Test-Path "$env:USERPROFILE\.ssh\id_ed25519.pub")) { ssh-keygen -t ed25519 }
```

Chép public key lên Pi:

```powershell
Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub" | ssh kiosk@192.168.137.204 "umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys"
```

Kiểm tra đăng nhập lại:

```powershell
ssh kiosk@192.168.137.204
```

Chỉ tắt đăng nhập bằng mật khẩu sau khi SSH key đã được kiểm tra thành công trong một terminal mới.

## 11. Giới hạn của thẻ 32 GB

Thẻ 32 GB đủ để:

- boot Raspberry Pi OS Lite;
- cập nhật hệ thống;
- kiểm tra mạng, nguồn và nhiệt;
- bật SSH;
- thử camera và một số gói cơ bản.

Chưa nên dùng thẻ này để giữ Hailo Apps, nhiều HEF, LLM và cache tải model. Trước giai đoạn cài Hailo/LLM, chuyển sang thẻ 128 GB và lặp lại quy trình mục 9.

## 12. Trạng thái công việc

- [x] Ethernet laptop hoạt động ở 1 Gbps.
- [x] Windows ICS tạo mạng `192.168.137.0/24`.
- [x] Raspberry Pi boot và phản hồi ping tại `192.168.137.204`.
- [x] Xác định hostname `raspberrypi.mshome.net`.
- [ ] Bật SSH trên thẻ 32 GB.
- [ ] Xác định username bằng `whoami` hoặc tạo user mới.
- [ ] `Test-NetConnection ... -Port 22` trả về `True`.
- [ ] SSH từ Windows thành công.
- [ ] Kiểm tra OS, kiến trúc, dung lượng, nguồn và nhiệt.
- [ ] Cập nhật OS và xác nhận SSH hoạt động sau reboot.

Điểm đang chặn: thẻ hiện tại không mở SSH, đồng thời chưa biết tài khoản Linux. Cần màn hình + bàn phím hoặc đầu đọc microSD để bật SSH/tạo tài khoản lần đầu.
