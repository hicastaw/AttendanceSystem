/**
 * YIRLoDT Lab Attendance Dashboard Controller
 * Young Innovation Research Laboratory on Digital Technology – PTIT
 */

const byId = id => document.getElementById(id);
const loginPanel = byId('login-panel');
const dashboard = byId('dashboard');
let adminToken = '';
let currentData = [];

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

function setDefaults() {
  const day = vnDate();
  if (byId('week')) byId('week').value = day;
  if (byId('month')) byId('month').value = day.slice(0, 7);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    cache: 'no-store',
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {})
    }
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('Máy chủ phản hồi định dạng không hợp lệ.');
  }
  if (!response.ok) throw new Error(body.message || `Yêu cầu thất bại (${response.status}).`);
  return body;
}

if (byId('login-form')) {
  byId('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (byId('login-error')) byId('login-error').textContent = '';
    try {
      const body = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: byId('password').value })
      });
      adminToken = body.data.token;
      byId('password').value = '';
      loginPanel.hidden = true;
      dashboard.hidden = false;
      await refresh();
    } catch (error) {
      if (byId('login-error')) byId('login-error').textContent = error.message;
    }
  });
}

function formatTime(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ?
    parsed.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—';
}

function render(rows) {
  currentData = rows;
  const searchInput = byId('member-search');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  const filtered = query ? rows.filter(m => 
    (m.full_name && m.full_name.toLowerCase().includes(query)) ||
    (m.user_code && m.user_code.toLowerCase().includes(query))
  ) : rows;

  const body = byId('members');
  if (!body) return;
  body.replaceChildren();

  let weekTotal = 0, monthTotal = 0;
  for (const member of rows) {
    weekTotal += member.week_days;
    monthTotal += member.month_days;
  }

  if (byId('member-count')) byId('member-count').textContent = String(rows.length);
  if (byId('week-total')) byId('week-total').textContent = String(weekTotal);
  if (byId('month-total')) byId('month-total').textContent = String(monthTotal);

  if (!filtered.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'empty';
    td.textContent = rows.length ? 'Không tìm thấy thành viên phù hợp.' : 'Chưa có thành viên.';
    tr.append(td);
    body.append(tr);
    return;
  }

  for (const member of filtered) {
    const tr = document.createElement('tr');

    const identity = document.createElement('td');
    // Ensure text node is used for security (XSS prevention)
    identity.append(document.createTextNode(member.full_name));

    const code = document.createElement('span');
    code.className = 'member-code';
    code.textContent = `${member.user_code} · ${member.status}`;
    identity.append(code);

    const week = document.createElement('td');
    week.className = 'count';
    week.textContent = String(member.week_days);

    const month = document.createElement('td');
    month.className = 'count';
    month.textContent = String(member.month_days);

    const dates = document.createElement('td');
    dates.className = 'dates';
    dates.textContent = member.month_dates && member.month_dates.length ? member.month_dates.join(' · ') : '—';

    const latest = document.createElement('td');
    latest.textContent = formatTime(member.last_checkin);

    tr.append(identity, week, month, dates, latest);
    body.append(tr);
  }
}

let refreshSeq = 0;
let activeAbortController = null;

/**
 * Sanitize cell for CSV formula injection mitigation (OWASP).
 * If string starts with =, +, -, @, tab (\t), or carriage return (\r), prepend a single quote.
 * Wrap in double quotes and escape internal double quotes.
 */
function sanitizeCsvCell(value) {
  if (value === null || value === undefined) return '""';
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

function exportCsv() {
  if (!currentData || !currentData.length) {
    if (byId('status')) byId('status').textContent = 'Chưa có dữ liệu để xuất CSV.';
    return;
  }

  const searchInput = byId('member-search');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const exportList = query ? currentData.filter(m =>
    (m.full_name && m.full_name.toLowerCase().includes(query)) ||
    (m.user_code && m.user_code.toLowerCase().includes(query))
  ) : currentData;

  if (!exportList.length) {
    if (byId('status')) byId('status').textContent = 'Không có bản ghi phù hợp để xuất CSV.';
    return;
  }

  const month = byId('month')?.value || vnDate().slice(0, 7);
  const headers = [
    'Mã thành viên',
    'Họ và tên',
    'Trạng thái',
    'Số ngày trong tuần',
    'Số ngày trong tháng',
    'Chi tiết các ngày trong tháng',
    'Lần check-in cuối'
  ];

  const rows = exportList.map(member => [
    sanitizeCsvCell(member.user_code),
    sanitizeCsvCell(member.full_name),
    sanitizeCsvCell(member.status),
    sanitizeCsvCell(member.week_days),
    sanitizeCsvCell(member.month_days),
    sanitizeCsvCell(member.month_dates && member.month_dates.length ? member.month_dates.join('; ') : '—'),
    sanitizeCsvCell(formatTime(member.last_checkin))
  ].join(','));

  // UTF-8 BOM (\uFEFF) ensures Excel on Windows displays Vietnamese characters without mojibake
  const csvContent = '\uFEFF' + [
    headers.map(sanitizeCsvCell).join(','),
    ...rows
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

  if (byId('status')) {
    byId('status').textContent = `Đã xuất ${exportList.length} bản ghi ra diem-danh-yirlodt-${month}.csv`;
  }
}

async function refresh() {
  const seq = ++refreshSeq;
  if (activeAbortController) {
    activeAbortController.abort();
  }
  activeAbortController = new AbortController();

  if (byId('status')) byId('status').textContent = 'Đang tải dữ liệu…';
  const refreshBtn = byId('refresh');
  if (refreshBtn) refreshBtn.disabled = true;

  try {
    const week = byId('week').value;
    const month = byId('month').value;
    const result = await api(`/api/lab-attendance?week=${encodeURIComponent(week)}&month=${encodeURIComponent(month)}`, {
      signal: activeAbortController.signal
    });

    if (seq !== refreshSeq) return;

    render(result.data);
    if (byId('range-label')) {
      byId('range-label').textContent = `${result.week.start} → ${result.week.end_exclusive} · ${result.month.start.slice(0, 7)} · ${result.timezone}`;
    }
    const now = new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    if (byId('status')) byId('status').textContent = `Đã cập nhật lúc ${now}`;
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (seq !== refreshSeq) return;
    if (byId('status')) byId('status').textContent = error.message;
  } finally {
    if (seq === refreshSeq) {
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }
}

if (byId('refresh')) byId('refresh').addEventListener('click', refresh);

if (byId('export-csv')) byId('export-csv').addEventListener('click', exportCsv);

if (byId('week')) {
  byId('week').addEventListener('change', () => {
    if (dashboard && !dashboard.hidden) refresh();
  });
}

if (byId('month')) {
  byId('month').addEventListener('change', () => {
    if (dashboard && !dashboard.hidden) refresh();
  });
}

if (byId('member-search')) {
  byId('member-search').addEventListener('input', () => {
    if (currentData) render(currentData);
  });
}

if (byId('logout')) {
  byId('logout').addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {}
    adminToken = '';
    dashboard.hidden = true;
    loginPanel.hidden = false;
    if (byId('login-error')) byId('login-error').textContent = '';
  });
}

setDefaults();
