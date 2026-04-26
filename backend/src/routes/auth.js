import { Router } from 'express';
import {
  changeUserPassword,
  createAccessToken,
  findAuthUserByIdentifier,
  getAuthUserById,
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

export default router;
