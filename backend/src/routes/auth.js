import { Router } from 'express';
import {
  changeUserPassword,
  createAccessToken,
  findAuthUserByIdentifier,
  getAuthUserById,
  registerUser,
  updateLastLogin,
  verifyPassword,
} from '../services/auth.js';
import { requireAuthenticated } from '../middleware/auth.js';

const router = Router();

function sanitizeUser(user) {
  if (!user) return null;
  return {
    auth_user_id: user.auth_user_id,
    username: user.username,
    role: user.role,
    lecturer_code: user.lecturer_code || null,
    student_code: user.student_code || null,
    full_name: user.full_name || '',
    email: user.email || null,
    must_change_password: Boolean(user.must_change_password),
    last_login_at: user.last_login_at || null,
  };
}

router.post('/login', async (req, res) => {
  const identifier = String(req.body?.identifier || '').trim();
  const password = String(req.body?.password || '');

  if (!identifier || !password) {
    return res.status(400).json({
      status: 'error',
      message: 'Vui lòng nhập tài khoản và mật khẩu.',
    });
  }

  try {
    const user = await findAuthUserByIdentifier(identifier);
    if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({
        status: 'error',
        message: 'Tài khoản hoặc mật khẩu không đúng.',
      });
    }

    await updateLastLogin(user.auth_user_id);
    const token = createAccessToken(user);
    const refreshedUser = await getAuthUserById(user.auth_user_id);

    return res.json({
      status: 'success',
      message: 'Đăng nhập thành công.',
      data: {
        access_token: token,
        token_type: 'Bearer',
        user: sanitizeUser(refreshedUser || user),
      },
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

router.get('/me', requireAuthenticated, async (req, res) => {
  try {
    const user = await getAuthUserById(req.actor.authUserId);
    if (!user || !user.is_active) {
      return res.status(401).json({ status: 'error', message: 'Phiên đăng nhập không còn hợp lệ.' });
    }

    return res.json({
      status: 'success',
      data: sanitizeUser(user),
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

router.post('/change-password', requireAuthenticated, async (req, res) => {
  const oldPassword = String(req.body?.old_password || '');
  const newPassword = String(req.body?.new_password || '');

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng nhập mật khẩu cũ và mật khẩu mới.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ status: 'error', message: 'Mật khẩu mới phải có ít nhất 8 ký tự.' });
  }

  try {
    const user = await findAuthUserByIdentifier(req.actor.username);
    if (!user || !user.is_active) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy tài khoản hiện tại.' });
    }

    if (!verifyPassword(oldPassword, user.password_hash)) {
      return res.status(400).json({ status: 'error', message: 'Mật khẩu cũ không đúng.' });
    }

    await changeUserPassword(user.auth_user_id, newPassword, false);
    const refreshedUser = await getAuthUserById(user.auth_user_id);

    return res.json({
      status: 'success',
      message: 'Đổi mật khẩu thành công.',
      data: {
        user: sanitizeUser(refreshedUser || user),
      },
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

router.post('/register', async (req, res) => {
  const role = String(req.body?.role || '').trim().toLowerCase();
  const code = String(req.body?.code || '').trim();
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!role || !code || !username || !password) {
    return res.status(400).json({ status: 'error', message: 'Vui lòng điền đầy đủ tất cả thông tin.' });
  }

  if (!['student', 'lecturer'].includes(role)) {
    return res.status(400).json({ status: 'error', message: 'Vai trò không hợp lệ. Chỉ chấp nhận student hoặc lecturer.' });
  }

  if (username.length < 4) {
    return res.status(400).json({ status: 'error', message: 'Tên đăng nhập phải có ít nhất 4 ký tự.' });
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    return res.status(400).json({ status: 'error', message: 'Tên đăng nhập chỉ được chứa chữ cái, số và ký tự . _ -' });
  }

  if (password.length < 8) {
    return res.status(400).json({ status: 'error', message: 'Mật khẩu phải có ít nhất 8 ký tự.' });
  }

  try {
    const newUserId = await registerUser({ role, code, username, password });
    const user = await getAuthUserById(newUserId);
    await updateLastLogin(newUserId);
    const token = createAccessToken(user);

    return res.status(201).json({
      status: 'success',
      message: 'Đăng ký tài khoản thành công.',
      data: {
        access_token: token,
        token_type: 'Bearer',
        user: sanitizeUser(user),
      },
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ status: 'error', message: err.message });
  }
});

export default router;
