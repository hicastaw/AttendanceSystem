const state = {
  token: localStorage.getItem('lab_access_token') || '',
  stream: null,
  pendingBlob: null,
  currentUserCode: '',
};

const $ = (id) => document.getElementById(id);

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${state.token}`, ...extra };
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { ...(options.headers || {}), ...authHeaders() },
  });
  if (res.status === 401) {
    logout();
    throw new Error('Phiên đăng nhập đã hết, vui lòng đăng nhập lại.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Lỗi HTTP ${res.status}`);
  return data;
}

function showApp() {
  $('login-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
}

function showLogin() {
  $('app-view').classList.add('hidden');
  $('login-view').classList.remove('hidden');
}

function logout() {
  state.token = '';
  localStorage.removeItem('lab_access_token');
  showLogin();
}

// --- Login ---
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('login-password').value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Đăng nhập thất bại.');
    state.token = data.data.token;
    localStorage.setItem('lab_access_token', state.token);
    $('login-password').value = '';
    showApp();
    loadLogs();
  } catch (err) {
    $('login-error').textContent = err.message;
  }
});
$('logout-btn').addEventListener('click', logout);

// --- Tabs ---
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    btn.classList.add('active');
    $(`tab-${btn.dataset.tab}`).classList.remove('hidden');
    if (btn.dataset.tab === 'logs') loadLogs();
  });
});

// --- Đăng ký: bước 1, tạo/chọn user ---
$('reg-create-btn').addEventListener('click', async () => {
  const code = $('reg-code').value.trim().toUpperCase();
  const full_name = $('reg-name').value.trim();
  const email = $('reg-email').value.trim();
  if (!code || !full_name) {
    $('reg-user-status').textContent = 'Cần nhập mã người dùng và họ tên.';
    return;
  }
  try {
    await api('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_code: code, full_name, email }),
    });
    $('reg-user-status').textContent = `Đã tạo người dùng mới: ${code}`;
  } catch (err) {
    // 409 = user_code đã tồn tại -> vẫn hợp lệ để tiếp tục đăng ký/cập nhật khuôn mặt cho người này
    $('reg-user-status').textContent = err.message.includes('đã tồn tại')
      ? `Người dùng ${code} đã tồn tại, dùng để đăng ký/cập nhật khuôn mặt.`
      : `Lỗi: ${err.message}`;
  }
  state.currentUserCode = code;
  $('reg-save-btn').disabled = !state.pendingBlob;
});

// --- Đăng ký: bước 2, camera hoặc file ---
$('cam-start-btn').addEventListener('click', async () => {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 360 } });
    const video = $('cam-video');
    video.srcObject = state.stream;
    video.classList.remove('hidden');
    $('reg-preview').classList.add('hidden');
    $('cam-capture-btn').disabled = false;
  } catch (err) {
    alert(`Không mở được camera: ${err.message}`);
  }
});

$('cam-capture-btn').addEventListener('click', () => {
  const video = $('cam-video');
  const canvas = $('cam-canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  canvas.toBlob((blob) => {
    state.pendingBlob = blob;
    $('reg-preview').src = URL.createObjectURL(blob);
    $('reg-preview').classList.remove('hidden');
    $('reg-save-btn').disabled = !state.currentUserCode;
  }, 'image/jpeg', 0.9);
});

$('reg-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.pendingBlob = file;
  $('reg-preview').src = URL.createObjectURL(file);
  $('reg-preview').classList.remove('hidden');
  $('reg-save-btn').disabled = !state.currentUserCode;
});

$('reg-save-btn').addEventListener('click', async () => {
  if (!state.currentUserCode || !state.pendingBlob) return;
  $('reg-result').textContent = 'Đang xử lý...';
  try {
    const form = new FormData();
    form.append('face_image', state.pendingBlob, 'face.jpg');
    const data = await api(`/users/${state.currentUserCode}/face`, { method: 'POST', body: form });
    $('reg-result').textContent = `Đã lưu khuôn mặt cho ${state.currentUserCode} (độ sắc nét: ${data.data.sharpness_score ?? '-'})`;
  } catch (err) {
    $('reg-result').textContent = `Lỗi: ${err.message}`;
  }
});

// --- Xem log ---
$('log-refresh-btn').addEventListener('click', loadLogs);

async function loadLogs() {
  const code = $('log-filter-code').value.trim();
  const qs = code ? `?user_code=${encodeURIComponent(code)}` : '';
  try {
    const data = await api(`/access-events${qs}`);
    const tbody = document.querySelector('#log-table tbody');
    tbody.innerHTML = '';
    for (const row of data.data) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${row.event_time}</td>
        <td>${row.user_code}</td>
        <td>${row.full_name}</td>
        <td>${row.event_type === 'check_in' ? 'Vào' : 'Ra'}</td>
        <td>${row.confidence ?? '-'}</td>
        <td>${row.device_id}</td>
      `;
      tbody.appendChild(tr);
    }
  } catch (err) {
    alert(`Không tải được log: ${err.message}`);
  }
}

// --- Khởi động ---
if (state.token) {
  showApp();
  loadLogs();
} else {
  showLogin();
}
