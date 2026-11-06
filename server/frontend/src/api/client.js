const TOKEN_KEY = 'lab_access_token';
let unauthorizedHandler = null;

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}

// Gọi API backend (/api/...), tự gắn Bearer token và ném Error với message
// tiếng Việt từ backend nếu request thất bại. Trả về toàn bộ JSON phản hồi.
export async function api(path, options = {}) {
  const token = getToken();
  let res;
  try {
    res = await fetch(`/api${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new Error('Không kết nối được tới server. Kiểm tra server đang chạy rồi thử lại.');
  }

  if (res.status === 401 && token) {
    unauthorizedHandler?.();
    throw new Error('Phiên đăng nhập đã hết, vui lòng đăng nhập lại.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Server trả lỗi HTTP ${res.status}.`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function apiGet(path, params) {
  const query = params
    ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))
    : null;
  return api(query && query.toString() ? `${path}?${query}` : path);
}

function withJson(method) {
  return (path, body) => api(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export const postJson = withJson('POST');
export const patchJson = withJson('PATCH');
export const apiDelete = (path) => api(path, { method: 'DELETE' });
