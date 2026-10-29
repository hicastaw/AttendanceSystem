import express from 'express';
import { login, loginLimit, requireAdmin, revokeToken } from '../middleware/auth.js';

const router = express.Router();

// Đăng nhập tối giản: chỉ 1 mật khẩu admin (ADMIN_PASSWORD trong .env), không có
// bảng tài khoản/role phức tạp — PoC chỉ cần phân biệt "có quyền quản lý" hay không.
router.post('/login', loginLimit, (req, res) => {
  const { password } = req.body || {};
  if(typeof password!=='string'||password.length>1024)return res.status(400).json({status:'error',message:'Invalid password payload.'});
  const token = login(String(password || ''));
  if (!token) {
    return res.status(401).json({ status: 'error', message: 'Mật khẩu không đúng.' });
  }
  res.json({ status: 'success', data: { token } });
});
router.post('/logout',requireAdmin,(req,res)=> {revokeToken(req);res.json({status:'success'});});

export default router;
