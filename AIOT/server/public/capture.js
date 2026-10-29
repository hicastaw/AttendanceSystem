const el = id => document.getElementById(id);
let token = '', session = null, code = '', timer = null, previewUrl = null, stopped = false, generation = 0;
const status = value => { el('status').textContent = value; };

async function request(route, options = {}) {
  const response = await fetch(route, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
    signal: AbortSignal.timeout(6000),
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: chưa xác nhận thao tác. Có thể thử lại an toàn.`);
  return response;
}

const route = () => `/api/users/${encodeURIComponent(code)}/capture`;

el('login').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const response = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: el('password').value })
    });
    token = (await response.json()).data.token;
    el('password').value = '';
    const users = (await (await request('/api/users')).json()).data.filter(user => user.status === 'active');
    el('member').replaceChildren(...users.map(user => {
      const option = document.createElement('option');
      option.value = user.user_code;
      option.textContent = `${user.user_code} — ${user.full_name}`;
      return option;
    }));
    el('controls').hidden = false;
    el('login').hidden = true;
    stopped = false;
    status('Đã đăng nhập. Chọn thành viên rồi bắt đầu.');
  } catch (error) {
    status(error.message);
  }
});

async function poll() {
  if (stopped || !session) return;
  const current = generation;
  try {
    const value = (await (await request(`${route()}/${session}`)).json()).data;
    if (current !== generation) return;
    status(`${value.state}: ${value.samples}/${value.required} mẫu. ${value.reason || ''} Mẫu hết hạn tự động sau tối đa 30 giây.`);
    el('save').disabled = value.state !== 'ready';
    const response = await request(`${route()}/preview`);
    const blob = await response.blob();
    if (current !== generation) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(blob);
    el('preview').src = previewUrl;
  } catch (error) {
    if (current === generation) {
      el('save').disabled = true;
      status(error.message);
    }
  }
  if (!stopped && session && current === generation) {
    timer = setTimeout(poll, 500);
  }
}

function clear() {
  generation++;
  clearTimeout(timer);
  timer = null;
  session = null;
  el('member').disabled = false;
  el('start').disabled = false;
  el('save').disabled = true;
  el('confirm').checked = false;
  el('preview').removeAttribute('src');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}

el('start').addEventListener('click', async () => {
  if (session) return;
  el('start').disabled = true;
  try {
    code = el('member').value;
    const value = (await (await request(route(), { method: 'POST', body: JSON.stringify({ frames: 5 }) })).json()).data;
    session = value.session_id;
    el('member').disabled = true;
    el('start').disabled = true;
    await poll();
  } catch (error) {
    if (!session) el('start').disabled = false;
    status(error.message);
  }
});

el('cancel').addEventListener('click', async () => {
  try {
    if (session) await request(`${route()}/${session}`, { method: 'DELETE' });
    clear();
    status('Đã hủy.');
  } catch (error) {
    clear();
    status(error.message + ' Đã đóng phiên UI; chưa xác nhận hủy từ worker. Mẫu vẫn tự hết hạn.');
  }
});

el('save').addEventListener('click', async () => {
  if (!session || !el('confirm').checked) {
    status('Cần xác nhận đúng thành viên trước khi lưu.');
    return;
  }
  try {
    await request(`${route()}/${session}/commit`, {
      method: 'POST',
      body: JSON.stringify({ confirm_same_member: true })
    });
    clear();
    status('Hồ sơ đã được backend lưu xác nhận.');
  } catch (error) {
    status(error.message + ' Chưa hiển thị thành công; thử lại cùng session.');
  }
});

el('logout').addEventListener('click', async () => {
  try {
    await request('/api/auth/logout', { method: 'POST' });
  } catch {}
  stopped = true;
  clear();
  token = '';
  el('controls').hidden = true;
  el('login').hidden = false;
  status('Đã đăng xuất; mẫu chưa hủy sẽ tự hết hạn.');
});

window.addEventListener('pagehide', () => {
  stopped = true;
  clear();
  token = '';
});
