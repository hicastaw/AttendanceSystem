import express from 'express';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import pool from '../db.js';
import { upload } from '../upload.js';

const router = express.Router();
const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8001';

// ─────────────────────────────────────────────
// GET /api/v1/students/classes
// Lấy danh sách lớp hành chính
// ─────────────────────────────────────────────
router.get('/classes', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT class_id, class_name, class_code FROM classes ORDER BY class_name'
    );
    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/v1/students
// Lấy danh sách tất cả sinh viên (kèm lớp + face_profile)
// ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        s.student_id,
        s.student_code,
        s.full_name,
        s.email,
        s.status,
        c.class_name,
        c.class_id,
        fp.image_path,
        fp.quality_score,
        fp.model_name,
        fp.updated_at AS face_updated_at
      FROM students s
      JOIN classes c ON s.class_id = c.class_id
      LEFT JOIN face_profiles fp ON fp.student_id = s.student_id
      ORDER BY s.student_code
    `);
    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/v1/students/:code
// Lấy thông tin 1 sinh viên theo mã SV
// ─────────────────────────────────────────────
router.get('/:code', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        s.student_id,
        s.student_code,
        s.full_name,
        s.email,
        s.status,
        c.class_name,
        c.class_id,
        fp.image_path,
        fp.quality_score,
        fp.model_name,
        fp.updated_at AS face_updated_at,
        CASE WHEN fp.student_id IS NOT NULL THEN true ELSE false END AS has_face_profile
      FROM students s
      JOIN classes c ON s.class_id = c.class_id
      LEFT JOIN face_profiles fp ON fp.student_id = s.student_id
      WHERE s.student_code = $1
    `, [req.params.code.toUpperCase()]);

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy sinh viên.' });
    }
    res.json({ status: 'success', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/v1/students/face/validate
// Upload ảnh → forward sang AI Service → trả về embedding + kết quả
// ─────────────────────────────────────────────
router.post('/face/validate', upload.single('face_image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'Thiếu file ảnh.' });
  }

  try {
    // Forward ảnh sang AI Service
    const form = new FormData();
    form.append('face_image', fs.createReadStream(req.file.path), {
      filename: req.file.filename,
      contentType: req.file.mimetype,
    });

    const aiResponse = await axios.post(`${AI_URL}/ai/face/validate`, form, {
      headers: form.getHeaders(),
      timeout: 30000,
    });

    const aiData = aiResponse.data;

    // Xây đường dẫn relative để trả về frontend
    const relativePath = `uploads/faces/${req.file.filename}`;

    if (!aiData.is_valid) {
      // Xóa file tạm nếu không hợp lệ
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({
        status: 'error',
        code: aiData.error_code,
        message: aiData.message,
        sharpness_score: aiData.sharpness_score,
      });
    }

    res.json({
      status: 'success',
      message: aiData.message,
      data: {
        face_path: relativePath,
        sharpness_score: aiData.sharpness_score,
        embedding: aiData.embedding,
      },
    });
  } catch (err) {
    // Xóa file tạm nếu lỗi
    if (req.file) fs.unlink(req.file.path, () => {});
    const errMsg = err.response?.data?.detail || err.message;
    res.status(500).json({ status: 'error', message: `Lỗi AI Service: ${errMsg}` });
  }
});

// ─────────────────────────────────────────────
// POST /api/v1/students/profile
// Lưu hồ sơ sinh viên + face_profile vào DB
// Body JSON: { student_code, full_name, class_id, email, face_path, embedding }
// ─────────────────────────────────────────────
router.post('/profile', async (req, res) => {
  const { student_code, full_name, class_id, email, face_path, embedding } = req.body;

  if (!student_code || !full_name || !embedding) {
    return res.status(400).json({
      status: 'error',
      message: 'Thiếu thông tin bắt buộc: student_code, full_name, embedding',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert student
    const studentResult = await client.query(`
      INSERT INTO students (student_code, full_name, class_id, email, status)
      VALUES ($1, $2, $3, $4, 'active')
      ON CONFLICT (student_code) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        class_id  = EXCLUDED.class_id,
        email     = EXCLUDED.email
      RETURNING student_id, student_code
    `, [student_code.toUpperCase(), full_name, class_id, email || null]);

    const { student_id, student_code: code } = studentResult.rows[0];

    // Upsert face_profile
    const embeddingStr = `[${embedding.join(',')}]`;
    await client.query(`
      INSERT INTO face_profiles (student_id, image_path, embedding, model_name, quality_score)
      VALUES ($1, $2, $3::vector, 'w600k_mbf', 1.0)
      ON CONFLICT (student_id) DO UPDATE SET
        image_path    = EXCLUDED.image_path,
        embedding     = EXCLUDED.embedding,
        model_name    = EXCLUDED.model_name,
        quality_score = EXCLUDED.quality_score,
        updated_at    = NOW()
    `, [student_id, face_path || null, embeddingStr]);

    await client.query('COMMIT');

    res.json({
      status: 'success',
      message: 'Đã lưu hồ sơ và dữ liệu khuôn mặt thành công',
      data: { student_id, student_code: code },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ status: 'error', message: err.message });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────
// PUT /api/v1/students/:code
// Cập nhật thông tin sinh viên
// ─────────────────────────────────────────────
router.put('/:code', async (req, res) => {
  const { full_name, class_id, email, status } = req.body;
  try {
    const result = await pool.query(`
      UPDATE students SET
        full_name  = COALESCE($1, full_name),
        class_id   = COALESCE($2, class_id),
        email      = COALESCE($3, email),
        status     = COALESCE($4, status)
      WHERE student_code = $5
      RETURNING student_id, student_code, full_name
    `, [full_name, class_id, email, status, req.params.code.toUpperCase()]);

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy sinh viên.' });
    }
    res.json({ status: 'success', message: 'Cập nhật thành công', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

export default router;
