const node=id=>document.getElementById(id);
const messages={
  idle:['◎','Sẵn sàng','Nhìn thẳng về phía camera.'],
  evaluating:['…','Đang nhận diện','Giữ khuôn mặt trong khung hình.'],
  unknown:['?','Chưa nhận diện được','Chưa đăng ký hoặc chưa đủ độ tin cậy. Không ghi điểm danh.'],
  pending:['…','Đang lưu điểm danh','Dữ liệu đang chờ xác nhận từ cơ sở dữ liệu.'],
  confirmed:['✓','Đã lưu điểm danh đến','Điểm danh đã được xác nhận.'],
  camera_unavailable:['!','Camera chưa sẵn sàng','Đang chờ camera phục hồi.'],
  model_unavailable:['!','Model chưa sẵn sàng','Chưa thể nhận diện khuôn mặt.'],
  storage_error:['!','Chưa lưu được điểm danh','Liên hệ quản trị viên để kiểm tra bộ nhớ.'],
  worker_unavailable:['!','Thiết bị chưa kết nối','Chưa nhận trạng thái mới từ tiến trình nhận diện.'],
  enrollment:['◎','Đang đăng ký','Làm theo hướng dẫn của quản trị viên.'],
  disconnected:['!','Mất kết nối dịch vụ','Tự động thử kết nối lại.'],
};

let resetTimer=null,lastConfirmedKey='',confirmedExpired=false;

function render(value) {
  const status=messages[value.state]?value.state:'worker_unavailable';
  const [symbol,title,detail]=messages[status];
  node('symbol').textContent=symbol;
  node('title').textContent=title;
  node('detail').textContent=detail;
  node('mode').textContent=value.mode==='mock'?'MÔ PHỎNG · không phải nhận diện thật':'THIẾT BỊ';
  node('source').textContent=value.mode==='mock'?'Dữ liệu tổng hợp · DB mô phỏng riêng':`Camera: ${value.camera_ok?'sẵn sàng':'chưa sẵn sàng'} · Model: ${value.model_ok?'sẵn sàng':'chưa sẵn sàng'}`;
  node('result').dataset.state=status==='confirmed'?'confirmed':status==='unknown'?'unknown':['idle','evaluating','pending','enrollment'].includes(status)?status:'error';
  document.body.dataset.evaluating=status==='evaluating'?'true':'false';
  document.body.dataset.connected=status==='disconnected'?'false':'true';

  if (status === 'confirmed') {
    const eventKey = value.attendance ? `${value.attendance.event_id || ''}_${value.attendance.user_code || ''}_${value.attendance.event_time || ''}` : '';
    if (eventKey && eventKey !== lastConfirmedKey) {
      lastConfirmedKey = eventKey;
      confirmedExpired = false;
      clearTimeout(resetTimer);
      node('person').textContent = value.attendance?.full_name || '';
      node('event-time').textContent = value.attendance ? new Date(value.attendance.event_time).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}) : '';
      node('result').dataset.resetting = 'true';
      resetTimer = setTimeout(() => {
        confirmedExpired = true;
        node('person').textContent = '';
        node('event-time').textContent = '';
        node('result').dataset.resetting = 'false';
      }, 3500);
    } else if (confirmedExpired) {
      node('person').textContent = '';
      node('event-time').textContent = '';
      node('result').dataset.resetting = 'false';
    }
  } else {
    clearTimeout(resetTimer);
    node('result').dataset.resetting = 'false';
    if (status !== 'unknown') {
      lastConfirmedKey = '';
      confirmedExpired = false;
    }
    node('person').textContent = '';
    node('event-time').textContent = '';
  }
}

let timer,controller,failures=0,generation=0,lastMode='';
async function poll() {
  const current=++generation;
  controller?.abort();controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),2500);
  try {
    const response=await fetch('/api/kiosk-state',{signal:controller.signal,cache:'no-store'});
    if (!response.ok) throw new Error('unavailable');
    const value=await response.json();if(current!==generation)return;
    lastMode=value.mode;render(value);failures=0;node('connection').textContent='Dịch vụ đã kết nối';
  } catch {
    if(current!==generation)return;
    render({state:'disconnected',mode:lastMode});failures++;node('connection').textContent='Đang thử kết nối lại';
  } finally {
    clearTimeout(timeout);
    if(current===generation && !document.hidden) timer=setTimeout(poll,Math.min(8000,750*2**failures));
  }
}

node('retry').addEventListener('click',()=>{clearTimeout(timer);poll();});
document.addEventListener('visibilitychange',()=>{clearTimeout(timer);generation++;controller?.abort();if(!document.hidden)poll();});
window.addEventListener('pagehide',()=>{generation++;clearTimeout(timer);controller?.abort();});

function clock(){node('clock').textContent=new Date().toLocaleTimeString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});}
clock();setInterval(clock,1000);

let schedulesList = [];
async function updateScheduleInfo() {
  try {
    const res = await fetch('/api/scheduled-events', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const body = await res.json();
    schedulesList = Array.isArray(body.data) ? body.data : [];
    checkActiveSchedule();
  } catch {
    if (node('schedule-pill')) node('schedule-pill').textContent = 'Điểm danh đến';
  }
}

function checkActiveSchedule() {
  const pill = node('schedule-pill');
  if (!pill) return;
  if (!schedulesList.length) {
    pill.textContent = 'Điểm danh đến';
    return;
  }
  const now = new Date();
  const vnTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const hh = String(vnTime.getHours()).padStart(2, '0');
  const mm = String(vnTime.getMinutes()).padStart(2, '0');
  const currentTime = `${hh}:${mm}`;
  const day = vnTime.getDay() === 0 ? 7 : vnTime.getDay();
  const yyyy = vnTime.getFullYear();
  const month = String(vnTime.getMonth() + 1).padStart(2, '0');
  const dateStr = `${yyyy}-${month}-${String(vnTime.getDate()).padStart(2, '0')}`;

  const active = schedulesList.find(s => {
    if (!s.active) return false;
    if (s.date && s.date === dateStr) {
      return currentTime >= s.start_time && currentTime < s.end_time;
    }
    if (!s.date && Array.isArray(s.weekdays) && s.weekdays.includes(day)) {
      return currentTime >= s.start_time && currentTime < s.end_time;
    }
    return false;
  });

  if (active) {
    pill.textContent = `${active.name} (${active.start_time} – ${active.end_time})`;
  } else {
    pill.textContent = 'Ngoài khung giờ sự kiện';
  }
}

updateScheduleInfo();
setInterval(checkActiveSchedule, 10000);
setInterval(updateScheduleInfo, 60000);
poll();

