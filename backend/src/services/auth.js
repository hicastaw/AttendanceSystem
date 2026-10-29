import crypto from 'crypto';
import pool from '../db.js';

const TOKEN_SECRET = process.env.AUTH_SECRET || process.env.JWT_SECRET || '';
const secretConfigured = TOKEN_SECRET.length >= 32 && TOKEN_SECRET !== 'attendance-system-dev-secret-change-me';
const TOKEN_TTL_SECONDS = parseInt(process.env.AUTH_TOKEN_TTL_SECONDS || '43200', 10);
const HASH_ITERATIONS = parseInt(process.env.AUTH_HASH_ITERATIONS || '120000', 10);
const HASH_KEY_LENGTH = 64;
const HASH_DIGEST = 'sha512';

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input) {
  const normalized = String(input || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function signSegment(segment) {
  return crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(segment)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function normalizeIdentifier(value) {
  return String(value || '').trim();
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const safePassword = String(password || '');
  const derived = crypto.pbkdf2Sync(safePassword, salt, HASH_ITERATIONS, HASH_KEY_LENGTH, HASH_DIGEST).toString('hex');
  return `pbkdf2$${HASH_DIGEST}$${HASH_ITERATIONS}$${salt}$${derived}`;
}

export function verifyPassword(password, storedHash) {
  try {
    const [scheme, digest, iterationsRaw, salt, expected] = String(storedHash || '').split('$');
    if (scheme !== 'pbkdf2' || !digest || !iterationsRaw || !salt || !expected) return false;
    const iterations = parseInt(iterationsRaw, 10);
    if (!Number.isInteger(iterations) || iterations <= 0) return false;

    const actual = crypto.pbkdf2Sync(String(password || ''), salt, iterations, Buffer.from(expected, 'hex').length, digest);
    return crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export function createAccessToken(user) {
  if (!secretConfigured) throw new Error('Configure AUTH_SECRET with at least 32 characters before issuing tokens');
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: String(user.auth_user_id),
    username: user.username,
    role: user.role,
    lecturerCode: user.lecturer_code || null,
    studentCode: user.student_code || null,
    fullName: user.full_name || '',
    email: user.email || null,
    mustChangePassword: Boolean(user.must_change_password),
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signature = signSegment(unsigned);
  return `${unsigned}.${signature}`;
}

export function verifyAccessToken(token) {
  if (!secretConfigured) return null;
  try {
    const [encodedHeader, encodedPayload, signature] = String(token || '').split('.');
    if (!encodedHeader || !encodedPayload || !signature) return null;

    const unsigned = `${encodedHeader}.${encodedPayload}`;
    const expected = signSegment(unsigned);
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return null;
    }

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    const now = Math.floor(Date.now() / 1000);
    if (!payload?.sub || !payload?.role || !Number.isFinite(payload?.exp) || payload.exp <= now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export async function ensureAuthSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_users (
      auth_user_id BIGSERIAL PRIMARY KEY,
      username VARCHAR(120) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role VARCHAR(20) NOT NULL,
      lecturer_id BIGINT UNIQUE REFERENCES lecturers(lecturer_id) ON DELETE CASCADE,
      student_id BIGINT UNIQUE REFERENCES students(student_id) ON DELETE CASCADE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
      last_login_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT chk_auth_users_role CHECK (role IN ('admin', 'lecturer', 'student')),
      CONSTRAINT chk_auth_users_identity CHECK (
        (role = 'admin' AND lecturer_id IS NULL AND student_id IS NULL)
        OR (role = 'lecturer' AND lecturer_id IS NOT NULL AND student_id IS NULL)
        OR (role = 'student' AND lecturer_id IS NULL AND student_id IS NOT NULL)
      )
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_users_lecturer_id_not_null
    ON auth_users (lecturer_id)
    WHERE lecturer_id IS NOT NULL
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_users_student_id_not_null
    ON auth_users (student_id)
    WHERE student_id IS NOT NULL
  `);
}

export async function seedDemoAuthUsers() {
  if (process.env.SEED_DEMO_AUTH_USERS !== 'true') return;
  if (!process.env.DEFAULT_ADMIN_PASSWORD || process.env.DEFAULT_ADMIN_PASSWORD.length<12) {
    throw new Error('Explicit demo seeding requires DEFAULT_ADMIN_PASSWORD with at least 12 characters');
  }
  const adminHash = hashPassword(process.env.DEFAULT_ADMIN_PASSWORD);
  await pool.query(
    `INSERT INTO auth_users (username, password_hash, role, is_active, must_change_password)
     VALUES ('admin', $1, 'admin', TRUE, FALSE)
     ON CONFLICT (username) DO NOTHING`,
    [adminHash]
  );

  const lecturerRows = (await pool.query(
    `SELECT l.lecturer_id, l.lecturer_code
     FROM lecturers l
     LEFT JOIN auth_users au ON au.lecturer_id = l.lecturer_id
     WHERE au.auth_user_id IS NULL`
  )).rows;

  for (const row of lecturerRows) {
    const username = String(row.lecturer_code || '').trim().toLowerCase();
    const passwordHash = hashPassword(`${String(row.lecturer_code || '').trim().toUpperCase()}@123`);
    await pool.query(
      `INSERT INTO auth_users (username, password_hash, role, lecturer_id, is_active, must_change_password)
       VALUES ($1, $2, 'lecturer', $3, TRUE, TRUE)
       ON CONFLICT (username) DO NOTHING`,
      [username, passwordHash, row.lecturer_id]
    );
  }

  const studentRows = (await pool.query(
    `SELECT s.student_id, s.student_code
     FROM students s
     LEFT JOIN auth_users au ON au.student_id = s.student_id
     WHERE au.auth_user_id IS NULL`
  )).rows;

  for (const row of studentRows) {
    const username = String(row.student_code || '').trim().toLowerCase();
    const passwordHash = hashPassword(`${String(row.student_code || '').trim().toUpperCase()}@123`);
    await pool.query(
      `INSERT INTO auth_users (username, password_hash, role, student_id, is_active, must_change_password)
       VALUES ($1, $2, 'student', $3, TRUE, TRUE)
       ON CONFLICT (username) DO NOTHING`,
      [username, passwordHash, row.student_id]
    );
  }
}

export async function bootstrapAuthSystem() {
  await ensureAuthSchema();
  await seedDemoAuthUsers();
}

export async function findAuthUserByIdentifier(identifier) {
  const normalized = normalizeIdentifier(identifier);
  if (!normalized) return null;

  const result = await pool.query(
    `SELECT
        au.auth_user_id,
        au.username,
        au.password_hash,
        au.role,
        au.is_active,
        au.must_change_password,
        au.last_login_at,
        l.lecturer_code,
        s.student_code,
        COALESCE(l.full_name, s.full_name, 'Quản trị viên') AS full_name,
        COALESCE(l.email, s.email, NULL) AS email
     FROM auth_users au
     LEFT JOIN lecturers l ON l.lecturer_id = au.lecturer_id
     LEFT JOIN students s ON s.student_id = au.student_id
     WHERE lower(au.username) = lower($1)
        OR upper(COALESCE(l.lecturer_code, '')) = upper($1)
        OR upper(COALESCE(s.student_code, '')) = upper($1)
        OR lower(COALESCE(l.email, '')) = lower($1)
        OR lower(COALESCE(s.email, '')) = lower($1)
     LIMIT 1`,
    [normalized]
  );

  return result.rows[0] || null;
}

export async function getAuthUserById(authUserId) {
  const result = await pool.query(
    `SELECT
        au.auth_user_id,
        au.username,
        au.role,
        au.is_active,
        au.must_change_password,
        au.last_login_at,
        l.lecturer_code,
        s.student_code,
        COALESCE(l.full_name, s.full_name, 'Quản trị viên') AS full_name,
        COALESCE(l.email, s.email, NULL) AS email
     FROM auth_users au
     LEFT JOIN lecturers l ON l.lecturer_id = au.lecturer_id
     LEFT JOIN students s ON s.student_id = au.student_id
     WHERE au.auth_user_id = $1
     LIMIT 1`,
    [authUserId]
  );

  return result.rows[0] || null;
}

export async function updateLastLogin(authUserId) {
  await pool.query(
    `UPDATE auth_users
     SET last_login_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE auth_user_id = $1`,
    [authUserId]
  );
}

export async function changeUserPassword(authUserId, newPassword, markMustChangePassword = false) {
  const passwordHash = hashPassword(newPassword);
  await pool.query(
    `UPDATE auth_users
     SET password_hash = $2,
         must_change_password = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE auth_user_id = $1`,
    [authUserId, passwordHash, Boolean(markMustChangePassword)]
  );
}

/**
 * Đăng ký tài khoản mới cho sinh viên hoặc giảng viên.
 * Người dùng phải có bản ghi trong bảng students/lecturers trước.
 */
export async function registerUser({ role, code, username, password }) {
  if (!['student', 'lecturer'].includes(role)) {
    const err = new Error('Chỉ hỗ trợ đăng ký tài khoản sinh viên hoặc giảng viên.');
    err.status = 400;
    throw err;
  }

  const normalizedCode = String(code || '').trim().toUpperCase();
  const normalizedUsername = String(username || '').trim().toLowerCase();

  // Tìm sinh viên / giảng viên theo mã
  let entityId;
  let entityColumn;
  if (role === 'student') {
    const result = await pool.query(
      `SELECT student_id FROM students WHERE upper(student_code) = $1`,
      [normalizedCode]
    );
    if (result.rows.length === 0) {
      const err = new Error('Không tìm thấy sinh viên với mã này trong hệ thống.');
      err.status = 404;
      throw err;
    }
    entityId = result.rows[0].student_id;
    entityColumn = 'student_id';
  } else {
    const result = await pool.query(
      `SELECT lecturer_id FROM lecturers WHERE upper(lecturer_code) = $1`,
      [normalizedCode]
    );
    if (result.rows.length === 0) {
      const err = new Error('Không tìm thấy giảng viên với mã này trong hệ thống.');
      err.status = 404;
      throw err;
    }
    entityId = result.rows[0].lecturer_id;
    entityColumn = 'lecturer_id';
  }

  // Kiểm tra xem mã này đã có tài khoản chưa
  const existingByEntity = await pool.query(
    `SELECT auth_user_id FROM auth_users WHERE ${entityColumn} = $1`,
    [entityId]
  );
  if (existingByEntity.rows.length > 0) {
    const err = new Error(
      role === 'student'
        ? 'Mã sinh viên này đã được liên kết với một tài khoản. Vui lòng đăng nhập hoặc liên hệ quản trị viên.'
        : 'Mã giảng viên này đã được liên kết với một tài khoản. Vui lòng đăng nhập hoặc liên hệ quản trị viên.'
    );
    err.status = 409;
    throw err;
  }

  // Kiểm tra username đã tồn tại chưa
  const existingByUsername = await pool.query(
    `SELECT auth_user_id FROM auth_users WHERE lower(username) = $1`,
    [normalizedUsername]
  );
  if (existingByUsername.rows.length > 0) {
    const err = new Error('Tên đăng nhập này đã được sử dụng. Vui lòng chọn tên khác.');
    err.status = 409;
    throw err;
  }

  // Tạo tài khoản mới
  const passwordHash = hashPassword(password);
  const insertResult = await pool.query(
    `INSERT INTO auth_users (username, password_hash, role, ${entityColumn}, is_active, must_change_password)
     VALUES ($1, $2, $3, $4, TRUE, FALSE)
     RETURNING auth_user_id`,
    [normalizedUsername, passwordHash, role, entityId]
  );

  return insertResult.rows[0].auth_user_id;
}
