/**
 * YIRLoDT Lab Kiosk Controller
 * Young Innovation Research Laboratory on Digital Technology – PTIT
 */

const $ = id => document.getElementById(id);

const states = {
  idle: ['WAITING FOR CAMERA', 'Đứng trước camera', 'Giữ khuôn mặt trong khung hình để check-in.', '◎', 'idle'],
  evaluating: ['RECOGNIZING', 'Đang nhận diện', 'Giữ khuôn mặt ổn định trước camera.', '…', 'working'],
  unknown: ['UNKNOWN FACE', 'Chưa nhận diện được', 'Chưa đăng ký hoặc chưa đủ độ tin cậy. Không ghi điểm danh.', '?', 'unknown'],
  pending: ['PENDING CONFIRMATION', 'Đang lưu điểm danh', 'Chờ backend xác nhận đã commit vào SQLite.', '…', 'working'],
  success: ['CHECK-IN SUCCESS', 'Điểm danh thành công', 'Check-in hôm nay đã được lưu.', '✓', 'confirmed'],
  already: ['ALREADY CHECKED IN', 'Hôm nay bạn đã check-in', 'Không tạo bản ghi mới cho lần nhận diện này.', '↻', 'already'],
  camera_unavailable: ['CAMERA UNAVAILABLE', 'Camera chưa sẵn sàng', 'Kiểm tra webcam và đóng ứng dụng khác đang sử dụng camera.', '!', 'error'],
  model_unavailable: ['MODEL UNAVAILABLE', 'Model chưa sẵn sàng', 'Kiểm tra descriptor, SHA-256 và ONNX Runtime.', '!', 'error'],
  storage_error: ['DATABASE ERROR', 'Chưa lưu được điểm danh', 'Backend chưa xác nhận commit; hệ thống sẽ giữ trạng thái lỗi.', '!', 'error'],
  worker_unavailable: ['WORKER UNAVAILABLE', 'Worker chưa kết nối', 'Khởi động lại launcher R50 nếu worker đã dừng.', '!', 'error'],
  enrollment: ['ENROLLMENT ACTIVE', 'Đang đăng ký', 'Hoàn tất enrollment trước khi điểm danh.', '◎', 'working'],
  disconnected: ['BACKEND UNAVAILABLE', 'Mất kết nối dịch vụ', 'Đang thử kết nối lại; chưa xác nhận check-in.', '!', 'error'],
};

let lastHandledEventId = null;
let resetTimer = null;
let isTransientDisplay = false;
let previewTimer = null;
let previewAbort = null;
let activePreviewUrl = null;
let pendingPreviewUrl = null;
let isPreviewStopped = false;
let isKioskPollingStopped = false;
let previewEpoch = 0;
let lastDecodedFrameTime = 0;
let kioskGeneration = 0;
let pollTimer = null;
let pollAbort = null;
let clockTimer = null;
let freshnessTimer = null;

function invalidateCameraPreview(reasonText = '', showSpinner = false) {
  previewEpoch++;
  clearTimeout(previewTimer);
  previewTimer = null;
  if (previewAbort) {
    try { previewAbort.abort(); } catch {}
    previewAbort = null;
  }
  if (pendingPreviewUrl) {
    URL.revokeObjectURL(pendingPreviewUrl);
    pendingPreviewUrl = null;
  }
  if (activePreviewUrl) {
    URL.revokeObjectURL(activePreviewUrl);
    activePreviewUrl = null;
  }
  lastDecodedFrameTime = 0;
  const img = $('kiosk-camera-preview');
  if (img) {
    img.removeAttribute('src');
    img.classList.add('hidden');
  }
  const overlay = $('camera-status-overlay');
  const statusText = $('camera-status-text');
  const spinner = $('camera-status-spinner');
  if (overlay) {
    overlay.classList.remove('hidden');
    if (spinner) {
      if (showSpinner) spinner.classList.remove('hidden');
      else spinner.classList.add('hidden');
    }
    if (statusText && reasonText) {
      statusText.textContent = reasonText;
    }
  }
}

