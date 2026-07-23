import express from 'express';
import db from '../db.js';
import { requireAdmin, requireDeviceKey } from '../middleware/auth.js';

const router = express.Router();

// POST /api/access-events — thiết bị biên gửi 1 sự kiện check_in/check_out ĐÃ quyết
// định xong (không kèm ảnh). event_id do edge sinh ra (uuid4) là khoá chống trùng
// khi mạng lag/retry — INSERT ... ON CONFLICT(event_id) DO NOTHING là đủ, không cần
// hàm upsert phức tạp như attendance_records của project cũ (vì không còn khái niệm
// phiên/sớm/muộn nữa, chỉ là log ra/vào).
router.post('/access-events', requireDeviceKey, (req, res) => {
  const { event_id, device_id, user_code, event_type, timestamp, confidence } = req.body || {};

  if (!event_id || !device_id || !user_code || !event_type || !timestamp) {
    return res.status(400).json({
      status: 'error',
      message: 'Thiếu event_id, device_id, user_code, event_type hoặc timestamp.',
    });
  }
  if (!['check_in', 'check_out'].includes(event_type)) {
    return res.status(400).json({ status: 'error', message: 'event_type phải là check_in hoặc check_out.' });
  }

  const user = db.prepare('SELECT user_id FROM users WHERE user_code = ?')
    .get(String(user_code).trim().toUpperCase());
  if (!user) {
    return res.status(404).json({ status: 'error', message: `Không tìm thấy người dùng ${user_code}.` });
  }

  const result = db.prepare(`
    INSERT INTO access_events (event_id, user_id, device_id, event_type, confidence, event_time)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO NOTHING
  `).run(event_id, user.user_id, device_id, event_type, confidence ?? null, timestamp);

  res.json({
    status: 'success',
    duplicate: result.changes === 0,
    data: { event_id, user_code, event_type, timestamp },
  });
});

// GET /api/access-events — xem log (trang quản lý), lọc theo user_code/ngày, phân trang đơn giản
router.get('/access-events', requireAdmin, (req, res) => {
  const { user_code, from, to, limit } = req.query;
  const clauses = [];
  const params = [];

  if (user_code) {
    clauses.push('u.user_code = ?');
    params.push(String(user_code).trim().toUpperCase());
  }
  if (from) {
    clauses.push('e.event_time >= ?');
    params.push(from);
  }
  if (to) {
    clauses.push('e.event_time <= ?');
    params.push(to);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rowLimit = Math.min(Number(limit) || 200, 1000);

  const rows = db.prepare(`
    SELECT e.event_id, e.device_id, e.event_type, e.confidence, e.event_time,
           u.user_code, u.full_name
    FROM access_events e
    JOIN users u ON u.user_id = e.user_id
    ${where}
    ORDER BY e.event_time DESC
    LIMIT ?
  `).all(...params, rowLimit);

  res.json({ status: 'success', data: rows });
});

// GET /api/last-state — trạng thái check_in/check_out gần nhất của mỗi người,
// dùng để edge tự "nạp lại" cache toggle cục bộ mỗi khi khởi động/restart.
router.get('/last-state', requireDeviceKey, (req, res) => {
  const rows = db.prepare(`
    SELECT u.user_code, e.event_type
    FROM access_events e
    JOIN users u ON u.user_id = e.user_id
    WHERE e.event_time = (
      SELECT MAX(e2.event_time) FROM access_events e2 WHERE e2.user_id = e.user_id
    )
  `).all();

  const data = {};
  for (const row of rows) data[row.user_code] = row.event_type;
  res.json({ status: 'success', data });
});

// GET /api/face-data — embeddings cho thiết bị biên tải về cache cục bộ
router.get('/face-data', requireDeviceKey, (req, res) => {
  const rows = db.prepare(`
    SELECT u.user_code, u.full_name, fp.embedding
    FROM users u
    JOIN face_profiles fp ON fp.user_id = u.user_id
    WHERE u.status = 'active'
    ORDER BY u.user_code
  `).all();

  const data = rows.map((row) => ({
    user_code: row.user_code,
    full_name: row.full_name,
    embedding: JSON.parse(row.embedding),
  }));

  res.json({ status: 'success', data });
});

export default router;
