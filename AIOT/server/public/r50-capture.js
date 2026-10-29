/**
 * YIRLoDT One-Image R50 Experimental Enrollment Controller
 * Young Innovation Research Laboratory on Digital Technology – PTIT
 */

const el = id => document.getElementById(id);
let token = '', scope = null, session = null, code = '', timer = null;
let previewUrl = null, pendingPreviewUrl = null, lastDecodedFrameTime = 0;
let stopped = false, generation = 0;
let currentRequired = 1;
let globalPreviewTimer = null, globalPreviewAbort = null;
let pendingStartPromise = null;
let freshnessInterval = null;
let activeSource = 'camera'; // 'camera' | 'upload'
let selectedFile = null;
let allUsers = [];
let currentMember = null;
let frozenSessionId = null;
let livePreviewAbort = null;

const REASON_MESSAGES = {
  stale_frame: 'Ảnh đã quá cũ, vui lòng thử lại',
  image_blurry: 'Ảnh mờ hoặc không đủ nét',
  Blurry: 'Ảnh mờ hoặc không đủ nét',
  'Blurry crop': 'Ảnh mờ hoặc không đủ nét',
  no_face: 'Không phát hiện khuôn mặt trong ảnh',
  multiple_faces: 'Phát hiện nhiều hơn 1 khuôn mặt (vui lòng chỉ đứng 1 người)',
  invalid_landmarks: 'Không thể định vị điểm mốc khuôn mặt',
  alignment_failed: 'Căn chỉnh khuôn mặt không thành công',
  embedding_failed: 'Trích xuất đặc trưng khuôn mặt thất bại',
  face_angle: 'Góc mặt quá nghiêng',
  unsupported_format: 'Định dạng ảnh không được hỗ trợ',
  image_too_large: 'Dung lượng hoặc kích thước ảnh vượt quá giới hạn',
  invalid_image: 'Ảnh không hợp lệ hoặc bị lỗi giải mã'
};

function localizeReason(reason) {
  if (!reason) return '';
  return REASON_MESSAGES[reason] || reason;
}

const status = value => {
  if (el('status')) el('status').textContent = value;
};

function updatePreviewBadge(state, text) {
  const dot = el('preview-status-dot');
  const label = el('preview-status-text');
  if (dot) {
    dot.className = `preview-dot ${state}`;
  }
  if (label) {
    label.textContent = text;
  }
}

function updatePlaceholder(text, showSpinner = true) {
  const placeholder = el('preview-placeholder');
  const placeholderText = el('preview-placeholder-text');
  const spinner = el('preview-spinner');
  const img = el('preview');
  if (placeholder) {
    if (placeholderText) placeholderText.textContent = text;
    if (spinner) {
      if (showSpinner) spinner.classList.remove('hidden');
      else spinner.classList.add('hidden');
    }
    placeholder.classList.remove('hidden');
  }
  if (img) {
    img.classList.add('hidden');
    img.removeAttribute('src');
  }
  if (pendingPreviewUrl) {
    URL.revokeObjectURL(pendingPreviewUrl);
    pendingPreviewUrl = null;
  }
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  lastDecodedFrameTime = 0;
}

async function fetchGlobalPreview() {
  if (stopped || !token || session || activeSource !== 'camera') return;
  const currentGen = generation;
  const currentToken = token;

  // Check frame freshness (F2): if frame older than 5.0s, show waiting
  if (lastDecodedFrameTime > 0 && Date.now() - lastDecodedFrameTime > 5000) {
    updatePreviewBadge('waiting', 'Đang chờ khung hình từ camera (503)…');
    updatePlaceholder('Đang chờ khung hình từ camera (503)…', true);
  }

  const abortController = new AbortController();
  globalPreviewAbort = abortController;
  let newUrl = null;

  // Single timeout covering fetch, response.blob() and image decoding (F2)
  const timeoutId = setTimeout(() => {
    try { abortController.abort(); } catch {}
  }, 4000);

  try {
    const resp = await fetch('/api/cpu-test/camera/preview', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: abortController.signal
    });

    if (currentGen !== generation || stopped || session || token !== currentToken || activeSource !== 'camera') return;

    if (resp.status === 200) {
      const blob = await resp.blob();
      if (currentGen !== generation || stopped || session || token !== currentToken || activeSource !== 'camera') return;

      newUrl = URL.createObjectURL(blob);
      if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
      pendingPreviewUrl = newUrl;

      const img = el('preview');
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

        if (currentGen !== generation || stopped || session || token !== currentToken || activeSource !== 'camera') {
          URL.revokeObjectURL(newUrl);
          if (pendingPreviewUrl === newUrl) pendingPreviewUrl = null;
          return;
        }

        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = newUrl;
        pendingPreviewUrl = null;
        lastDecodedFrameTime = Date.now();
        img.classList.remove('hidden');
        if (el('preview-placeholder')) el('preview-placeholder').classList.add('hidden');
        updatePreviewBadge('ready', 'Camera trực tiếp sẵn sàng');
      }
      globalPreviewTimer = setTimeout(fetchGlobalPreview, 400);
      return;
    }

    if (resp.status === 401) {
      updatePreviewBadge('error', 'Phiên đăng nhập hết hạn hoặc chưa xác thực (401)');
      updatePlaceholder('Cần đăng nhập admin (401)', false);
      globalPreviewTimer = setTimeout(fetchGlobalPreview, 5000);
      return;
    } else if (resp.status === 503) {
      updatePreviewBadge('waiting', 'Đang chờ khung hình từ camera (503)…');
      updatePlaceholder('Đang chờ khung hình từ camera (503)…', true);
      globalPreviewTimer = setTimeout(fetchGlobalPreview, 1200);
      return;
    } else if (resp.status === 404) {
      updatePreviewBadge('waiting', 'Camera tạm thời chưa khả dụng (404)');
      updatePlaceholder('Camera tạm thời chưa khả dụng (404)', false);
      globalPreviewTimer = setTimeout(fetchGlobalPreview, 3000);
      return;
    } else {
      updatePreviewBadge('waiting', `Camera tạm thời gián đoạn (HTTP ${resp.status})`);
      updatePlaceholder(`Camera tạm thời gián đoạn (HTTP ${resp.status})`, false);
      globalPreviewTimer = setTimeout(fetchGlobalPreview, 2500);
      return;
    }
  } catch (err) {
    if (newUrl) {
      URL.revokeObjectURL(newUrl);
      if (pendingPreviewUrl === newUrl) pendingPreviewUrl = null;
    }
    if (currentGen !== generation || stopped || session || token !== currentToken || activeSource !== 'camera') return;
    updatePreviewBadge('waiting', 'Đang chờ khung hình từ camera (503)…');
    updatePlaceholder('Đang chờ khung hình từ camera (503)…', true);
    globalPreviewTimer = setTimeout(fetchGlobalPreview, 2000);
  } finally {
    clearTimeout(timeoutId);
    if (globalPreviewAbort === abortController) {
      globalPreviewAbort = null;
    }
  }
}

