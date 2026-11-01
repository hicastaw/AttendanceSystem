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
// tiếng Việt từ backend nếu request thất bại.
export async function api(path, options = {}) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (res.status === 401 && token) {
    unauthorizedHandler?.();
    throw new Error('Phiên đăng nhập đã hết, vui lòng đăng nhập lại.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Lỗi HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function postJson(path, body) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
