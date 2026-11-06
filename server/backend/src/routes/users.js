import express from 'express';
import axios from 'axios';
import FormData from 'form-data';
import db, { getCurrentPipeline } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { uploadMemory } from '../upload.js';

const router = express.Router();
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8001';

const normalizeCode = (code) => String(code).trim().toUpperCase();

const selectUsers = (where) => db.prepare(`
    SELECT
      u.user_id, u.user_code, u.full_name, u.email, u.status, u.created_at,
      CASE WHEN fp.user_id IS NOT NULL THEN 1 ELSE 0 END AS has_face_profile,
      fp.updated_at AS face_updated_at,
      fp.quality_score AS face_quality_score,
      fp.pipeline AS face_pipeline,
      (SELECT MAX(e.event_time) FROM access_events e WHERE e.user_id = u.user_id) AS last_seen_at
    FROM users u
    LEFT JOIN face_profiles fp ON fp.user_id = u.user_id
    ${where}
    ORDER BY u.user_code
  `);

// face_status: none = chưa đăng ký; outdated = embedding tạo bằng model/pipeline
// cũ, edge sẽ bỏ qua -> cần đăng ký lại; ok = đang được edge dùng.
function withFaceStatus(rows) {
  const current = getCurrentPipeline();
  return rows.map(({ face_pipeline, ...row }) => ({
    ...row,
    face_status: !row.has_face_profile ? 'none'
      : (face_pipeline && face_pipeline === current ? 'ok' : 'outdated'),
  }));
}

// GET /api/users — danh sách người dùng + tình trạng khuôn mặt + lần cuối có mặt
router.get('/', requireAdmin, (req, res) => {
  res.json({ status: 'success', data: withFaceStatus(selectUsers('').all()) });
});

// GET /api/users/:code — chi tiết 1 người dùng
router.get('/:code', requireAdmin, (req, res) => {
  const row = selectUsers('WHERE u.user_code = ?').get(normalizeCode(req.params.code));
  if (!row) {
    return res.status(404).json({ status: 'error', message: `Không tìm thấy người dùng ${req.params.code}.` });
  }
  res.json({ status: 'success', data: withFaceStatus([row])[0] });
});

// PATCH /api/users/:code — sửa họ tên, email, trạng thái (active/inactive = khoá).
router.patch('/:code', requireAdmin, (req, res) => {
  const code = normalizeCode(req.params.code);
  const { full_name, email, status } = req.body || {};
  const sets = [];
  const params = [];
  if (full_name !== undefined) {
    if (!String(full_name).trim()) {
      return res.status(400).json({ status: 'error', message: 'Họ tên không được để trống.' });
    }
    sets.push('full_name = ?'); params.push(String(full_name).trim());
  }
  if (email !== undefined) { sets.push('email = ?'); params.push(String(email).trim() || null); }
  if (status !== undefined) {
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ status: 'error', message: 'status phải là active hoặc inactive.' });
    }
    sets.push('status = ?'); params.push(status);
  }
  if (!sets.length) {
    return res.status(400).json({ status: 'error', message: 'Không có trường nào để cập nhật.' });
  }
  const info = db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE user_code = ?`).run(...params, code);
  if (!info.changes) {
    return res.status(404).json({ status: 'error', message: `Không tìm thấy người dùng ${code}.` });
  }
  res.json({ status: 'success', data: withFaceStatus([selectUsers('WHERE u.user_code = ?').get(code)])[0] });
});

// DELETE /api/users/:code — xoá hẳn người dùng, kèm khuôn mặt và toàn bộ lịch sử
// ra/vào (ON DELETE CASCADE). Không khôi phục được.
router.delete('/:code', requireAdmin, (req, res) => {
  const code = normalizeCode(req.params.code);
  const info = db.prepare('DELETE FROM users WHERE user_code = ?').run(code);
  if (!info.changes) {
    return res.status(404).json({ status: 'error', message: `Không tìm thấy người dùng ${code}.` });
  }
  res.json({ status: 'success', data: { user_code: code } });
});

// POST /api/users — tạo người dùng mới (chưa có khuôn mặt)
router.post('/', requireAdmin, (req, res) => {
  const { user_code, full_name, email } = req.body || {};
  if (!user_code || !full_name) {
    return res.status(400).json({ status: 'error', message: 'Thiếu user_code hoặc full_name.' });
  }
  try {
    const info = db.prepare(`
      INSERT INTO users (user_code, full_name, email) VALUES (?, ?, ?)
    `).run(String(user_code).trim().toUpperCase(), String(full_name).trim(), email || null);
    res.status(201).json({ status: 'success', data: { user_id: info.lastInsertRowid } });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ status: 'error', message: `user_code ${user_code} đã tồn tại.` });
    }
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// POST /api/users/:code/face — upload ảnh, validate qua AI Service, lưu embedding
router.post('/:code/face', requireAdmin, uploadMemory.single('face_image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'Thiếu file ảnh.' });
  }
  const code = String(req.params.code).trim().toUpperCase();
  const user = db.prepare('SELECT user_id FROM users WHERE user_code = ?').get(code);
  if (!user) {
    return res.status(404).json({ status: 'error', message: `Không tìm thấy người dùng ${code}.` });
  }

  try {
    const form = new FormData();
    form.append('face_image', req.file.buffer, {
      filename: req.file.originalname || 'face.jpg',
      contentType: req.file.mimetype,
    });

    const aiResponse = await axios.post(`${AI_SERVICE_URL}/ai/face/validate`, form, {
      headers: form.getHeaders(),
      timeout: 30000,
    });
    const aiData = aiResponse.data;

    if (!aiData.is_valid) {
      return res.status(400).json({
        status: 'error',
        code: aiData.error_code,
        message: aiData.message,
        sharpness_score: aiData.sharpness_score,
      });
    }

    if (!aiData.pipeline) {
      return res.status(502).json({
        status: 'error',
        message: 'AI Service không trả metadata pipeline — cập nhật AI Service lên bản EdgeFace.',
      });
    }

    const embeddingJson = JSON.stringify(aiData.embedding);
    db.prepare(`
      INSERT INTO face_profiles (user_id, embedding, pipeline, quality_score, updated_at)
      VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime'))
      ON CONFLICT(user_id) DO UPDATE SET
        embedding = excluded.embedding,
        pipeline = excluded.pipeline,
        quality_score = excluded.quality_score,
        updated_at = excluded.updated_at
    `).run(user.user_id, embeddingJson, JSON.stringify(aiData.pipeline), aiData.sharpness_score || null);

    res.json({
      status: 'success',
      message: 'Đã đăng ký khuôn mặt thành công.',
      data: { sharpness_score: aiData.sharpness_score },
    });
  } catch (err) {
    const msg = err.response?.data?.detail || err.message;
    res.status(500).json({ status: 'error', message: `Lỗi AI Service: ${msg}` });
  }
});

export default router;