function startGlobalPreview() {
  clearTimeout(globalPreviewTimer);
  if (activeSource !== 'camera') return;
  updatePreviewBadge('waiting', 'Đang kết nối camera…');
  updatePlaceholder('Đang kết nối camera…', true);
  fetchGlobalPreview();
}

function stopGlobalPreview() {
  clearTimeout(globalPreviewTimer);
  globalPreviewTimer = null;
  if (globalPreviewAbort) {
    globalPreviewAbort.abort();
    globalPreviewAbort = null;
  }
}

async function request(route, options = {}) {
  const response = await fetch(route, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers
    },
    signal: options.signal || AbortSignal.timeout(6000),
    cache: 'no-store'
  });
  if (!response.ok) {
    let msg = `HTTP ${response.status}: chưa xác nhận thao tác.`;
    try {
      const body = await response.json();
      if (body.message) msg = body.message;
      else if (body.code) msg = body.code;
    } catch {}
    const err = new Error(msg);
    err.status = response.status;
    throw err;
  }
  return response;
}

const route = () => `/api/cpu-test/contracts/${encodeURIComponent(scope.embedding_contract.contract_id)}/users/${encodeURIComponent(code)}/capture`;

function updateProgressBar(samples, required, remainingSeconds) {
  const wrapper = el('progress-wrapper');
  const container = el('frame-segments');
  const timerBadge = el('timer-badge');
  if (!wrapper || !container) return;

  wrapper.hidden = false;
  if (timerBadge) {
    if (typeof remainingSeconds === 'number' && Number.isFinite(remainingSeconds) && remainingSeconds > 0) {
      timerBadge.textContent = `⏳ Còn khoảng ${Math.ceil(remainingSeconds)}s`;
    } else {
      timerBadge.textContent = samples >= required ? '✅ Đã hoàn thành' : '⏳ Đang lấy mẫu…';
    }
  }

  container.setAttribute('aria-valuemax', String(required));
  container.setAttribute('aria-valuenow', String(samples));

  if (container.children.length !== required) {
    container.style.gridTemplateColumns = `repeat(${required}, 1fr)`;
    container.replaceChildren();
    for (let i = 0; i < required; i++) {
      const seg = document.createElement('div');
      seg.className = 'segment-item pending';
      seg.id = `segment-${i}`;
      seg.textContent = `${i + 1}`;
      container.appendChild(seg);
    }
  }

  for (let i = 0; i < required; i++) {
    const seg = el(`segment-${i}`);
    if (!seg) continue;
    if (i < samples) {
      seg.className = 'segment-item completed';
      seg.textContent = '✓';
    } else if (i === samples) {
      seg.className = 'segment-item active';
      seg.textContent = `${i + 1}`;
    } else {
      seg.className = 'segment-item pending';
      seg.textContent = `${i + 1}`;
    }
  }
}

function hideProgressBar() {
  const wrapper = el('progress-wrapper');
  if (wrapper) wrapper.hidden = true;
}

function showErrorGuide(title, msg) {
  const box = el('error-guide');
  const t = el('error-guide-title');
  const m = el('error-guide-msg');
  if (box && t && m) {
    t.textContent = title;
    m.textContent = msg;
    box.hidden = false;
  }
  if (el('retry')) el('retry').hidden = false;
}

function hideErrorGuide() {
  const box = el('error-guide');
  if (box) box.hidden = true;
  if (el('retry')) el('retry').hidden = true;
}

function clear() {
  clearTimeout(timer);
  timer = null;
  session = null;
  frozenSessionId = null;
  if (livePreviewAbort) {
    try { livePreviewAbort.abort(); } catch {}
    livePreviewAbort = null;
  }
  pendingStartPromise = null;
  hideProgressBar();
  hideErrorGuide();

  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  if (pendingPreviewUrl) {
    URL.revokeObjectURL(pendingPreviewUrl);
    pendingPreviewUrl = null;
  }
  lastDecodedFrameTime = 0;

  if (el('member')) el('member').disabled = false;
  if (el('frames')) el('frames').disabled = false;
  if (el('start')) el('start').disabled = false;
  if (el('confirm')) {
    el('confirm').checked = false;
    el('confirm').disabled = true;
  }
  if (el('save')) el('save').disabled = true;

  if (activeSource === 'camera') {
    startGlobalPreview();
  } else {
    if (selectedFile) {
      const fileUrl = URL.createObjectURL(selectedFile);
      if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
      pendingPreviewUrl = fileUrl;
      const img = el('preview');
      if (img) {
        img.src = fileUrl;
        img.classList.remove('hidden');
        if (el('preview-placeholder')) el('preview-placeholder').classList.add('hidden');
      }
      updatePreviewBadge('ready', 'Ảnh sẵn sàng để xác thực');
    } else {
      updatePlaceholder('Chưa chọn ảnh tải lên', false);
      updatePreviewBadge('waiting', 'Đang chờ chọn ảnh…');
    }
  }
}

