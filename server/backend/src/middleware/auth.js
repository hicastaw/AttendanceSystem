import crypto from 'crypto';

// Auth tối giản cho PoC: 1 mật khẩu admin duy nhất (ADMIN_PASSWORD), không có
// bảng user/role phức tạp, không JWT. Token là chuỗi ngẫu nhiên lưu trong RAM —
// restart server là mọi phiên đăng nhập bị huỷ (chấp nhận được cho PoC).
const activeTokens = new Set();

export function login(password) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected || password !== expected) {
    return null;
  }
  const token = crypto.randomBytes(24).toString('hex');
  activeTokens.add(token);
  return token;
}

export function requireAdmin(req, res, next) {
  const header = req.header('authorization') || '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token || !activeTokens.has(token)) {
    return res.status(401).json({ status: 'error', message: 'Vui lòng đăng nhập.' });
  }
  next();
}

// Thiết bị biên không đăng nhập như admin — dùng 1 device key tĩnh chia sẻ trước,
// đủ cho PoC 1 thiết bị (giống hệt cách backend cũ đang làm cho /api/v1/edge/*).
export function requireDeviceKey(req, res, next) {
  const expected = process.env.EDGE_DEVICE_KEY || '';
  if (!expected) {
    return res.status(503).json({ status: 'error', message: 'EDGE_DEVICE_KEY chưa được cấu hình trên server.' });
  }
  const provided = req.header('x-device-key') || '';
  if (provided !== expected) {
    return res.status(401).json({ status: 'error', message: 'Device key không hợp lệ.' });
  }
  next();
}