function render(value) {
  let key = value.state;
  if (key === 'confirmed') {
    key = value.attendance_result === 'ALREADY_CHECKED_IN' ? 'already' : 'success';
  }

  // Generate event identifier
  const eventIdentifier = value.attendance?.event_id || 
                          value.attendance?.receipt_id || 
                          (value.attendance?.user_code ? `${value.attendance.user_code}_${value.attendance?.event_time}` : null);

  // If we are currently holding a 3.5s transient display for a recent event and the polled state is still that same event or idle, don't clobber
  if (isTransientDisplay && eventIdentifier && eventIdentifier === lastHandledEventId) {
    return;
  }

  // Handle transient states (success, already, unknown)
  if (['success', 'already', 'unknown'].includes(key)) {
    if (eventIdentifier && eventIdentifier !== lastHandledEventId) {
      lastHandledEventId = eventIdentifier;
      isTransientDisplay = true;
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        isTransientDisplay = false;
        if ($('confirmed-member-banner')) {
          $('confirmed-member-banner').hidden = true;
        }
        // Reset to idle view
        applyState('idle');
      }, 3500);
    }
  } else if (!['pending', 'evaluating'].includes(key)) {
    // If state changed to something else (e.g. idle or error), and transient timer is not active
    if (!isTransientDisplay) {
      lastHandledEventId = null;
    }
  }

  applyState(key, value);
}

function applyState(key, value = {}) {
  const item = states[key] || states.worker_unavailable;
  const card = $('card');
  if (card) {
    card.dataset.state = item[4];
  }
  if ($('state')) $('state').textContent = item[0];
  if ($('title')) $('title').textContent = item[1];
  if ($('detail')) $('detail').textContent = item[2];
  if ($('icon')) $('icon').textContent = item[3];

  const showMember = ['success', 'already'].includes(key);
  const memberName = showMember ? (value.attendance?.full_name || value.attendance?.user_code || '') : '';
  if ($('member')) {
    $('member').textContent = memberName;
  }
  if ($('event-time')) {
    $('event-time').textContent = showMember && value.attendance?.event_time ?
      new Date(value.attendance.event_time).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '';
  }

  // Display confirmed member name directly below the camera
  const confirmedBanner = $('confirmed-member-banner');
  const confirmedName = $('confirmed-member-name');
  if (confirmedBanner && confirmedName) {
    if (showMember && memberName) {
      confirmedName.textContent = memberName;
      confirmedBanner.hidden = false;
    } else if (!isTransientDisplay) {
      confirmedBanner.hidden = true;
      confirmedName.textContent = '';
    }
  }
}