async function loadMembers(selectUserCode = null) {
  try {
    const res = await request('/api/users');
    const users = (await res.json()).data.filter(u => u.status === 'active');
    allUsers = users;

    const select = el('member');
    if (!select) return;
    select.replaceChildren();

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '-- Chọn thành viên từ danh sách --';
    select.appendChild(placeholder);

    for (const u of users) {
      const opt = document.createElement('option');
      opt.value = u.user_code;
      const statusText = u.has_face_profile ? 'Đã có mẫu' : 'Chưa lấy mẫu';
      opt.textContent = `${u.user_code} — ${u.full_name} (${statusText})`;
      select.appendChild(opt);
    }

    const targetUser = selectUserCode || new URLSearchParams(window.location.search).get('user') || code || (users.length > 0 ? users[0].user_code : '');
    if (targetUser && users.some(u => u.user_code === targetUser)) {
      select.value = targetUser;
      onMemberSelected(targetUser);
    }
  } catch (err) {
    status(err.message);
  }
}

function onMemberSelected(userCode) {
  const errBox = el('member-error');
  if (errBox) errBox.hidden = true;

  if (!userCode) {
    code = '';
    currentMember = null;
    if (el('member-active-badge')) el('member-active-badge').hidden = true;
    if (el('confirm-label-text')) {
      el('confirm-label-text').textContent = 'Tôi xác nhận ảnh trên thuộc đúng thành viên đã chọn và đồng ý lưu vào hồ sơ nhận diện R50.';
    }
    return;
  }

  const user = allUsers.find(u => u.user_code === userCode);
  if (!user) {
    code = userCode;
    return;
  }

  code = user.user_code;
  currentMember = user;

  const badge = el('member-active-badge');
  const badgeText = el('member-active-text');
  const badgeStatus = el('member-profile-status');
  if (badge && badgeText && badgeStatus) {
    badgeText.textContent = `${user.full_name} (${user.user_code})`;
    badgeStatus.textContent = user.has_face_profile ? 'Đã có khuôn mặt' : 'Chưa có khuôn mặt';
    badgeStatus.className = 'profile-status-tag ' + (user.has_face_profile ? 'enrolled' : 'unenrolled');
    badge.hidden = false;
  }

  const confirmText = el('confirm-label-text');
  if (confirmText) {
    confirmText.textContent = `Tôi xác nhận ảnh trên thuộc đúng thành viên ${user.full_name} (${user.user_code}) và đồng ý lưu vào hồ sơ nhận diện R50.`;
  }
}

async function createMember() {
  const nameInput = el('full-name');
  const codeInput = el('user-code');
  const errBox = el('member-error');
  const statusSpan = el('member-create-status');
  if (errBox) errBox.hidden = true;

  const fullName = nameInput ? nameInput.value.trim() : '';
  const userCode = codeInput ? codeInput.value.trim() : '';

  if (!fullName || !userCode) {
    const msg = 'Vui lòng nhập đầy đủ họ tên và mã thành viên.';
    if (errBox) { errBox.textContent = msg; errBox.hidden = false; }
    status(msg);
    return null;
  }

  try {
    if (statusSpan) statusSpan.textContent = 'Đang tạo…';
    const resp = await request('/api/users', {
      method: 'POST',
      body: JSON.stringify({ user_code: userCode, full_name: fullName })
    });
    const data = (await resp.json()).data;
    if (statusSpan) statusSpan.textContent = `Đã tạo ${data.user_code}!`;

    await loadMembers(data.user_code);
    if (el('mode-select')) el('mode-select').checked = true;
    if (el('member-select-wrap')) el('member-select-wrap').hidden = false;
    if (el('member-create-wrap')) el('member-create-wrap').hidden = true;
    status(`Đã tạo thành viên ${data.user_code} — ${data.full_name} (chưa lấy mẫu).`);
    return data;
  } catch (err) {
    if (statusSpan) statusSpan.textContent = '';
    let msg = err.message;
    if (err.status === 409 || err.message.includes('duplicate_member_code')) {
      msg = `Mã thành viên "${userCode}" đã tồn tại trên hệ thống. Vui lòng chọn từ danh sách hoặc dùng mã khác.`;
    } else if (err.status === 400 || err.message.includes('invalid_member')) {
      msg = 'Họ tên hoặc mã thành viên không hợp lệ (mã chỉ gồm chữ cái, số, gạch dưới hoặc gạch nối, tối đa 64 ký tự).';
    }
    if (errBox) {
      errBox.textContent = msg;
      errBox.hidden = false;
    }
    status(msg);
    return null;
  }
}

function setSource(src) {
  activeSource = src;
  const cameraBtn = el('source-camera-btn');
  const uploadBtn = el('source-upload-btn');
  const cameraPanel = el('camera-panel');
  const uploadPanel = el('upload-panel');
  const guideOverlay = el('camera-guide-overlay');
  const sourceBadge = el('preview-source-badge');
  const startBtn = el('start');

  if (src === 'camera') {
    if (cameraBtn) cameraBtn.classList.add('active');
    if (uploadBtn) uploadBtn.classList.remove('active');
    if (cameraPanel) cameraPanel.hidden = false;
    if (uploadPanel) uploadPanel.hidden = true;
    if (guideOverlay) guideOverlay.classList.remove('hidden');
    if (sourceBadge) { sourceBadge.textContent = '📷 Camera'; sourceBadge.hidden = false; }
    if (startBtn && !session) startBtn.textContent = 'Bắt đầu lấy mẫu camera';
    if (!session) startGlobalPreview();
  } else {
    if (uploadBtn) uploadBtn.classList.add('active');
    if (cameraBtn) cameraBtn.classList.remove('active');
    if (uploadPanel) uploadPanel.hidden = false;
    if (cameraPanel) cameraPanel.hidden = true;
    if (guideOverlay) guideOverlay.classList.add('hidden');
    if (sourceBadge) { sourceBadge.textContent = '📁 Ảnh tải lên'; sourceBadge.hidden = false; }
    if (startBtn && !session) startBtn.textContent = 'Xác thực ảnh tải lên';
    stopGlobalPreview();

    if (selectedFile) {
      const fileUrl = URL.createObjectURL(selectedFile);
      if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
      pendingPreviewUrl = fileUrl;
      const img = el('preview');
      if (img) {
        img.src = fileUrl;
        img.classList.remove('hidden');
        if (el('preview-placeholder')) el('preview-placeholder').classList.add('hidden');
      }
      updatePreviewBadge('ready', 'Ảnh sẵn sàng để xác thực');
    } else {
      updatePlaceholder('Chưa chọn ảnh tải lên', false);
      updatePreviewBadge('waiting', 'Đang chờ chọn ảnh…');
    }
  }
}

