const state = {
  token: localStorage.getItem('lab_access_token') || '',
  stream: null,
  pendingBlob: null,
  currentUserCode: '',
  allMembers: [],
  dashData: [],
  dashAbortController: null,
  dashDebounceTimer: null,
  diagTimer: null,
  diagGeneration: 0,
  diagPreviewUrl: null,
  diagAbortController: null,
};

const $ = (id) => document.getElementById(id);

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${state.token}`, ...extra };
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    signal: AbortSignal.timeout(35000),
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
  setDashDefaults();
  const activeBtn = document.querySelector('.tab-btn.active');
  const activeTab = activeBtn ? activeBtn.dataset.tab : 'dashboard';
  switchTab(activeTab);
}

function showLogin() {
  $('app-view').classList.add('hidden');
  $('login-view').classList.remove('hidden');
}

function logout() {
  stopDiagnostics();
  fetch('/api/auth/logout', { method: 'POST', headers: authHeaders(), signal: AbortSignal.timeout(3000) }).catch(() => {});
  state.stream?.getTracks().forEach(track => track.stop());
  state.stream = null;
  state.currentUserCode = '';
  state.pendingBlob = null;
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
      signal: AbortSignal.timeout(5000),
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
  } catch (err) {
    $('login-error').textContent = err.message;
  }
});
$('logout-btn').addEventListener('click', logout);

// --- Tabs ---
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach((b) => {
    const active = b.dataset.tab === tabName;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('hidden', p.id !== `tab-${tabName}`);
  });

  if (tabName !== 'diagnostics') {
    stopDiagnostics();
  }

  if (tabName === 'dashboard') loadDashboard();
  if (tabName === 'members') loadMembers();
  if (tabName === 'logs') loadLogs();
  if (tabName === 'events') loadEvents();
  if (tabName === 'diagnostics') startDiagnostics();
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab);
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
    if (!err.message.includes('đã tồn tại')) return;
  }
  state.currentUserCode = code;
  $('reg-save-btn').disabled = !state.pendingBlob;
});

document.addEventListener('DOMContentLoaded', () => fetch('/api/health').then(r => r.json()).then(info => {
  if (info.mode === 'mock') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Đăng ký hồ sơ MÔ PHỎNG cho mã đã chọn';
    button.style.marginTop = '10px';
    button.addEventListener('click', async () => {
      try {
        if (!state.currentUserCode) throw new Error('Tạo/chọn thành viên trước.');
        const result = await api(`/users/${encodeURIComponent(state.currentUserCode)}/mock-face`, { method: 'POST' });
        $('reg-result').textContent = result.message;
      } catch (error) {
        $('reg-result').textContent = error.message;
      }
    });
    $('reg-result').after(button);
  }
}).catch(() => {}));

// --- Đăng ký: bước 2, camera hoặc file ---
$('cam-start-btn').addEventListener('click', async () => {
  try {
    state.stream?.getTracks().forEach(track => track.stop());
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
  $('log-status').textContent = 'Đang tải lịch sử…';
  try {
    const data = await api(`/access-events${qs}`);
    const tbody = document.querySelector('#log-table tbody');
    tbody.innerHTML = '';
    for (const row of data.data) {
      const tr = document.createElement('tr');
      const values = [
        new Date(row.event_time).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
        row.user_code,
        row.full_name,
        row.event_type === 'check_in' ? 'Điểm danh đến' : 'Ra (lịch sử)',
        row.event_name || 'Không thuộc sự kiện',
        row.confidence ?? '-',
        row.device_id
      ];
      for (const value of values) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    $('log-status').textContent = data.data.length ? `Tổng cộng ${data.data.length} bản ghi.` : 'Chưa có bản ghi điểm danh.';
  } catch (err) {
    $('log-status').textContent = `Không tải được log: ${err.message}`;
  }
}

// --- Small event calendar: reuse current vanilla frontend and admin API ---
$('event-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = $('event-date').value || null;
  try {
    await api('/scheduled-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: $('event-name').value.trim(),
        start_time: $('event-start').value,
        end_time: $('event-end').value,
        date,
        weekdays: date ? [] : $('event-days').value.split(',').map(s => Number(s.trim())),
        active: true,
      })
    });
    $('event-status').textContent = 'Đã tạo sự kiện. Edge đồng bộ lịch tối đa khoảng 60 giây khi online.';
    await loadEvents();
  } catch (error) {
    $('event-status').textContent = error.message;
  }
});
$('event-refresh').addEventListener('click', loadEvents);

async function loadEvents() {
  try {
    const response = await api('/scheduled-events');
    const body = document.querySelector('#event-table tbody');
    body.replaceChildren();
    for (const event of response.data) {
      const tr = document.createElement('tr');
      for (const value of [
        event.name,
        `${event.start_time} – ${event.end_time}`,
        event.date || event.weekdays.map(d => ['', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'][d]).join(', '),
        event.active ? 'Đang bật' : 'Đã tắt'
      ]) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      }
      const td = document.createElement('td');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = event.active ? 'Tắt lịch' : 'Bật lịch';
      button.addEventListener('click', async () => {
        try {
          await api(`/scheduled-events/${encodeURIComponent(event.schedule_id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: !event.active })
          });
          await loadEvents();
        } catch (error) {
          $('event-status').textContent = error.message;
        }
      });
      td.appendChild(button);
      tr.appendChild(td);
      body.appendChild(tr);
    }
  } catch (error) {
    $('event-status').textContent = error.message;
  }
}

