import axios from 'axios';
import { buildAuthHeaders, getStoredSession } from '../auth/session.js';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const session = getStoredSession();
  config.headers = {
    ...(config.headers || {}),
    ...buildAuthHeaders(session),
  };
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    console.error('[API Error]', err.response?.data || err.message);
    return Promise.reject(err);
  }
);

export default api;