function handleFileSelect(file) {
  const errBox = el('member-error');
  if (errBox) errBox.hidden = true;
  if (!file) return;

  const validTypes = ['image/jpeg', 'image/png', 'image/jpg'];
  if (!validTypes.includes(file.type)) {
    const msg = 'Định dạng file không được hỗ trợ. Vui lòng chọn ảnh JPEG hoặc PNG.';
    if (errBox) { errBox.textContent = msg; errBox.hidden = false; }
    status(msg);
    return;
  }

  // 5 MiB = 5,242,880 bytes
  if (file.size > 5242880) {
    const msg = `Dung lượng ảnh (${(file.size / (1024 * 1024)).toFixed(1)} MB) vượt quá giới hạn tối đa 5 MB.`;
    if (errBox) { errBox.textContent = msg; errBox.hidden = false; }
    status(msg);
    return;
  }

  selectedFile = file;
  if (el('file-name')) el('file-name').textContent = file.name;
  if (el('file-size')) el('file-size').textContent = `${(file.size / 1024).toFixed(1)} KB`;
  if (el('selected-file-info')) el('selected-file-info').hidden = false;

  const fileUrl = URL.createObjectURL(file);
  if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
  pendingPreviewUrl = fileUrl;
  const img = el('preview');
  if (img) {
    img.src = fileUrl;
    img.classList.remove('hidden');
    if (el('preview-placeholder')) el('preview-placeholder').classList.add('hidden');
  }
  updatePreviewBadge('ready', 'Ảnh sẵn sàng để xác thực');
  status(`Đã chọn ảnh "${file.name}" (${(file.size / 1024).toFixed(1)} KB). Nhấn "Xác thực ảnh tải lên" để tiếp tục.`);
}

