import express from 'express';
import db from '../db.js';
import { requireAdmin, requireDeviceKey } from '../middleware/auth.js';
import { getFaceDataVersion } from '../face-data.js';

const router = express.Router();

// Thiết bị coi là online nếu gửi heartbeat trong khoảng này (edge mặc định 30 giây/lần).
const ONLINE_WINDOW_SECONDS = 90;

// Ghi nhận thiết bị vừa liên lạc với server (heartbeat hoặc gửi sự kiện).
export function touchDevice(deviceId, ip, fields = {}) {
  if (!deviceId) return;
  db.prepare(`
    INSERT INTO devices (device_id, last_ip) VALUES (?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      last_seen_at = strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime'),
      last_ip = excluded.last_ip
  `).run(String(deviceId), ip || null);

  const allowed = ['last_event_at', 'pending_events', 'rejected_events', 'face_data_version', 'status'];
  const entries = Object.entries(fields).filter(([key, value]) => allowed.includes(key) && value !== undefined);
  if (entries.length) {
    db.prepare(`UPDATE devices SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE device_id = ?`)
      .run(...entries.map(([, value]) => value), String(deviceId));
  }
}

// POST /api/devices/heartbeat — edge báo còn sống + trạng thái đồng bộ. Server trả
// face_data_version hiện tại để edge tải lại khuôn mặt ngay khi có thay đổi.
router.post('/heartbeat', requireDeviceKey, (req, res) => {
  const { device_id, pending_events, rejected_events, face_data_version, status } = req.body || {};
  if (!device_id) {
    return res.status(400).json({ status: 'error', message: 'Thiếu device_id.' });
  }
  touchDevice(device_id, req.ip, {
    pending_events: Number.isInteger(pending_events) ? pending_events : null,
    rejected_events: Number.isInteger(rejected_events) ? rejected_events : null,
    face_data_version: face_data_version || null,
    status: status ? JSON.stringify(status) : null,
  });
  res.json({
    status: 'success',
    data: { server_time: new Date().toISOString(), face_data_version: getFaceDataVersion() },
  });
});

// GET /api/devices — danh sách thiết bị cho trang quản trị.
router.get('/', requireAdmin, (req, res) => {
  const currentVersion = getFaceDataVersion();
  const rows = db.prepare(`
    SELECT *,
      (strftime('%s', 'now', 'localtime') - strftime('%s', last_seen_at)) AS seconds_since_seen
    FROM devices
    ORDER BY device_id
  `).all();
  const data = rows.map(({ status, seconds_since_seen, ...row }) => ({
    ...row,
    status: status ? JSON.parse(status) : null,
    seconds_since_seen,
    online: seconds_since_seen <= ONLINE_WINDOW_SECONDS,
    face_data_up_to_date: row.face_data_version === currentVersion,
  }));
  res.json({ status: 'success', data });
});

export default router;