async function updateCameraPreview() {
  if (isPreviewStopped || isKioskPollingStopped) return;

  let token = '';
  try {
    token = localStorage.getItem('lab_access_token') || '';
  } catch {}

  if (!token) {
    invalidateCameraPreview('Camera sẵn sàng · Đăng nhập quản trị laptop để xem trực tiếp', false);
    previewTimer = setTimeout(updateCameraPreview, 5000);
    return;
  }

  // Check frame freshness (F2): if last decoded frame is older than 5.0 seconds, invalidate frame
  if (lastDecodedFrameTime > 0 && (Date.now() - lastDecodedFrameTime > 5000)) {
    invalidateCameraPreview('Đang chờ khung hình từ camera (503)…', true);
  }

  const currentEpoch = ++previewEpoch;
  const requestToken = token;

  let newUrl = null;
  const abortController = new AbortController();
  previewAbort = abortController;

  // Single timeout covering fetch, response.blob() and image decoding (F2)
  const timeoutId = setTimeout(() => {
    try { abortController.abort(); } catch {}
  }, 4000);

  try {
    const res = await fetch('/api/cpu-test/camera/preview', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: abortController.signal
    });

    if (isPreviewStopped || isKioskPollingStopped || currentEpoch !== previewEpoch || localStorage.getItem('lab_access_token') !== requestToken) {
      return;
    }

    if (res.status === 200) {
      const blob = await res.blob();
      if (isPreviewStopped || isKioskPollingStopped || currentEpoch !== previewEpoch || localStorage.getItem('lab_access_token') !== requestToken) {
        return;
      }

      newUrl = URL.createObjectURL(blob);
      if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
      pendingPreviewUrl = newUrl;

      const img = $('kiosk-camera-preview');
      const overlay = $('camera-status-overlay');
      if (img) {
        await new Promise((resolve, reject) => {
          if (abortController.signal.aborted) return reject(new Error('Aborted'));
          const onAbort = () => {
            img.onload = null;
            img.onerror = null;
            reject(new Error('Timeout / Aborted during image decode'));
          };
          abortController.signal.addEventListener('abort', onAbort, { once: true });
          img.onload = () => {
            abortController.signal.removeEventListener('abort', onAbort);
            resolve();
          };
          img.onerror = () => {
            abortController.signal.removeEventListener('abort', onAbort);
            reject(new Error('Image decode error'));
          };
          img.src = newUrl;
        });

        if (isPreviewStopped || isKioskPollingStopped || currentEpoch !== previewEpoch || localStorage.getItem('lab_access_token') !== requestToken) {
          URL.revokeObjectURL(newUrl);
          if (pendingPreviewUrl === newUrl) pendingPreviewUrl = null;
          return;
        }

        if (activePreviewUrl) URL.revokeObjectURL(activePreviewUrl);
        activePreviewUrl = newUrl;
        pendingPreviewUrl = null;
        lastDecodedFrameTime = Date.now();
        img.classList.remove('hidden');
        if (overlay) overlay.classList.add('hidden');
      }
      previewTimer = setTimeout(updateCameraPreview, 400);
      return;
    }

    // For any non-200 response, immediately clear/hide the stale frame and show overlay (F2)
    if (res.status === 401) {
      invalidateCameraPreview('Cần quyền quản trị laptop để xem hình ảnh trực tiếp (401)', false);
      previewTimer = setTimeout(updateCameraPreview, 5000);
      return;
    } else if (res.status === 503) {
      invalidateCameraPreview('Đang chờ khung hình từ camera (503)…', true);
      previewTimer = setTimeout(updateCameraPreview, 1500);
      return;
    } else if (res.status === 404) {
      invalidateCameraPreview('Camera trực tiếp chưa kích hoạt (chế độ R50)', false);
      previewTimer = setTimeout(updateCameraPreview, 5000);
      return;
    } else {
      invalidateCameraPreview(`Camera tạm thời gián đoạn (HTTP ${res.status})`, false);
      previewTimer = setTimeout(updateCameraPreview, 2500);
      return;
    }
  } catch (err) {
    if (newUrl) {
      URL.revokeObjectURL(newUrl);
      if (pendingPreviewUrl === newUrl) pendingPreviewUrl = null;
    }
    if (isPreviewStopped || isKioskPollingStopped || currentEpoch !== previewEpoch || localStorage.getItem('lab_access_token') !== requestToken) {
      return;
    }
    invalidateCameraPreview('Đang chờ khung hình từ camera (503)…', true);
    previewTimer = setTimeout(updateCameraPreview, 2000);
  } finally {
    clearTimeout(timeoutId);
    if (previewAbort === abortController) {
      previewAbort = null;
    }
  }
}

function stopCameraPreview() {
  isPreviewStopped = true;
  invalidateCameraPreview('', false);
}

function checkFrameFreshness() {
  if (lastDecodedFrameTime > 0 && (Date.now() - lastDecodedFrameTime > 5000)) {
    invalidateCameraPreview('Đang chờ khung hình từ camera (503)…', true);
  }
}