async function poll() {
  const current = generation;
  try {
    const res = await request(`${route()}/${session}`);
    const value = (await res.json()).data;
    if (current !== generation || stopped || !session || !token) return;

    const hasRemaining = typeof value.remaining_seconds === 'number' && Number.isFinite(value.remaining_seconds);
    const remaining = hasRemaining ? value.remaining_seconds : null;

    updateProgressBar(value.samples, value.required, remaining);

    if (value.state === 'ready') {
      // Abort any in-flight live preview fetch immediately
      if (livePreviewAbort) {
        try { livePreviewAbort.abort(); } catch {}
        livePreviewAbort = null;
      }

      // Fetch frozen validated image (session-bound GET BASE/:session/preview)
      if (frozenSessionId !== session) {
        // Keep save and confirm disabled until frozen preview is loaded
        if (el('confirm')) {
          el('confirm').checked = false;
          el('confirm').disabled = true;
        }
        if (el('save')) el('save').disabled = true;

        updatePreviewBadge('waiting', 'Đang tải ảnh xác nhận từ máy chủ…');

        try {
          const previewResp = await fetch(`${route()}/${encodeURIComponent(session)}/preview`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
            signal: AbortSignal.timeout(5000)
          });
          if (current !== generation || stopped || !session || !token) return;

          if (!previewResp.ok) {
            throw new Error(`HTTP ${previewResp.status}`);
          }

          const blob = await previewResp.blob();
          if (current !== generation || stopped || !session || !token) return;

          const frozenUrl = URL.createObjectURL(blob);
          const img = el('preview');
          if (img) {
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('Image decode timeout')), 4000);
              img.onload = () => { clearTimeout(timeout); resolve(); };
              img.onerror = () => { clearTimeout(timeout); reject(new Error('Image decode error')); };
              img.src = frozenUrl;
            });
          }

          if (current !== generation || stopped || !session || !token) {
            URL.revokeObjectURL(frozenUrl);
            return;
          }

          if (previewUrl) URL.revokeObjectURL(previewUrl);
          previewUrl = frozenUrl;
          frozenSessionId = session;
          lastDecodedFrameTime = Date.now();
          if (img) img.classList.remove('hidden');
          if (el('preview-placeholder')) el('preview-placeholder').classList.add('hidden');

          updatePreviewBadge('ready', `Khuôn mặt hợp lệ (${value.samples}/${value.required}) · Sẵn sàng lưu`);
          status(`ready: ${value.samples}/${value.required} · Khuôn mặt đã được mô hình R50 xác thực đạt chuẩn. Vui lòng kiểm tra và xác nhận danh tính để lưu hồ sơ.`);
          if (el('confirm')) el('confirm').disabled = false;
          if (el('save')) el('save').disabled = false;
          hideErrorGuide();
        } catch (prevErr) {
          if (current !== generation || stopped || !session || !token) return;
          updatePreviewBadge('error', 'Lỗi tải ảnh xác nhận');
          updatePlaceholder('Không thể hiển thị ảnh xác nhận', false);
          status(`Không thể tải ảnh xác nhận: ${prevErr.message}. Vui lòng thử lại phiên mới.`);
          showErrorGuide(
            'Không thể tải ảnh xác nhận khuôn mặt',
            'Máy chủ đã xác thực đạt chuẩn nhưng không thể tải ảnh xác nhận về trình duyệt. Vui lòng nhấn "Thử lại phiên mới" để lấy mẫu lại.'
          );
          if (el('confirm')) el('confirm').disabled = true;
          if (el('save')) el('save').disabled = true;
          if (el('retry')) el('retry').hidden = false;
          return;
        }
      }
    } else if (value.state === 'rejected') {
      clearTimeout(timer);
      timer = null;
      session = null;
      const reasonMsg = localizeReason(value.reason) || 'Khuôn mặt không đạt tiêu chuẩn chất lượng R50.';
      status(`Xác thực bị từ chối: ${reasonMsg}`);
      showErrorGuide('Xác thực khuôn mặt không thành công', `${reasonMsg} Vui lòng chọn ảnh rõ mặt, đúng người và thử lại.`);
      if (el('start')) el('start').disabled = false;
      return;
    } else {
      const isExplicitTimeout = value.state === 'timeout' || value.state === 'expired';
      const isTimeExhausted = hasRemaining && remaining <= 0 && value.state !== 'ready';
      if (isExplicitTimeout || isTimeExhausted) {
        clearTimeout(timer);
        timer = null;
        session = null;
        showErrorGuide(
          'Đã hết thời gian lấy mẫu',
          'Phiên lấy mẫu đã kết thúc trước khi thu thập đủ khung hình đạt chuẩn. Bạn có thể nhấn "Thử lại phiên mới" để bắt đầu lại.'
        );
        if (el('start')) el('start').disabled = false;
        return;
      }
      // Still capturing / processing
      const reasonText = value.reason ? localizeReason(value.reason) : '';
      if (reasonText) {
        updatePreviewBadge('waiting', reasonText);
        status(`${value.state}: ${value.samples}/${value.required} (${reasonText})`);
      } else {
        updatePreviewBadge('waiting', activeSource === 'camera' ? 'Đang căn chỉnh khuôn mặt…' : 'Đang phân tích ảnh tải lên…');
        status(`${value.state}: ${value.samples}/${value.required}`);
      }
    }

    // For camera source: decoupled live preview fetch (ONLY during active capturing, NEVER when ready or frozen)
    if (activeSource === 'camera' && value.state !== 'ready' && !frozenSessionId) {
      try {
        const imageAbort = new AbortController();
        livePreviewAbort = imageAbort;
        const imageTimeout = setTimeout(() => {
          try { imageAbort.abort(); } catch {}
        }, 3000);
        try {
          const imageResp = await request(`${route()}/preview`, { signal: imageAbort.signal });
          const blob = await imageResp.blob();
          if (current === generation && !stopped && session && token && !frozenSessionId && value.state !== 'ready') {
            const sessionImgUrl = URL.createObjectURL(blob);
            if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
            pendingPreviewUrl = sessionImgUrl;
            const img = el('preview');
            if (img) {
              await new Promise((resolve, reject) => {
                if (imageAbort.signal.aborted) return reject(new Error('Aborted'));
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('Image decode error'));
                img.src = sessionImgUrl;
              });
              if (current === generation && !stopped && session && token && !frozenSessionId && value.state !== 'ready') {
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                previewUrl = sessionImgUrl;
                pendingPreviewUrl = null;
                lastDecodedFrameTime = Date.now();
                img.classList.remove('hidden');
                if (el('preview-placeholder')) el('preview-placeholder').classList.add('hidden');
              }
            }
          }
        } finally {
          clearTimeout(imageTimeout);
          if (livePreviewAbort === imageAbort) livePreviewAbort = null;
        }
      } catch {}
    }

  } catch (error) {
    if (current === generation) {
      if (el('save')) el('save').disabled = true;

      const is404 = error.status === 404 || error.message.includes('HTTP 404') || error.message.includes('404');
      if (is404) {
        clearTimeout(timer);
        timer = null;
        session = null;
        status('Phiên lấy mẫu đã kết thúc hoặc không tồn tại trên máy chủ.');
        showErrorGuide(
          'Phiên lấy mẫu đã kết thúc',
          'Phiên lấy mẫu đã đóng hoặc hết thời gian trên máy chủ. Vui lòng nhấn "Thử lại phiên mới" để bắt đầu lại.'
        );
        if (el('start')) el('start').disabled = false;
        return;
      }

      status(error.message);
      showErrorGuide('Lỗi trong phiên lấy mẫu', error.message);
    }
  }

  if (!stopped && session && current === generation) {
    timer = setTimeout(poll, activeSource === 'camera' ? 500 : 400);
  }
}

