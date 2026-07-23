import express from 'express';
import axios from 'axios';
import FormData from 'form-data';
import db from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { uploadMemory } from '../upload.js';

const router = express.Router();
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8001';

// GET /api/users — danh sách người dùng + đã có hồ sơ khuôn mặt hay chưa
router.get('/', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT
      u.user_id, u.user_code, u.full_name, u.email, u.status, u.created_at,
      CASE WHEN fp.user_id IS NOT NULL THEN 1 ELSE 0 END AS has_face_profile,
      fp.updated_at AS face_updated_at
    FROM users u
    LEFT JOIN face_profiles fp ON fp.user_id = u.user_id
    ORDER BY u.user_code
  `).all();
  res.json({ status: 'success', data: rows });
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

    const embeddingJson = JSON.stringify(aiData.embedding);
    db.prepare(`
      INSERT INTO face_profiles (user_id, embedding, quality_score, updated_at)
      VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime'))
      ON CONFLICT(user_id) DO UPDATE SET
        embedding = excluded.embedding,
        quality_score = excluded.quality_score,
        updated_at = excluded.updated_at
    `).run(user.user_id, embeddingJson, aiData.sharpness_score || null);

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
