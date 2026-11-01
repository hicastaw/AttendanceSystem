import express from 'express';
import { login } from '../middleware/auth.js';

const router = express.Router();

// Đăng nhập tối giản: chỉ 1 mật khẩu admin (ADMIN_PASSWORD trong .env), không có
// bảng tài khoản/role phức tạp — PoC chỉ cần phân biệt "có quyền quản lý" hay không.
router.post('/login', (req, res) => {
  const { password } = req.body || {};
  const token = login(String(password || ''));
  if (!token) {
    return res.status(401).json({ status: 'error', message: 'Mật khẩu không đúng.' });
  }
  res.json({ status: 'success', data: { token } });
});

export default router;
