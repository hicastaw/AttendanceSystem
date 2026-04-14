import express from 'express';
import axios from 'axios';
import FormData from 'form-data';
import pool from '../db.js';
import { uploadMemory } from '../upload.js';

const router = express.Router();
const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8001';

// ─────────────────────────────────────────────
// GET /api/v1/attendance/sections
// Lấy danh sách học phần (course_sections)
// ─────────────────────────────────────────────
router.get('/sections', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        cs.section_id,
        co.course_name,
        co.course_code,
        cl.class_name,
        l.full_name AS lecturer_name,
        cs.schedule_note
      FROM course_sections cs
      JOIN courses co ON cs.course_id = co.course_id
      JOIN classes cl ON cs.class_id = cl.class_id
      JOIN lecturers l ON cs.lecturer_id = l.lecturer_id
      ORDER BY co.course_name
    `);
    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/v1/attendance/sessions
// Lấy danh sách attendance sessions
// ─────────────────────────────────────────────
router.get('/sessions', async (req, res) => {
  try {
    const { section_id } = req.query;
    let query = `
      SELECT 
        att.session_id,
        att.section_id,
        att.session_title,
        att.session_date,
        att.start_time,
        att.end_time,
        att.late_after_minutes,
        att.status,
        co.course_name,
        cl.class_name
      FROM attendance_sessions att
      JOIN course_sections cs ON att.section_id = cs.section_id
      JOIN courses co ON cs.course_id = co.course_id
      JOIN classes cl ON cs.class_id = cl.class_id
    `;
    const params = [];
    if (section_id) {
      query += ' WHERE att.section_id = $1';
      params.push(section_id);
    }
    query += ' ORDER BY att.session_date DESC, att.start_time DESC';

    const result = await pool.query(query, params);
    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/v1/attendance/sessions
// Tạo phiên điểm danh mới (status = draft)
// ─────────────────────────────────────────────
router.post('/sessions', async (req, res) => {
  const { section_id, session_title, session_date, start_time, end_time, late_after_minutes } = req.body;

  if (!section_id || !session_title || !session_date || !start_time || !end_time) {
    return res.status(400).json({
      status: 'error',
      message: 'Thiếu thông tin: section_id, session_title, session_date, start_time, end_time',
    });
  }

  try {
    const result = await pool.query(`
      INSERT INTO attendance_sessions 
        (section_id, session_title, session_date, start_time, end_time, late_after_minutes, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'draft')
      RETURNING *
    `, [section_id, session_title, session_date, start_time, end_time, late_after_minutes || 15]);

    res.status(201).json({ status: 'success', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─────────────────────────────────────────────
// PUT /api/v1/attendance/sessions/:id/open
// Mở phiên điểm danh → gọi open_attendance_session()
// ─────────────────────────────────────────────
router.put('/sessions/:id/open', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM open_attendance_session($1)',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy phiên điểm danh.' });
    }
    res.json({ status: 'success', message: 'Phiên điểm danh đã được mở.', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─────────────────────────────────────────────
// PUT /api/v1/attendance/sessions/:id/close
// Đóng phiên điểm danh → gọi close_attendance_session()
// ─────────────────────────────────────────────
router.put('/sessions/:id/close', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM close_attendance_session($1)',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy phiên điểm danh.' });
    }
    res.json({ status: 'success', message: 'Phiên điểm danh đã được đóng.', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/v1/attendance/global-sessions
// ─────────────────────────────────────────────
router.post('/global-sessions', async (req, res) => {
  const { start_time, end_time, late_after_minutes } = req.body;
  if (!start_time || !end_time) {
    return res.status(400).json({ status: 'error', message: 'Thiếu start_time hoặc end_time' });
  }
  try {
    const d = new Date();
    // Lấy ngày chuẩn giờ Việt Nam (YYYY-MM-DD)
    const session_date = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }); 
    const session_title = `General Session ${d.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`;

    // Ghép ngày hiện tại với giờ (VD: "2026-04-15 07:00:00")
    const start_timestamp = `${session_date} ${start_time}:00`;
    const end_timestamp = `${session_date} ${end_time}:00`;

    const result = await pool.query(`
      INSERT INTO attendance_sessions 
        (section_id, session_title, session_date, start_time, end_time, late_after_minutes, status)
      VALUES (NULL, $1, $2, $3, $4, $5, 'draft')
      RETURNING *
    `, [session_title, session_date, start_timestamp, end_timestamp, late_after_minutes || 15]);

    const session_id = result.rows[0].session_id;

    // Auto open session
    const openResult = await pool.query('SELECT * FROM open_attendance_session($1)', [session_id]);
    res.status(201).json({ status: 'success', data: openResult.rows[0] });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/v1/attendance/sessions/:id/records
// Lấy danh sách điểm danh của một phiên
// ─────────────────────────────────────────────
router.get('/sessions/:id/records', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM vw_attendance_session_detail
      WHERE session_id = $1
      ORDER BY student_code
    `, [req.params.id]);
    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/v1/attendance/recognize
// Nhận frame từ camera → AI extract embedding → PG vector search → upsert record
// Body: multipart/form-data { frame: File, session_id: string }
// ─────────────────────────────────────────────
router.post('/recognize', uploadMemory.single('frame'), async (req, res) => {
  const { session_id } = req.body;

  if (!session_id) {
    return res.status(400).json({ status: 'error', message: 'Thiếu session_id.' });
  }
  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'Thiếu frame ảnh.' });
  }

  try {
    // 1. Kiểm tra session còn open không
    const sessionResult = await pool.query(
      "SELECT * FROM attendance_sessions WHERE session_id = $1 AND status = 'open'",
      [session_id]
    );
    if (sessionResult.rows.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Phiên điểm danh không tồn tại hoặc đã đóng.' });
    }
    const session = sessionResult.rows[0];

    // 2. Gửi frame sang AI Service để extract embedding
    const form = new FormData();
    form.append('face_image', req.file.buffer, {
      filename: 'frame.jpg',
      contentType: req.file.mimetype || 'image/jpeg',
    });

    const aiResponse = await axios.post(`${AI_URL}/ai/face/extract`, form, {
      headers: form.getHeaders(),
      timeout: 15000,
    });

    const aiData = aiResponse.data;

    if (!aiData.found) {
      return res.json({
        status: 'no_face',
        message: 'Không phát hiện khuôn mặt.',
        recognized: false,
      });
    }

    // 3. Vector search trong PostgreSQL để tìm sinh viên khớp nhất
    const embeddingStr = `[${aiData.embedding.join(',')}]`;
    const matchResult = await pool.query(`
      SELECT 
        s.student_id,
        s.student_code,
        s.full_name,
        1 - (fp.embedding <=> $1::vector) AS similarity
      FROM face_profiles fp
      JOIN students s ON fp.student_id = s.student_id
      WHERE s.status = 'active'
      ORDER BY fp.embedding <=> $1::vector
      LIMIT 1
    `, [embeddingStr]);

    if (matchResult.rows.length === 0) {
      return res.json({
        status: 'not_found',
        message: 'Không tìm thấy sinh viên trong hệ thống.',
        recognized: false,
      });
    }

    const match = matchResult.rows[0];
    const similarityPct = Math.round(match.similarity * 100);

    // Ngưỡng nhận diện: similarity >= 0.6 (60%)
    if (similarityPct < 60) {
      return res.json({
        status: 'not_found',
        message: `Không khớp (similarity: ${similarityPct}% < 60%)`,
        recognized: false,
        debug: { student_code: match.student_code, similarity: similarityPct },
      });
    }

    // 4. Gọi upsert_attendance_record() trong PostgreSQL
    const checkinTime = new Date().toISOString();
    const upsertResult = await pool.query(`
      SELECT * FROM upsert_attendance_record(
        $1,   -- p_session_id
        $2,   -- p_student_id
        NULL, -- p_image_path
        $3,   -- p_checkin_time
        $4,   -- p_confidence_score (0-100)
        $5,   -- p_sharpness_score
        'matched' -- p_recognition_status
      )
    `, [
      session_id,
      match.student_id,
      checkinTime,
      similarityPct,
      aiData.sharpness_score,
    ]);

    const record = upsertResult.rows[0];

    res.json({
      status: 'success',
      recognized: true,
      data: {
        student_code: match.student_code,
        full_name: match.full_name,
        similarity: similarityPct,
        sharpness_score: aiData.sharpness_score,
        attendance_status: record?.attendance_status || 'on_time',
        checkin_time: checkinTime,
      },
    });
  } catch (err) {
    const errMsg = err.response?.data?.detail || err.message;
    res.status(500).json({ status: 'error', message: errMsg });
  }
});

export default router;
