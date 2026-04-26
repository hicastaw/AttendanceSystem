import pool from '../db.js';
import { verifyAccessToken } from '../services/auth.js';

const VALID_ROLES = new Set(['admin', 'lecturer', 'student']);

function normalizeCode(value) {
  return value ? String(value).trim().toUpperCase() : '';
}

function buildAnonymousActor() {
  return {
    role: 'anonymous',
    authUserId: null,
    username: '',
    lecturerCode: '',
    studentCode: '',
    fullName: '',
    email: null,
    authMode: 'none',
    mustChangePassword: false,
  };
}

export function attachActor(req, _res, next) {
  const anonymous = buildAnonymousActor();
  const authHeader = String(req.header('authorization') || '');
  const token = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';

  if (token) {
    const payload = verifyAccessToken(token);
    if (payload && VALID_ROLES.has(payload.role)) {
      req.actor = {
        role: payload.role,
        authUserId: Number(payload.sub) || null,
        username: String(payload.username || '').trim(),
        lecturerCode: normalizeCode(payload.lecturerCode),
        studentCode: normalizeCode(payload.studentCode),
        fullName: String(payload.fullName || '').trim(),
        email: payload.email || null,
        mustChangePassword: Boolean(payload.mustChangePassword),
        authMode: 'token',
      };
      return next();
    }
  }

  const roleHeader = String(req.header('x-user-role') || '').trim().toLowerCase();
  const role = VALID_ROLES.has(roleHeader) ? roleHeader : 'anonymous';

  req.actor = {
    ...anonymous,
    role,
    lecturerCode: normalizeCode(req.header('x-lecturer-code')),
    studentCode: normalizeCode(req.header('x-student-code')),
    authMode: role === 'anonymous' ? 'none' : 'legacy-header',
  };

  next();
}

export function requireAuthenticated(req, res, next) {
  if (req.actor?.role && req.actor.role !== 'anonymous') {
    return next();
  }
  return res.status(401).json({
    status: 'error',
    message: 'Vui lòng đăng nhập để tiếp tục.',
  });
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.actor?.role)) {
      const status = req.actor?.role === 'anonymous' ? 401 : 403;
      return res.status(status).json({
        status: 'error',
        message: req.actor?.role === 'anonymous'
          ? 'Vui lòng đăng nhập để tiếp tục.'
          : 'Bạn không có quyền truy cập chức năng này.',
      });
    }
    next();
  };
}

export function requireLecturerSelf(paramName = 'code') {
  return (req, res, next) => {
    if (req.actor?.role === 'admin') return next();
    if (req.actor?.role !== 'lecturer') {
      return res.status(req.actor?.role === 'anonymous' ? 401 : 403).json({
        status: 'error',
        message: 'Chức năng này chỉ dành cho giảng viên hoặc quản trị viên.',
      });
    }

    const requestedCode = normalizeCode(req.params[paramName]);
    if (!req.actor.lecturerCode || requestedCode !== req.actor.lecturerCode) {
      return res.status(403).json({
        status: 'error',
        message: 'Bạn chỉ được thao tác trên tài khoản giảng viên của chính mình.',
      });
    }
    next();
  };
}

export function requireStudentSelf(paramName = 'code') {
  return (req, res, next) => {
    if (req.actor?.role === 'admin') return next();
    if (req.actor?.role !== 'student') {
      return res.status(req.actor?.role === 'anonymous' ? 401 : 403).json({
        status: 'error',
        message: 'Chức năng này chỉ dành cho sinh viên hoặc quản trị viên.',
      });
    }

    const requestedCode = normalizeCode(req.params[paramName]);
    if (!req.actor.studentCode || requestedCode !== req.actor.studentCode) {
      return res.status(403).json({
        status: 'error',
        message: 'Bạn chỉ được thao tác trên hồ sơ sinh viên của chính mình.',
      });
    }
    next();
  };
}

export function requireStudentSelfOrStaff(paramName = 'code') {
  return (req, res, next) => {
    if (req.actor?.role === 'admin' || req.actor?.role === 'lecturer') return next();
    if (req.actor?.role !== 'student') {
      return res.status(req.actor?.role === 'anonymous' ? 401 : 403).json({
        status: 'error',
        message: 'Bạn không có quyền truy cập hồ sơ sinh viên này.',
      });
    }

    const requestedCode = normalizeCode(req.params[paramName]);
    if (!req.actor.studentCode || requestedCode !== req.actor.studentCode) {
      return res.status(403).json({
        status: 'error',
        message: 'Bạn chỉ được thao tác trên hồ sơ sinh viên của chính mình.',
      });
    }
    next();
  };
}

export async function ensureLecturerOwnsSection(req, res, next) {
  if (req.actor?.role === 'admin') return next();
  if (req.actor?.role !== 'lecturer' || !req.actor.lecturerCode) {
    return res.status(req.actor?.role === 'anonymous' ? 401 : 403).json({
      status: 'error',
      message: 'Bạn không có quyền thao tác học phần này.',
    });
  }

  const sectionId = Number(
    req.params.sectionId || req.body?.section_id || req.query?.section_id || req.params.id || 0
  );
  if (!Number.isInteger(sectionId) || sectionId <= 0) {
    return res.status(400).json({ status: 'error', message: 'section_id không hợp lệ.' });
  }

  try {
    const result = await pool.query(
      `SELECT 1
       FROM course_sections cs
       JOIN lecturers l ON l.lecturer_id = cs.lecturer_id
       WHERE cs.section_id = $1 AND l.lecturer_code = $2
       LIMIT 1`,
      [sectionId, req.actor.lecturerCode]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        status: 'error',
        message: 'Bạn không phụ trách học phần này.',
      });
    }

    next();
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
}

export async function ensureLecturerOwnsSession(req, res, next) {
  if (req.actor?.role === 'admin') return next();
  if (req.actor?.role !== 'lecturer' || !req.actor.lecturerCode) {
    return res.status(req.actor?.role === 'anonymous' ? 401 : 403).json({
      status: 'error',
      message: 'Bạn không có quyền thao tác phiên điểm danh này.',
    });
  }

  const sessionId = Number(req.params.id || req.params.sessionId || req.body?.session_id || 0);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return res.status(400).json({ status: 'error', message: 'session_id không hợp lệ.' });
  }

  try {
    const result = await pool.query(
      `SELECT 1
       FROM attendance_sessions att
       JOIN course_sections cs ON cs.section_id = att.section_id
       JOIN lecturers l ON l.lecturer_id = cs.lecturer_id
       WHERE att.session_id = $1 AND l.lecturer_code = $2
       LIMIT 1`,
      [sessionId, req.actor.lecturerCode]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        status: 'error',
        message: 'Bạn không phụ trách phiên điểm danh này.',
      });
    }

    next();
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
}

export function getEffectiveStudentCode(req, explicitValue = null) {
  const actorStudentCode = normalizeCode(req.actor?.studentCode);
  const requestedCode = normalizeCode(explicitValue);

  if (req.actor?.role === 'student') {
    if (!actorStudentCode) {
      return { error: { status: 403, message: 'Thiếu mã sinh viên trong phiên đăng nhập.' } };
    }
    if (requestedCode && requestedCode !== actorStudentCode) {
      return { error: { status: 403, message: 'Bạn chỉ được thao tác với mã sinh viên của chính mình.' } };
    }
    return { studentCode: actorStudentCode };
  }

  return { studentCode: requestedCode || actorStudentCode || null };
}