async function startCapture() {
  if (session) return;
  hideErrorGuide();
  const errBox = el('member-error');
  if (errBox) errBox.hidden = true;

  // If in create-member mode, create the member first if inputs are filled
  if (el('mode-create') && el('mode-create').checked) {
    const created = await createMember();
    if (!created) return;
  }

  // Ensure member is selected
  code = el('member')?.value || code;
  if (!code) {
    const msg = 'Vui lòng chọn hoặc tạo thành viên trước khi bắt đầu lấy mẫu.';
    if (errBox) { errBox.textContent = msg; errBox.hidden = false; }
    status(msg);
    return;
  }

  // If in upload mode, ensure a file is selected
  if (activeSource === 'upload' && !selectedFile) {
    const msg = 'Vui lòng chọn 1 file ảnh JPEG hoặc PNG trước khi gửi xác thực.';
    if (errBox) { errBox.textContent = msg; errBox.hidden = false; }
    status(msg);
    return;
  }

  if (el('start')) el('start').disabled = true;
  if (el('retry')) el('retry').hidden = true;
  if (el('confirm')) {
    el('confirm').checked = false;
    el('confirm').disabled = true;
  }
  if (el('save')) el('save').disabled = true;

  frozenSessionId = null;
  if (livePreviewAbort) {
    try { livePreviewAbort.abort(); } catch {}
    livePreviewAbort = null;
  }

  const startGen = ++generation;
  const currentToken = token;
  const currentRoute = route();

  try {
    const frames = Number(el('frames')?.value) || 1;
    currentRequired = frames;
    updateProgressBar(0, frames, null);
    updatePreviewBadge('waiting', activeSource === 'camera' ? `Bắt đầu lấy mẫu (${frames} frame)…` : 'Đang gửi ảnh lên máy chủ…');

    const startTask = (async () => {
      if (activeSource === 'upload') {
        const formData = new FormData();
        formData.append('face_image', selectedFile);
        const res = await fetch(currentRoute, {
          method: 'POST',
          headers: { Authorization: `Bearer ${currentToken}` },
          body: formData,
          signal: AbortSignal.timeout(15000),
          cache: 'no-store'
        });
        if (!res.ok) {
          let msg = `HTTP ${res.status}: không thể tải ảnh lên.`;
          try {
            const body = await res.json();
            if (body.message) msg = body.message;
            else if (body.code) msg = body.code;
          } catch {}
          const err = new Error(msg);
          err.status = res.status;
          throw err;
        }
        return (await res.json()).data;
      } else {
        const res = await request(currentRoute, {
          method: 'POST',
          body: JSON.stringify({ source: 'camera', frames })
        });
        return (await res.json()).data;
      }
    })();
    pendingStartPromise = startTask;

    const value = await startTask;

    if (stopped || generation !== startGen || !token || token !== currentToken) {
      if (value && value.session_id) {
        try {
          fetch(`${currentRoute}/${encodeURIComponent(value.session_id)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${currentToken}` },
            keepalive: true,
            signal: AbortSignal.timeout(2500)
          }).catch(() => {});
        } catch {}
      }
      return;
    }

    session = value.session_id;
    stopGlobalPreview();
    if (el('member')) el('member').disabled = true;
    if (el('frames')) el('frames').disabled = true;
    await poll();
  } catch (error) {
    if (generation !== startGen || stopped || !token || token !== currentToken) return;
    if (!session && el('start')) el('start').disabled = false;
    status(error.message);
    showErrorGuide('Không thể bắt đầu phiên lấy mẫu', error.message);
  } finally {
    pendingStartPromise = null;
  }
}

if (el('start')) el('start').addEventListener('click', startCapture);

if (el('mode-select')) {
  el('mode-select').addEventListener('change', () => {
    if (el('member-select-wrap')) el('member-select-wrap').hidden = false;
    if (el('member-create-wrap')) el('member-create-wrap').hidden = true;
    if (el('member-error')) el('member-error').hidden = true;
    onMemberSelected(el('member')?.value);
  });
}

if (el('mode-create')) {
  el('mode-create').addEventListener('change', () => {
    if (el('member-select-wrap')) el('member-select-wrap').hidden = true;
    if (el('member-create-wrap')) el('member-create-wrap').hidden = false;
    if (el('member-active-badge')) el('member-active-badge').hidden = true;
    if (el('member-error')) el('member-error').hidden = true;
    code = '';
    currentMember = null;
  });
}

if (el('member')) {
  el('member').addEventListener('change', e => {
    onMemberSelected(e.target.value);
  });
}

if (el('create-member-btn')) {
  el('create-member-btn').addEventListener('click', createMember);
}

if (el('source-camera-btn')) {
  el('source-camera-btn').addEventListener('click', () => setSource('camera'));
}

if (el('source-upload-btn')) {
  el('source-upload-btn').addEventListener('click', () => setSource('upload'));
}

if (el('face-image')) {
  el('face-image').addEventListener('change', e => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files[0]);
    }
  });
}

if (el('clear-file-btn')) {
  el('clear-file-btn').addEventListener('click', e => {
    e.stopPropagation();
    selectedFile = null;
    if (el('face-image')) el('face-image').value = '';
    if (el('selected-file-info')) el('selected-file-info').hidden = true;
    updatePlaceholder('Chưa chọn ảnh tải lên', false);
    updatePreviewBadge('waiting', 'Đang chờ chọn ảnh…');
  });
}

const dropzone = el('dropzone');
if (dropzone) {
  ['dragenter', 'dragover'].forEach(name => {
    dropzone.addEventListener(name, e => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(name => {
    dropzone.addEventListener(name, e => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', e => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  });
}

if (el('retry')) {
  el('retry').addEventListener('click', async () => {
    const currentSession = session;
    const currentRoute = (scope && scope.embedding_contract && code) ? route() : null;
    const currentToken = token;
    if (currentSession && currentRoute && currentToken) {
      try {
        await fetch(`${currentRoute}/${encodeURIComponent(currentSession)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${currentToken}` },
          signal: AbortSignal.timeout(2000)
        });
      } catch {}
    }
    clear();
    await startCapture();
  });
}

if (el('guide-retry-btn')) {
  el('guide-retry-btn').addEventListener('click', async () => {
    const currentSession = session;
    const currentRoute = (scope && scope.embedding_contract && code) ? route() : null;
    const currentToken = token;
    if (currentSession && currentRoute && currentToken) {
      try {
        await fetch(`${currentRoute}/${encodeURIComponent(currentSession)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${currentToken}` },
          signal: AbortSignal.timeout(2000)
        });
      } catch {}
    }
    clear();
    await startCapture();
  });
}

if (el('cancel')) {
  el('cancel').addEventListener('click', async () => {
    const currentSession = session;
    const inFlightStart = pendingStartPromise;
    const currentRoute = (scope && scope.embedding_contract && code) ? route() : null;
    const currentToken = token;

    if (!currentSession && !inFlightStart) {
      clear();
      status('Đã hủy.');
      return;
    }

    // Invalidate any in-flight start polling immediately
    generation++;
    clearTimeout(timer);
    timer = null;
    session = null;

    if (el('cancel')) el('cancel').disabled = true;
    status('Đang hủy phiên lấy mẫu…');

    let targetSessionId = currentSession;
    if (!targetSessionId && inFlightStart) {
      try {
        const startData = await Promise.race([
          inFlightStart,
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500))
        ]);
        if (startData && startData.session_id) {
          targetSessionId = startData.session_id;
        }
      } catch {}
    }

    let confirmed = false;
    let cancellationState = '';
    let recoverySeconds = null;
    let errDetail = '';

    if (targetSessionId && currentRoute && currentToken) {
      try {
        const res = await fetch(`${currentRoute}/${encodeURIComponent(targetSessionId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${currentToken}` },
          signal: AbortSignal.timeout(2500)
        });
        const body = await res.json().catch(() => null);
        if (res.ok && body?.data?.confirmed !== false) {
          confirmed = true;
          cancellationState = body?.data?.cancellation || 'cancelled';
        } else {
          errDetail = `HTTP ${res.status}`;
          if (body?.data?.recovery_deadline_seconds != null) {
            recoverySeconds = body.data.recovery_deadline_seconds;
          }
        }
      } catch (err) {
        errDetail = err.name === 'TimeoutError' ? 'hết thời gian chờ (timeout)' : (err.message || 'lỗi kết nối');
      }
    } else if (!inFlightStart) {
      confirmed = true;
    }

    clear();
    if (el('cancel')) el('cancel').disabled = false;

    if (confirmed) {
      if (cancellationState === 'already_absent') {
        status('Phiên lấy mẫu đã kết thúc hoặc không còn tồn tại trên máy chủ.');
      } else {
        status('Đã hủy phiên lấy mẫu.');
      }
    } else {
      if (typeof recoverySeconds === 'number') {
        status(`Chưa thể xác nhận hủy phiên trên máy chủ (${errDetail}) · phiên sẽ tự giải phóng sau khoảng ${recoverySeconds}s.`);
      } else {
        status(`Chưa thể xác nhận hủy phiên trên máy chủ (${errDetail}); mẫu RAM sẽ tự hết hạn.`);
      }
    }
  });
}

