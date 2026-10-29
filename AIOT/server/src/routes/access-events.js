import express from 'express';
import db from '../db.js';
import { requireAdmin, requireDeviceKey } from '../middleware/auth.js';
import {resolveContext} from '../attendance-schedule.js';
import {listEvents} from './scheduled-events.js';
import {contract, contractJson, mode, normalizeEmbedding} from '../runtime.js';
import {cpuTestScope} from '../cpu-test-scope.js';
import {localCheckinDate} from '../lab-attendance-store.js';

const router = express.Router();

// POST /api/access-events — thiết bị biên gửi 1 sự kiện check_in/check_out ĐÃ quyết
// định xong (không kèm ảnh). event_id do edge sinh ra (uuid4) là khoá chống trùng
// khi mạng lag/retry — INSERT ... ON CONFLICT(event_id) DO NOTHING là đủ, không cần
// hàm upsert phức tạp như attendance_records của project cũ (vì không còn khái niệm
// phiên/sớm/muộn nữa, chỉ là log ra/vào).
router.post('/access-events', requireDeviceKey, (req, res) => {
  const { event_id, device_id, user_code, event_type, timestamp, confidence } = req.body || {};

  if (![event_id, device_id, user_code, timestamp].every(v=>typeof v==='string' && v.trim() && v.length<=200) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event_id) ||
      (confidence != null && (typeof confidence!=='number' || !Number.isFinite(confidence) || confidence<0 || confidence>100)) ||
      (mode === 'mock' ? !device_id.startsWith('MOCK_') : device_id.startsWith('MOCK_'))) {
    return res.status(400).json({
      status: 'error',
      message: 'Thiếu event_id, device_id, user_code, event_type hoặc timestamp.',
    });
  }
  if (!['check_in', 'check_out'].includes(event_type)) {
    return res.status(400).json({ status: 'error', message: 'event_type phải là check_in hoặc check_out.' });
  }
  try { resolveContext(timestamp, []); }
  catch { return res.status(400).json({status:'error',message:'Timestamp cần ISO-8601 hợp lệ có timezone.'}); }

  const user = db.prepare('SELECT user_id,status FROM users WHERE user_code = ?')
    .get(String(user_code).trim().toUpperCase());
  if (!user) {
    return res.status(404).json({ status: 'error', message: `Không tìm thấy người dùng ${user_code}.` });
  }

  try {
    const dailyPolicy = cpuTestScope?.purpose === 'isolated-r50-laptop-test';
    const persist = db.transaction(() => {
      const payload=JSON.stringify({event_id,device_id,user_code:user_code.trim().toUpperCase(),event_type,timestamp,confidence:confidence ?? null});
      const receipt=db.prepare('SELECT * FROM event_receipts WHERE event_id=?').get(event_id);
      if(receipt) {
        if(receipt.payload!==payload)return {conflict:true};
        const prior=db.prepare('SELECT * FROM access_events WHERE event_id=?').get(receipt.attendance_event_id);
        return {duplicate:true,context:{scheduled_event_id:prior.scheduled_event_id,occurrence_key:prior.occurrence_key,event_name:prior.event_name}};
      }
      const existing = db.prepare('SELECT * FROM access_events WHERE event_id=?').get(event_id);
      if (existing) {
        if (existing.user_id!==user.user_id || existing.device_id!==device_id || existing.event_type!==event_type ||
            existing.event_time!==timestamp || existing.confidence!==(confidence ?? null)) {
          return {conflict:true};
        }
        return {duplicate:true,context:{scheduled_event_id:existing.scheduled_event_id,
          occurrence_key:existing.occurrence_key,event_name:existing.event_name}};
      }
      if (user.status !== 'active') return {inactive:true};
      const dailyDemo = dailyPolicy && event_type === 'check_in';
      const localDate = dailyDemo ? localCheckinDate(timestamp) : null;
      if (dailyDemo) {
        const daily = db.prepare('SELECT event_id,event_time FROM lab_daily_checkins WHERE user_id=? AND local_checkin_date=?')
          .get(user.user_id, localDate);
        if (daily) {
          const prior = db.prepare('SELECT scheduled_event_id,occurrence_key,event_name FROM access_events WHERE event_id=?').get(daily.event_id);
          db.prepare('INSERT INTO event_receipts VALUES (?,?,?)').run(event_id,payload,daily.event_id);
          return {duplicate:true,daily_duplicate:true,context:{scheduled_event_id:prior?.scheduled_event_id??null,
            occurrence_key:prior?.occurrence_key??null,event_name:prior?.event_name??null}};
        }
      }
      // Receipt time is irrelevant, including replay after a delayed offline send.
      const selected = resolveContext(timestamp,listEvents());
      const context = event_type==='check_in' ? selected : {scheduled_event_id:null,occurrence_key:null,event_name:null};
      // Deduplicate across devices/new ledgers as well as event UUID retries.
      // Preserve existing duplicate history; do not add a destructive UNIQUE migration.
      if (context.occurrence_key) {
        const prior = db.prepare('SELECT * FROM access_events WHERE user_id=? AND occurrence_key=? AND event_type=\'check_in\' LIMIT 1')
          .get(user.user_id,context.occurrence_key);
        if (prior) {
          db.prepare('INSERT INTO event_receipts VALUES (?,?,?)').run(event_id,payload,prior.event_id);
          return {duplicate:true,context:{scheduled_event_id:prior.scheduled_event_id,occurrence_key:prior.occurrence_key,event_name:prior.event_name}};
        }
      }
      db.prepare(`INSERT INTO access_events
        (event_id,user_id,device_id,event_type,confidence,event_time,scheduled_event_id,occurrence_key,event_name)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(event_id,user.user_id,device_id,event_type,confidence ?? null,timestamp,
          context.scheduled_event_id,context.occurrence_key,context.event_name);
      if (dailyDemo) db.prepare(`INSERT INTO lab_daily_checkins(user_id,local_checkin_date,event_id,event_time)
        VALUES (?,?,?,?)`).run(user.user_id,localDate,event_id,timestamp);
      return {duplicate:false,daily_duplicate:false,context};
    });
    // Acquire the SQLite write lock before checking the day ledger so requests
    // from separate local clients serialize and the loser returns a receipt ACK.
    const result = dailyPolicy ? persist.immediate() : persist();
    if (result.conflict) return res.status(409).json({status:'error',message:'event_id đã có payload khác.'});
    if (result.inactive) return res.status(403).json({status:'error',message:'Thành viên đã ngừng hoạt động.'});
    res.json({status:'success',duplicate:result.duplicate,data:{event_id,user_code,event_type,timestamp},
      attendance_context:result.context,
      ...(cpuTestScope?.purpose === 'isolated-r50-laptop-test' && event_type === 'check_in'
        ? {attendance_result:result.daily_duplicate?'ALREADY_CHECKED_IN':'CHECK_IN_SUCCESS'} : {})});
  } catch (error) { console.error('Attendance persistence failed:', error.code || 'database_error'); res.status(503).json({status:'error',message:'Không thể lưu điểm danh. Thiết bị cần thử lại.'}); }
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
    clauses.push('julianday(e.event_time) >= julianday(?)');
    params.push(from);
  }
  if (to) {
    clauses.push('julianday(e.event_time) <= julianday(?)');
    params.push(to);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rowLimit = Math.max(1, Math.min(Math.trunc(Number(limit)) || 200, 1000));

  const rows = db.prepare(`
    SELECT e.event_id, e.device_id, e.event_type, e.confidence, e.event_time,
           e.scheduled_event_id, e.occurrence_key, e.event_name,
           u.user_code, u.full_name
    FROM access_events e
    JOIN users u ON u.user_id = e.user_id
    ${where}
    ORDER BY julianday(e.event_time) DESC, e.rowid DESC
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
    WHERE e.rowid = (
      SELECT e2.rowid FROM access_events e2 WHERE e2.user_id = e.user_id
      ORDER BY julianday(e2.event_time) DESC,e2.rowid DESC LIMIT 1
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
    WHERE u.status = 'active' AND fp.embedding_contract = ?
    ORDER BY u.user_code
  `).all(contractJson);

  const data = rows.map((row) => ({
    user_code: row.user_code,
    full_name: row.full_name,
    embedding: normalizeEmbedding(JSON.parse(row.embedding)),
  }));

  res.json({ status: 'success', data, embedding_contract:contract, mode });
});

export default router;