// --- Thành viên ---
$('member-refresh').addEventListener('click', loadMembers);

if ($('member-search')) {
  $('member-search').addEventListener('input', () => {
    renderMembersTable();
  });
}

function renderMembersTable() {
  const query = $('member-search') ? $('member-search').value.trim().toLowerCase() : '';
  const filtered = state.allMembers.filter(user =>
    !query ||
    (user.user_code && user.user_code.toLowerCase().includes(query)) ||
    (user.full_name && user.full_name.toLowerCase().includes(query)) ||
    (user.email && user.email.toLowerCase().includes(query))
  );

  const body = document.querySelector('#member-table tbody');
  body.replaceChildren();
  for (const user of filtered) {
    const tr = document.createElement('tr');
    for (const value of [
      user.user_code,
      user.full_name,
      user.has_face_profile ? 'Đã có' : 'Chưa đăng ký',
      user.status === 'active' ? 'Đang hoạt động' : 'Đã ngừng'
    ]) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.appendChild(td);
    }
    const td = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = user.status === 'active' ? 'Ngừng hoạt động' : 'Kích hoạt lại';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await api(`/users/${encodeURIComponent(user.user_code)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: user.status === 'active' ? 'inactive' : 'active' })
        });
        await loadMembers();
      } catch (error) {
        $('member-status').textContent = error.message;
        button.disabled = false;
      }
    });
    td.appendChild(button);
    if (user.status === 'active') {
      const enrollLink = document.createElement('a');
      enrollLink.href = `/r50-capture.html?user=${encodeURIComponent(user.user_code)}`;
      enrollLink.className = 'nav-link small-btn';
      enrollLink.style.marginLeft = '8px';
      enrollLink.style.display = 'inline-block';
      enrollLink.textContent = 'Lấy mẫu R50';
      td.appendChild(enrollLink);
    }
    tr.appendChild(td);
    body.appendChild(tr);
  }
}

async function loadMembers() {
  $('member-status').textContent = 'Đang tải thành viên…';
  try {
    const { data } = await api('/users');
    state.allMembers = data || [];
    renderMembersTable();
    $('member-status').textContent = state.allMembers.length ? `Đã tải ${state.allMembers.length} thành viên. Edge tải thay đổi theo chu kỳ cấu hình.` : 'Chưa có thành viên.';
  } catch (error) {
    $('member-status').textContent = error.message;
  }
}

// --- Bảng thống kê điểm danh (Dashboard) ---
function vnDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function setDashDefaults() {
  const day = vnDate();
  if ($('dash-week') && !$('dash-week').value) $('dash-week').value = day;
  if ($('dash-month') && !$('dash-month').value) $('dash-month').value = day.slice(0, 7);
}

function formatVnTime(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ?
    parsed.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—';
}

function renderDashboardTable() {
  const searchInput = $('dash-search');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const rows = state.dashData || [];
  const filtered = query ? rows.filter(m =>
    (m.full_name && m.full_name.toLowerCase().includes(query)) ||
    (m.user_code && m.user_code.toLowerCase().includes(query))
  ) : rows;

  const body = $('dash-members');
  if (!body) return;
  body.replaceChildren();

  let weekTotal = 0, monthTotal = 0;
  for (const m of rows) {
    weekTotal += (m.week_days || 0);
    monthTotal += (m.month_days || 0);
  }

  if ($('dash-member-count')) $('dash-member-count').textContent = String(rows.length);
  if ($('dash-week-total')) $('dash-week-total').textContent = String(weekTotal);
  if ($('dash-month-total')) $('dash-month-total').textContent = String(monthTotal);

  if (!filtered.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'empty';
    td.textContent = rows.length ? 'Không tìm thấy thành viên phù hợp.' : 'Chưa có dữ liệu điểm danh.';
    tr.append(td);
    body.append(tr);
    return;
  }

  for (const member of filtered) {
    const tr = document.createElement('tr');

    const identity = document.createElement('td');
    identity.append(document.createTextNode(member.full_name || ''));
    const code = document.createElement('span');
    code.className = 'member-code';
    code.textContent = `${member.user_code} · ${member.status}`;
    identity.append(code);

    const week = document.createElement('td');
    week.className = 'count';
    week.textContent = String(member.week_days || 0);

    const month = document.createElement('td');
    month.className = 'count';
    month.textContent = String(member.month_days || 0);

    const dates = document.createElement('td');
    dates.className = 'dates';
    dates.textContent = member.month_dates && member.month_dates.length ? member.month_dates.join(' · ') : '—';

    const latest = document.createElement('td');
    latest.textContent = formatVnTime(member.last_checkin);

    tr.append(identity, week, month, dates, latest);
    body.append(tr);
  }
}

async function loadDashboard() {
  if (state.dashAbortController) {
    state.dashAbortController.abort();
  }
  state.dashAbortController = new AbortController();
  const signal = state.dashAbortController.signal;

  setDashDefaults();
  const weekVal = $('dash-week')?.value;
  const monthVal = $('dash-month')?.value;
  if ($('dash-status')) $('dash-status').textContent = 'Đang tải thống kê…';

  try {
    const qs = new URLSearchParams();
    if (weekVal) qs.set('week', weekVal);
    if (monthVal) qs.set('month', monthVal);

    const res = await api(`/lab-attendance?${qs.toString()}`, { signal });
    state.dashData = res.data || [];
    if ($('dash-range-label') && res.timezone) {
      $('dash-range-label').textContent = `Múi giờ ${res.timezone} · Tuần bắt đầu thứ Hai`;
    }
    renderDashboardTable();
    if ($('dash-status')) {
      $('dash-status').textContent = state.dashData.length ?
        `Cập nhật lúc ${new Date().toLocaleTimeString('vi-VN')} · ${state.dashData.length} thành viên.` :
        'Chưa có dữ liệu điểm danh trong phạm vi đã chọn.';
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    if ($('dash-status')) $('dash-status').textContent = `Không tải được thống kê: ${err.message}`;
  }
}

function sanitizeCsvCell(value) {
  if (value === null || value === undefined) return '""';
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
}

function exportDashboardCSV() {
  const rows = state.dashData || [];
  if (!rows.length) {
    if ($('dash-status')) $('dash-status').textContent = 'Chưa có dữ liệu để xuất CSV.';
    return;
  }

  const query = $('dash-search') ? $('dash-search').value.trim().toLowerCase() : '';
  const exportList = query ? rows.filter(m =>
    (m.full_name && m.full_name.toLowerCase().includes(query)) ||
    (m.user_code && m.user_code.toLowerCase().includes(query))
  ) : rows;

  if (!exportList.length) {
    if ($('dash-status')) $('dash-status').textContent = 'Không có bản ghi phù hợp để xuất CSV.';
    return;
  }

  const month = $('dash-month')?.value || vnDate().slice(0, 7);
  const headers = [
    'Mã thành viên',
    'Họ và tên',
    'Trạng thái',
    'Số ngày trong tuần',
    'Số ngày trong tháng',
    'Chi tiết các ngày trong tháng',
    'Lần check-in cuối'
  ];

  const csvRows = exportList.map(m => [
    sanitizeCsvCell(m.user_code),
    sanitizeCsvCell(m.full_name),
    sanitizeCsvCell(m.status),
    sanitizeCsvCell(m.week_days),
    sanitizeCsvCell(m.month_days),
    sanitizeCsvCell(m.month_dates && m.month_dates.length ? m.month_dates.join('; ') : '—'),
    sanitizeCsvCell(formatVnTime(m.last_checkin))
  ].join(','));

  const csvContent = '\uFEFF' + [
    headers.map(sanitizeCsvCell).join(','),
    ...csvRows
  ].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `diem-danh-yirlodt-${month}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  if ($('dash-status')) {
    $('dash-status').textContent = `Đã xuất ${exportList.length} bản ghi ra diem-danh-yirlodt-${month}.csv`;
  }
}

if ($('dash-refresh-btn')) $('dash-refresh-btn').addEventListener('click', loadDashboard);
if ($('dash-export-csv')) $('dash-export-csv').addEventListener('click', exportDashboardCSV);

if ($('dash-search')) {
  $('dash-search').addEventListener('input', () => {
    renderDashboardTable();
  });
}

function triggerDashDebounce() {
  clearTimeout(state.dashDebounceTimer);
  state.dashDebounceTimer = setTimeout(loadDashboard, 300);
}

if ($('dash-week')) $('dash-week').addEventListener('change', triggerDashDebounce);
if ($('dash-month')) $('dash-month').addEventListener('change', triggerDashDebounce);

// --- Chẩn đoán nâng cao (Diagnostics) ---
async function updateDiagnostics() {
  const current = ++state.diagGeneration;
  if (state.diagAbortController) {
    state.diagAbortController.abort();
  }
  state.diagAbortController = new AbortController();
  const signal = state.diagAbortController.signal;

  try {
    const res = await api('/cpu-test/camera/diagnostics', { signal });
    const data = res.data;
    if (current !== state.diagGeneration || signal.aborted) return;

    if ($('diag-faces')) $('diag-faces').textContent = Number.isInteger(data.detected_faces) ? String(data.detected_faces) : '—';
    const times = data.timings_ms || {};
    if ($('diag-detector')) $('diag-detector').textContent = Number.isFinite(times.detector_ms) ? times.detector_ms.toFixed(1) : '—';
    if ($('diag-alignment')) $('diag-alignment').textContent = Number.isFinite(times.alignment_ms) ? times.alignment_ms.toFixed(1) : '—';
    if ($('diag-recognition')) $('diag-recognition').textContent = Number.isFinite(times.recognition_ms) ? times.recognition_ms.toFixed(1) : '—';
    if ($('diag-contract')) $('diag-contract').textContent = data.contract_id || '—';
    if ($('diag-state')) {
      $('diag-state').textContent = `Khung hình đã xử lý: ${data.detection_frames || 0}. Kích hoạt production: ${data.production_activated ? 'có' : 'không'}.`;
    }

    const imageResp = await fetch('/api/cpu-test/camera/preview', {
      headers: authHeaders(),
      cache: 'no-store',
      signal
    });
    if (!imageResp.ok) throw new Error(`Preview HTTP ${imageResp.status}`);
    const blob = await imageResp.blob();
    if (current !== state.diagGeneration || signal.aborted) return;

    const nextUrl = URL.createObjectURL(blob);
    if (state.diagPreviewUrl) URL.revokeObjectURL(state.diagPreviewUrl);
    state.diagPreviewUrl = nextUrl;

    if ($('diag-preview')) $('diag-preview').src = nextUrl;
    if ($('diag-placeholder')) $('diag-placeholder').hidden = true;
    if ($('diag-status')) {
      $('diag-status').textContent = 'Fresh frame';
      $('diag-status').dataset.state = 'ready';
    }
  } catch (error) {
    if (current !== state.diagGeneration || signal.aborted) return;
    if ($('diag-status')) {
      $('diag-status').textContent = 'Unavailable';
      $('diag-status').dataset.state = 'error';
    }
    if ($('diag-state')) $('diag-state').textContent = error.message;
    if ($('diag-placeholder')) $('diag-placeholder').hidden = false;
  }
  if (current === state.diagGeneration && !signal.aborted) {
    state.diagTimer = setTimeout(updateDiagnostics, 800);
  }
}

function startDiagnostics() {
  stopDiagnostics();
  updateDiagnostics();
}

function stopDiagnostics() {
  state.diagGeneration++;
  if (state.diagAbortController) {
    state.diagAbortController.abort();
    state.diagAbortController = null;
  }
  clearTimeout(state.diagTimer);
  state.diagTimer = null;
  if (state.diagPreviewUrl) URL.revokeObjectURL(state.diagPreviewUrl);
  state.diagPreviewUrl = null;
  if ($('diag-preview')) $('diag-preview').removeAttribute('src');
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('pagehide', () => {
    stopDiagnostics();
    if (state.dashAbortController) {
      state.dashAbortController.abort();
      state.dashAbortController = null;
    }
    clearTimeout(state.dashDebounceTimer);
    state.dashDebounceTimer = null;
    state.stream?.getTracks().forEach(track => track.stop());
    state.stream = null;
  });
}

if (state.token) {
  showApp();
} else {
  showLogin();
}
