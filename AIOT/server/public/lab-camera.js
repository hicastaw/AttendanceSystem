/**
 * YIRLoDT Live Camera Diagnostics Controller
 * Young Innovation Research Laboratory on Digital Technology – PTIT
 */

const $ = id => document.getElementById(id);
let token = '', timer = null, generation = 0, previewUrl = null;

async function request(path) {
  const response = await fetch(path, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(3500)
  });
  if (!response.ok) throw new Error(`Local camera service unavailable (HTTP ${response.status}).`);
  return response;
}

function number(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '—';
}

async function update() {
  const current = ++generation;
  try {
    const result = await request('/api/cpu-test/camera/diagnostics');
    const data = (await result.json()).data;
    if (current !== generation) return;

    if ($('faces')) $('faces').textContent = Number.isInteger(data.detected_faces) ? String(data.detected_faces) : '—';
    const times = data.timings_ms || {};
    if ($('detector')) $('detector').textContent = number(times.detector_ms);
    if ($('alignment')) $('alignment').textContent = number(times.alignment_ms);
    if ($('recognition')) $('recognition').textContent = number(times.recognition_ms);
    if ($('contract')) $('contract').textContent = data.contract_id || '—';
    if ($('diagnostic-state')) {
      $('diagnostic-state').textContent = `Khung hình đã xử lý: ${data.detection_frames || 0}. Kích hoạt production: ${data.production_activated ? 'có' : 'không'}.`;
    }

    const image = await request('/api/cpu-test/camera/preview');
    const blob = await image.blob();
    if (current !== generation) return;

    const next = URL.createObjectURL(blob);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = next;

    if ($('preview')) $('preview').src = next;
    if ($('placeholder')) $('placeholder').hidden = true;
    if ($('camera-status')) {
      $('camera-status').textContent = 'Fresh frame';
      $('camera-status').dataset.state = 'ready';
    }
  } catch (error) {
    if (current !== generation) return;
    if ($('camera-status')) {
      $('camera-status').textContent = 'Unavailable';
      $('camera-status').dataset.state = 'error';
    }
    if ($('diagnostic-state')) $('diagnostic-state').textContent = error.message;
    if ($('placeholder')) $('placeholder').hidden = false;
  }
  if (current === generation) timer = setTimeout(update, 800);
}

document.getElementById('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('error')) $('error').textContent = '';
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('password').value }),
      signal: AbortSignal.timeout(3500)
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || 'Mật khẩu quản trị không đúng.');
    token = body.data.token;
    $('password').value = '';
    $('login-panel').hidden = true;
    $('camera-panel').hidden = false;
    update();
  } catch (error) {
    if ($('error')) $('error').textContent = error.message;
  }
});

window.addEventListener('pagehide', () => {
  generation++;
  clearTimeout(timer);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  token = '';
});