async function poll(gen) {
  if (gen === undefined) gen = kioskGeneration;
  if (isKioskPollingStopped || gen !== kioskGeneration) return;

  const currentGen = gen;
  if (pollAbort) {
    try { pollAbort.abort(); } catch {}
  }
  const abortController = new AbortController();
  pollAbort = abortController;

  try {
    const response = await fetch('/api/kiosk-state', {
      cache: 'no-store',
      signal: abortController.signal
    });
    if (isKioskPollingStopped || currentGen !== kioskGeneration) return;
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (isKioskPollingStopped || currentGen !== kioskGeneration) return;
    render(data);
    if ($('connection')) {
      $('connection').innerHTML = '<span class="conn-dot"></span> Đã kết nối dịch vụ cục bộ';
    }
  } catch {
    if (isKioskPollingStopped || currentGen !== kioskGeneration) return;
    if ($('connection')) {
      $('connection').innerHTML = '<span class="conn-dot" style="background:#EF4444"></span> Mất kết nối dịch vụ · đang thử lại';
    }
    render({ state: 'disconnected' });
  } finally {
    if (pollAbort === abortController) {
      pollAbort = null;
    }
    if (!isKioskPollingStopped && currentGen === kioskGeneration) {
      clearTimeout(pollTimer);
      pollTimer = setTimeout(() => poll(currentGen), 900);
    }
  }
}

function clock() {
  const value = new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  if ($('clock')) $('clock').textContent = value;
}

function stopKiosk() {
  kioskGeneration++;
  previewEpoch++;
  isKioskPollingStopped = true;
  isPreviewStopped = true;
  clearTimeout(pollTimer);
  pollTimer = null;
  if (pollAbort) {
    try { pollAbort.abort(); } catch {}
    pollAbort = null;
  }
  clearTimeout(previewTimer);
  previewTimer = null;
  if (previewAbort) {
    try { previewAbort.abort(); } catch {}
    previewAbort = null;
  }
  invalidateCameraPreview('', false);
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
  if (freshnessTimer) {
    clearInterval(freshnessTimer);
    freshnessTimer = null;
  }
}

function resumeKiosk() {
  const nextGen = ++kioskGeneration;
  isKioskPollingStopped = false;
  isPreviewStopped = false;
  if (!clockTimer) {
    clock();
    clockTimer = setInterval(clock, 1000);
  }
  if (!freshnessTimer) {
    freshnessTimer = setInterval(checkFrameFreshness, 1000);
  }
  clearTimeout(previewTimer);
  updateCameraPreview();
  clearTimeout(pollTimer);
  poll(nextGen);
}

// Discrete Admin Settings Modal Handlers
const adminDialog = $('admin-dialog');
const settingsBtn = $('admin-settings-btn');
const closeBtn = $('close-dialog-btn');
const cancelBtn = $('cancel-dialog-btn');

function closeAdminDialog() {
  if (!adminDialog) return;
  if (typeof adminDialog.close === 'function') {
    adminDialog.close();
  } else {
    adminDialog.removeAttribute('open');
  }
}

if (settingsBtn && adminDialog) {
  settingsBtn.addEventListener('click', () => {
    if (typeof adminDialog.showModal === 'function') {
      adminDialog.showModal();
    } else {
      adminDialog.setAttribute('open', '');
    }
  });
}

if (closeBtn) closeBtn.addEventListener('click', closeAdminDialog);
if (cancelBtn) cancelBtn.addEventListener('click', closeAdminDialog);

if (adminDialog) {
  adminDialog.addEventListener('click', (e) => {
    if (e.target === adminDialog) closeAdminDialog();
  });
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('pagehide', () => {
    stopKiosk();
  });
  window.addEventListener('pageshow', () => {
    resumeKiosk();
  });
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        stopKiosk();
      } else if (document.visibilityState === 'visible') {
        resumeKiosk();
      }
    });
  }
  window.addEventListener('storage', (e) => {
    if (e.key === 'lab_access_token') {
      const currentToken = localStorage.getItem('lab_access_token');
      if (!currentToken) {
        invalidateCameraPreview('Camera sẵn sàng · Đăng nhập quản trị laptop để xem trực tiếp', false);
      }
      clearTimeout(previewTimer);
      updateCameraPreview();
    }
  });
}

resumeKiosk();
