const STORAGE_KEY = 'attendance_system_session';

function normalizeRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return ['admin', 'lecturer', 'student'].includes(normalized) ? normalized : 'anonymous';
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

export function normalizeUser(input = null) {
  if (!input) {
    return {
      role: 'anonymous',
      username: '',
      fullName: '',
      email: null,
      lecturerCode: '',
      studentCode: '',
      mustChangePassword: false,
      lastLoginAt: null,
    };
  }

  const role = normalizeRole(input.role);
  return {
    role,
    username: String(input.username || '').trim(),
    fullName: String(input.full_name || input.fullName || '').trim(),
    email: input.email || null,
    lecturerCode: normalizeCode(input.lecturer_code || input.lecturerCode),
    studentCode: normalizeCode(input.student_code || input.studentCode),
    mustChangePassword: Boolean(input.must_change_password ?? input.mustChangePassword),
    lastLoginAt: input.last_login_at || input.lastLoginAt || null,
  };
}

export function normalizeSession(input = {}) {
  return {
    token: String(input.token || input.access_token || '').trim(),
    user: normalizeUser(input.user),
  };
}

export function getStoredSession() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeSession();
    return normalizeSession(JSON.parse(raw));
  } catch {
    return normalizeSession();
  }
}

export function setStoredSession(session) {
  const normalized = normalizeSession(session);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function clearStoredSession() {
  window.localStorage.removeItem(STORAGE_KEY);
  return normalizeSession();
}

export function buildAuthHeaders(session) {
  const normalized = normalizeSession(session);
  const headers = {};
  if (normalized.token) {
    headers.Authorization = `Bearer ${normalized.token}`;
  }
  return headers;
}

export function getActorLabel(user) {
  const normalized = normalizeUser(user);
  if (normalized.role === 'admin') return normalized.fullName || 'Quản trị viên';
  if (normalized.role === 'lecturer') {
    return normalized.fullName
      ? `${normalized.fullName} • ${normalized.lecturerCode || 'GV'}`
      : `Giảng viên${normalized.lecturerCode ? ` • ${normalized.lecturerCode}` : ''}`;
  }
  if (normalized.role === 'student') {
    return normalized.fullName
      ? `${normalized.fullName} • ${normalized.studentCode || 'SV'}`
      : `Sinh viên${normalized.studentCode ? ` • ${normalized.studentCode}` : ''}`;
  }
  return 'Chưa đăng nhập';
}