if (el('confirm')) {
  el('confirm').addEventListener('change', () => {
    if (el('save') && session) {
      el('save').disabled = false;
    }
  });
}

if (el('save')) {
  el('save').addEventListener('click', async () => {
    if (!session || !frozenSessionId) {
      status('Chưa thể lưu: Chưa tải được ảnh xác nhận đạt chuẩn.');
      return;
    }
    if (!el('confirm')?.checked) {
      status('Cần xác nhận đúng thành viên trước khi lưu.');
      return;
    }
    try {
      const commitRes = await request(`${route()}/${encodeURIComponent(session)}/commit`, {
        method: 'POST',
        body: JSON.stringify({ confirm_same_member: true })
      });
      const data = await commitRes.json();
      const savedCode = code;
      clear();

      status('Hồ sơ R50 đã được backend lưu theo contract thử nghiệm.');

      // Update enrolled status for member in memory and UI
      const u = allUsers.find(item => item.user_code === savedCode);
      if (u) {
        u.has_face_profile = 1;
        await loadMembers(savedCode);
      }
    } catch (error) {
      clear();
      status(`${error.message}. Chưa thể xác nhận lưu hồ sơ.`);
      showErrorGuide(
        'Chưa thể xác nhận lưu hồ sơ',
        `Thao tác lưu chưa được máy chủ xác nhận (${error.message}). Vui lòng kiểm tra lại thông tin thành viên hoặc nhấn "Thử lại phiên mới" để thực hiện lại.`
      );
    }
  });
}

if (el('login')) {
  el('login').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      token = (await (await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password: el('password').value })
      })).json()).data.token;
      try {
        localStorage.setItem('lab_access_token', token);
      } catch {}

      el('password').value = '';
      try {
        scope = await (await request('/api/cpu-test/admin-scope')).json();
      } catch (scopeErr) {
        if (scopeErr.status === 404 || scopeErr.message.includes('404')) {
          throw new Error('Máy chủ chưa bật chế độ kiểm thử R50 (Vui lòng khởi chạy qua tools/run_r50_laptop_test.mjs).');
        }
        throw scopeErr;
      }
      if (!['isolated-r50-laptop-test', 'isolated-cpu-test'].includes(scope.scope) || scope.production_activated !== false) {
        throw new Error('R50 laptop scope unavailable.');
      }

      await loadMembers();

      el('contract').textContent = `Contract ${scope.embedding_contract.contract_id.slice(0, 16)}… · experimental only · production disabled`;
      el('login').hidden = true;
      el('controls').hidden = false;
      stopped = false;
      status('Đã đăng nhập. Chọn thành viên và bắt đầu lấy mẫu R50.');
      if (activeSource === 'camera') {
        startGlobalPreview();
      }
    } catch (error) {
      status(error.message);
    }
  });
}

