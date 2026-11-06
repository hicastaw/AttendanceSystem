import express from 'express';
import db from '../db.js';
import { requireAdmin, requireDeviceKey } from '../middleware/auth.js';
import { getFaceDataSnapshot } from '../face-data.js';
import { touchDevice } from './devices.js';

const router = express.Router();

const EVENT_TYPES = ['check_in', 'check_out'];
const MAX_BATCH_SIZE = 500;

const findUser = db.prepare('SELECT user_id FROM users WHERE user_code = ?');
const insertEvent = db.prepare(`
  INSERT INTO access_events (event_id, user_id, device_id, event_type, confidence, event_time)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(event_id) DO NOTHING
`);

// Kiểm tra + ghi 1 sự kiện. event_id do edge sinh ra (uuid4) là khoá chống trùng khi
// edge gửi lại (mất mạng, retry) — gửi lại sự kiện đã có trả `duplicate`, không lỗi.
// `rejected` là lỗi vĩnh viễn (thiếu trường, người dùng không tồn tại): edge không
// gửi lại sự kiện đó nữa.
function storeEvent(event) {
  const { event_id, device_id, user_code, event_type, timestamp, confidence } = event || {};
  if (!event_id || !device_id || !user_code || !event_type || !timestamp) {
    return { event_id, result: 'rejected', reason: 'Thiếu event_id, device_id, user_code, event_type hoặc timestamp.' };
  }
  if (!EVENT_TYPES.includes(event_type)) {
    return { event_id, result: 'rejected', reason: 'event_type phải là check_in hoặc check_out.' };
  }
  const user = findUser.get(String(user_code).trim().toUpperCase());
  if (!user) {
    return { event_id, result: 'rejected', reason: `Không tìm thấy người dùng ${user_code}.` };
  }
  const info = insertEvent.run(event_id, user.user_id, device_id, event_type, confidence ?? null, timestamp);
  return { event_id, result: info.changes ? 'accepted' : 'duplicate' };
}

// POST /api/access-events — 1 sự kiện (giữ cho công cụ recognize_image.py và client cũ).
router.post('/access-events', requireDeviceKey, (req, res) => {
  const outcome = storeEvent(req.body);
  touchDevice(req.body?.device_id, req.ip,
    outcome.result === 'accepted' ? { last_event_at: req.body.timestamp } : {});
  if (outcome.result === 'rejected') {
    return res.status(400).json({ status: 'error', message: outcome.reason });
  }
  const { event_id, user_code, event_type, timestamp } = req.body;
  res.json({
    status: 'success',
    duplicate: outcome.result === 'duplicate',
    data: { event_id, user_code, event_type, timestamp },
  });
});

// POST /api/access-events/batch — edge đồng bộ hàng đợi offline: { device_id, events: [...] }.
// Ghi trong 1 transaction, trả kết quả từng sự kiện để edge đánh dấu synced/rejected.
router.post('/access-events/batch', requireDeviceKey, (req, res) => {
  const { device_id, events } = req.body || {};
  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ status: 'error', message: 'events phải là mảng không rỗng.' });
  }
  if (events.length > MAX_BATCH_SIZE) {
    return res.status(413).json({ status: 'error', message: `Tối đa ${MAX_BATCH_SIZE} sự kiện mỗi lần.` });
  }

  const results = db.transaction((items) => items.map(storeEvent))(events);
  const accepted = events.filter((_, i) => results[i].result === 'accepted');
  const lastEventAt = accepted.map((e) => e.timestamp).sort().at(-1);
  touchDevice(device_id || events[0]?.device_id, req.ip, lastEventAt ? { last_event_at: lastEventAt } : {});

  res.json({ status: 'success', results });
});

// GET /api/access-events — xem log (trang quản lý), lọc theo user_code/ngày, phân trang đơn giản
// from/to là ngày YYYY-MM-DD (tính cả 2 đầu); offset/limit để phân trang, total = tổng số dòng.
// received_at = lúc server nhận; lệch nhiều so với event_time nghĩa là edge gửi bù
// sau khi mất mạng.
router.get('/access-events', requireAdmin, (req, res) => {
  const { user_code, event_type, from, to, limit, offset } = req.query;
  const clauses = [];
  const params = [];

  if (user_code) {
    clauses.push('u.user_code = ?');
    params.push(String(user_code).trim().toUpperCase());
  }
  if (EVENT_TYPES.includes(event_type)) {
    clauses.push('e.event_type = ?');
    params.push(event_type);
  }
  if (from) {
    clauses.push('substr(e.event_time, 1, 10) >= ?');
    params.push(String(from).slice(0, 10));
  }
  if (to) {
    clauses.push('substr(e.event_time, 1, 10) <= ?');
    params.push(String(to).slice(0, 10));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rowLimit = Math.min(Math.max(Number(limit) || 100, 1), 1000);
  const rowOffset = Math.max(Number(offset) || 0, 0);

  const { total } = db.prepare(`
    SELECT COUNT(*) AS total FROM access_events e JOIN users u ON u.user_id = e.user_id ${where}
  `).get(...params);
  const rows = db.prepare(`
    SELECT e.event_id, e.device_id, e.event_type, e.confidence, e.event_time,
           e.created_at AS received_at, u.user_code, u.full_name
    FROM access_events e
    JOIN users u ON u.user_id = e.user_id
    ${where}
    ORDER BY e.event_time DESC, e.rowid DESC
    LIMIT ? OFFSET ?
  `).all(...params, rowLimit, rowOffset);

  res.json({ status: 'success', total, data: rows });
});

// GET /api/last-state — trạng thái check_in/check_out gần nhất của mỗi người,
// dùng để edge tự "nạp lại" cache toggle cục bộ mỗi khi khởi động/restart.
router.get('/last-state', requireDeviceKey, (req, res) => {
  const rows = db.prepare(`
    SELECT u.user_code, e.event_type, e.event_time
    FROM access_events e
    JOIN users u ON u.user_id = e.user_id
    WHERE e.event_time = (
      SELECT MAX(e2.event_time) FROM access_events e2 WHERE e2.user_id = e.user_id
    )
  `).all();

  // times: thời điểm sự kiện gần nhất — edge dùng để biết sự kiện đó thuộc ngày nào
  // (reset vào/ra theo ngày).
  const data = {};
  const times = {};
  for (const row of rows) {
    data[row.user_code] = row.event_type;
    times[row.user_code] = row.event_time;
  }
  res.json({ status: 'success', data, times });
});

// GET /api/face-data — embeddings cho edge lưu vào cache cục bộ. Chỉ trả embedding
// thuộc pipeline hiện tại, kèm metadata `pipeline` để edge tự kiểm tra cùng
// model/preprocessing (edge/main.py:load_known_embeddings) và `version` (cũng là
// ETag): edge gửi If-None-Match = version đang có, không đổi thì nhận 304.
router.get('/face-data', requireDeviceKey, (req, res) => {
  const snapshot = getFaceDataSnapshot();
  const etag = `"${snapshot.version}"`;
  res.set('ETag', etag);
  if (req.get('If-None-Match') === etag) {
    return res.status(304).end();
  }
  res.json({ status: 'success', ...snapshot });
});

export default router;
