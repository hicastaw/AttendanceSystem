import crypto from 'crypto';
import db, { getCurrentPipeline } from './db.js';

// Ảnh chụp dữ liệu khuôn mặt edge cần: embedding của người dùng active thuộc pipeline
// hiện tại. `version` là hash nội dung — đổi khi thêm/sửa/xoá khuôn mặt, đổi tên hay
// khoá người dùng — để edge chỉ tải lại khi có thay đổi (ETag / heartbeat).
export function getFaceDataSnapshot() {
  const current = getCurrentPipeline();
  if (!current) {
    return { pipeline: null, data: [], version: hashVersion('empty') };
  }

  const rows = db.prepare(`
    SELECT u.user_code, u.full_name, fp.embedding
    FROM users u
    JOIN face_profiles fp ON fp.user_id = u.user_id
    WHERE u.status = 'active' AND fp.pipeline = ?
    ORDER BY u.user_code
  `).all(current);

  const version = hashVersion(JSON.stringify([current, rows]));
  const data = rows.map((row) => ({
    user_code: row.user_code,
    full_name: row.full_name,
    embedding: JSON.parse(row.embedding),
  }));
  return { pipeline: JSON.parse(current), data, version };
}

export function getFaceDataVersion() {
  return getFaceDataSnapshot().version;
}

function hashVersion(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}