if (el('logout')) {
  el('logout').addEventListener('click', async () => {
    const currentToken = token;
    const currentSession = session;
    const currentRoute = (scope && scope.embedding_contract && code) ? route() : null;
    const inFlightStart = pendingStartPromise;
    let sessionDeletedConfirmed = false;
    let logoutRecoverySeconds = null;
    let hadSessionOrPendingStart = !!currentSession || !!inFlightStart;

    // 1. Cancel active session with bounded timeout
    if (currentSession && currentRoute && currentToken) {
      try {
        const delRes = await fetch(`${currentRoute}/${encodeURIComponent(currentSession)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${currentToken}` },
          signal: AbortSignal.timeout(2000)
        });
        const body = await delRes.json().catch(() => null);
        if (delRes.ok && body?.data?.confirmed !== false) {
          sessionDeletedConfirmed = true;
        } else if (body?.data?.recovery_deadline_seconds != null) {
          logoutRecoverySeconds = body.data.recovery_deadline_seconds;
        }
      } catch {}
    }

    // 2. Cancel in-flight start with bounded timeout
    if (inFlightStart && currentRoute && currentToken) {
      try {
        const startData = await Promise.race([
          inFlightStart,
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]);
        if (startData && startData.session_id) {
          const delRes = await fetch(`${currentRoute}/${encodeURIComponent(startData.session_id)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${currentToken}` },
            signal: AbortSignal.timeout(2000)
          });
          const body = await delRes.json().catch(() => null);
          if (delRes.ok && body?.data?.confirmed !== false) {
            sessionDeletedConfirmed = true;
          } else if (body?.data?.recovery_deadline_seconds != null) {
            logoutRecoverySeconds = body.data.recovery_deadline_seconds;
          }
        }
      } catch {}
    }

    // 3. Logout on backend with bounded timeout
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`
        },
        signal: AbortSignal.timeout(1500)
      });
    } catch {}

    // 4. Reset UI and state
    stopped = true;
    stopGlobalPreview();
    clear();
    token = '';
    try {
      localStorage.removeItem('lab_access_token');
    } catch {}
    allUsers = [];
    currentMember = null;
    selectedFile = null;
    updatePlaceholder('Đang chờ đăng nhập…', false);
    updatePreviewBadge('waiting', 'Đang chờ đăng nhập…');
    el('controls').hidden = true;
    el('login').hidden = false;
    if (hadSessionOrPendingStart && !sessionDeletedConfirmed) {
      if (typeof logoutRecoverySeconds === 'number') {
        status(`Đã đăng xuất. Chưa thể xác nhận giải phóng phiên trên máy chủ (phiên sẽ tự giải phóng sau khoảng ${logoutRecoverySeconds}s).`);
      } else {
        status('Đã đăng xuất. Chưa thể xác nhận giải phóng phiên trên máy chủ.');
      }
    } else {
      status('Đã đăng xuất.');
    }
  });
}

let pageHidden = false;

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('pagehide', () => {
    pageHidden = true;
    stopped = true;
    generation++;
    const currentToken = token;
    const currentSession = session;
    const currentRoute = (scope && scope.embedding_contract && code) ? route() : null;
    const inFlightStart = pendingStartPromise;

    if (currentSession && currentRoute && currentToken) {
      try {
        fetch(`${currentRoute}/${encodeURIComponent(currentSession)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${currentToken}` },
          keepalive: true
        }).catch(() => {});
      } catch {}
    }

    if (inFlightStart && currentRoute && currentToken) {
      inFlightStart.then(startData => {
        if (startData && startData.session_id) {
          fetch(`${currentRoute}/${encodeURIComponent(startData.session_id)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${currentToken}` },
            keepalive: true
          }).catch(() => {});
        }
      }).catch(() => {});
    }

    stopGlobalPreview();
    clear();
    updatePlaceholder('Trang đã đóng', false);
  });

  window.addEventListener('pageshow', async event => {
    if (!event.persisted && !pageHidden) {
      return;
    }
    pageHidden = false;
    const currentGen = ++generation;
    const candidateToken = token || (typeof localStorage !== 'undefined' ? localStorage.getItem('lab_access_token') : '') || '';

    if (!candidateToken) {
      stopped = true;
      token = '';
      scope = null;
      if (el('controls')) el('controls').hidden = true;
      if (el('login')) el('login').hidden = false;
      updatePlaceholder('Đang chờ đăng nhập…', false);
      updatePreviewBadge('waiting', 'Đang chờ đăng nhập…');
      return;
    }

    updatePlaceholder('Đang khôi phục phiên…', true);
    updatePreviewBadge('waiting', 'Đang kiểm tra xác thực…');

    try {
      const resp = await fetch('/api/cpu-test/admin-scope', {
        headers: { Authorization: `Bearer ${candidateToken}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(3000)
      });

      if (currentGen !== generation) return;

      if (resp.status === 200) {
        const verifiedScope = await resp.json();
        if (currentGen !== generation) return;

        if (!['isolated-r50-laptop-test', 'isolated-cpu-test'].includes(verifiedScope.scope) || verifiedScope.production_activated !== false) {
          throw new Error('R50 laptop scope unavailable.');
        }

        token = candidateToken;
        scope = verifiedScope;
        stopped = false;
        try {
          localStorage.setItem('lab_access_token', token);
        } catch {}

        if (el('contract')) {
          el('contract').textContent = `Contract ${scope.embedding_contract.contract_id.slice(0, 16)}… · experimental only · production disabled`;
        }
        if (el('login')) el('login').hidden = true;
        if (el('controls')) el('controls').hidden = false;

        await loadMembers();
        if (currentGen !== generation || stopped || !token) return;

        status('Đã khôi phục phiên đăng nhập. Sẵn sàng lấy mẫu R50.');
        if (activeSource === 'camera') {
          startGlobalPreview();
        } else if (selectedFile) {
          updatePreviewBadge('ready', 'Ảnh sẵn sàng để xác thực');
        } else {
          updatePlaceholder('Chưa chọn ảnh tải lên', false);
          updatePreviewBadge('waiting', 'Đang chờ chọn ảnh…');
        }
        return;
      }

      throw new Error(`HTTP ${resp.status}`);
    } catch (err) {
      if (currentGen !== generation) return;
      token = '';
      scope = null;
      try {
        localStorage.removeItem('lab_access_token');
      } catch {}
      stopped = true;
      if (el('controls')) el('controls').hidden = true;
      if (el('login')) el('login').hidden = false;
      updatePlaceholder('Đang chờ đăng nhập…', false);
      updatePreviewBadge('waiting', 'Đang chờ đăng nhập…');
      status('Phiên đăng nhập đã hết hạn hoặc chưa xác thực. Vui lòng đăng nhập lại.');
    }
  });
}

function checkFreshness() {
  if (frozenSessionId) return; // Static confirmation preview must not be cleared by freshness timer
  if (lastDecodedFrameTime > 0 && Date.now() - lastDecodedFrameTime > 5000 && activeSource === 'camera') {
    updatePreviewBadge('waiting', 'Đang chờ khung hình từ camera (503)…');
    updatePlaceholder('Đang chờ khung hình từ camera (503)…', true);
  }
}
if (!freshnessInterval) {
  freshnessInterval = setInterval(checkFreshness, 1000);
}
