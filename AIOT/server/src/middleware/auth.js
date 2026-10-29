import crypto from 'crypto';

// Auth tối giản cho PoC: 1 mật khẩu admin duy nhất (ADMIN_PASSWORD), không có
// bảng user/role phức tạp, không JWT. Token là chuỗi ngẫu nhiên lưu trong RAM —
// restart server là mọi phiên đăng nhập bị huỷ (chấp nhận được cho PoC).
const activeTokens = new Map();
const ttl = Math.max(1,Number(process.env.ADMIN_TOKEN_TTL_SECONDS)||3600)*1000;
const attempts = new Map();
function equalSecret(a,b) {
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(),crypto.createHash('sha256').update(b).digest());
}
export function loginLimit(req,res,next) {
  const now=Date.now(), key=req.ip;
  for (const [ip,entry] of attempts) if (now-entry.at>60000) attempts.delete(ip);
  if(!attempts.has(key) && attempts.size>=10000)return res.status(429).json({status:'error',message:'Login capacity exceeded.'});
  const entry=attempts.get(key) || {at:now,count:0};
  if (++entry.count>10) return res.status(429).json({status:'error',message:'Thử lại sau một phút.'});
  attempts.set(key,entry); next();
}

export function login(password) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected || expected.startsWith('change-me') || !equalSecret(password,expected)) {
    return null;
  }
  const token = crypto.randomBytes(24).toString('hex');
  for (const [key,expires] of activeTokens) if (expires<=Date.now()) activeTokens.delete(key);
  if (activeTokens.size>=100) activeTokens.delete(activeTokens.keys().next().value);
  activeTokens.set(token,Date.now()+ttl);
  return token;
}

export function requireAdmin(req, res, next) {
  const header = req.header('authorization') || '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token || (activeTokens.get(token)||0)<=Date.now()) {
    activeTokens.delete(token);
    return res.status(401).json({ status: 'error', message: 'Vui lòng đăng nhập.' });
  }
  next();
}
export function revokeToken(req) {
  activeTokens.delete((req.header('authorization') || '').slice(7).trim());
}

// Thiết bị biên không đăng nhập như admin — dùng 1 device key tĩnh chia sẻ trước,
// đủ cho PoC 1 thiết bị (giống hệt cách backend cũ đang làm cho /api/v1/edge/*).
export function requireDeviceKey(req, res, next) {
  const expected = process.env.EDGE_DEVICE_KEY || '';
  if (!expected || expected.startsWith('change-me')) {
    return res.status(503).json({ status: 'error', message: 'EDGE_DEVICE_KEY chưa được cấu hình trên server.' });
  }
  const provided = req.header('x-device-key') || '';
  if (!equalSecret(provided,expected)) {
    return res.status(401).json({ status: 'error', message: 'Device key không hợp lệ.' });
  }
  next();
}
