import express from 'express';
import axios from 'axios';
import FormData from 'form-data';
import pool from '../db.js';
import { uploadMemory } from '../upload.js';

const router = express.Router();
const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8001';

function escapeCsv(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(rows, headers) {
  const headerLine = headers.map((h) => escapeCsv(h.label)).join(',');
  const lines = rows.map((row) => headers.map((h) => escapeCsv(row[h.key])).join(','));
  return [headerLine, ...lines].join('\n');
}

router.get('/sections', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        cs.section_id,
        co.course_name,
        co.course_code,
        cl.class_name,
        cl.class_code,
        l.full_name AS lecturer_name,
        cs.schedule_note
      FROM course_sections cs
      JOIN courses co ON cs.course_id = co.course_id
      JOIN classes cl ON cs.class_id = cl.class_id
      JOIN lecturers l ON cs.lecturer_id = l.lecturer_id
      ORDER BY co.course_name, cl.class_name
    `);
    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.get('/open-sessions', async (req, res) => {
  const studentCode = req.query.student_code?.trim().toUpperCase() || null;

  try {
    const params = [];
    let studentJoin = 'LEFT JOIN students st ON 1 = 0';
    let enrollmentJoin = 'LEFT JOIN enrollments e ON 1 = 0';
    let recordJoin = 'LEFT JOIN attendance_records ar ON 1 = 0';

    if (studentCode) {
      params.push(studentCode);
      studentJoin = `LEFT JOIN students st ON st.student_code = $${params.length} AND st.status = 'active'`;
      enrollmentJoin = 'LEFT JOIN enrollments e ON e.section_id = cs.section_id AND e.student_id = st.student_id';
      recordJoin = 'LEFT JOIN attendance_records ar ON ar.session_id = att.session_id AND ar.student_id = st.student_id';
    }

    const result = await pool.query(`
      SELECT 
        att.session_id,
        att.section_id,
        att.session_title,
        att.session_date,
        att.start_time,
        att.end_time,
        att.late_after_minutes,
        att.status,
        co.course_code,
        co.course_name,
        cl.class_code,
        cl.class_name,
        l.full_name AS lecturer_name,
        cs.schedule_note,
        CASE WHEN st.student_id IS NOT NULL THEN true ELSE false END AS student_found,
        CASE WHEN e.student_id IS NOT NULL THEN true ELSE false END AS is_enrolled,
        ar.attendance_status AS current_attendance_status,
        ar.checkin_time AS current_checkin_time
      FROM attendance_sessions att
      JOIN course_sections cs ON att.section_id = cs.section_id
      JOIN courses co ON cs.course_id = co.course_id
      JOIN classes cl ON cs.class_id = cl.class_id
      JOIN lecturers l ON cs.lecturer_id = l.lecturer_id
      ${studentJoin}
      ${enrollmentJoin}
      ${recordJoin}
      WHERE att.status = 'open'
      ORDER BY att.session_date DESC, att.start_time DESC, co.course_name, cl.class_name
    `, params);

    res.json({
      status: 'success',
      data: result.rows,
      meta: {
        student_code: studentCode,
        total: result.rows.length,
      },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

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
        co.course_code,
        cl.class_name,
        cl.class_code
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

router.post('/global-sessions', async (req, res) => {
  const { start_time, end_time, late_after_minutes } = req.body;
  if (!start_time || !end_time) {
    return res.status(400).json({ status: 'error', message: 'Thiếu start_time hoặc end_time' });
  }
  try {
    const d = new Date();
    const session_date = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    const session_title = `General Session ${d.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`;
    const start_timestamp = `${session_date} ${start_time}:00`;
    const end_timestamp = `${session_date} ${end_time}:00`;

    const result = await pool.query(`
      INSERT INTO attendance_sessions 
        (section_id, session_title, session_date, start_time, end_time, late_after_minutes, status)
      VALUES (NULL, $1, $2, $3, $4, $5, 'draft')
      RETURNING *
    `, [session_title, session_date, start_timestamp, end_timestamp, late_after_minutes || 15]);

    const session_id = result.rows[0].session_id;
    const openResult = await pool.query('SELECT * FROM open_attendance_session($1)', [session_id]);
    res.status(201).json({ status: 'success', data: openResult.rows[0] });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

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

router.get('/sessions/:id/export', async (req, res) => {
  try {
    const sessionId = req.params.id;

    const sessionResult = await pool.query(`
      SELECT 
        att.session_id,
        att.session_title,
        att.session_date,
        att.start_time,
        att.end_time,
        att.late_after_minutes,
        att.status,
        co.course_code,
        co.course_name,
        cl.class_code,
        cl.class_name,
        l.full_name AS lecturer_name
      FROM attendance_sessions att
      JOIN course_sections cs ON att.section_id = cs.section_id
      JOIN courses co ON cs.course_id = co.course_id
      JOIN classes cl ON cs.class_id = cl.class_id
      JOIN lecturers l ON cs.lecturer_id = l.lecturer_id
      WHERE att.session_id = $1
      LIMIT 1
    `, [sessionId]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy phiên điểm danh.' });
    }

    const session = sessionResult.rows[0];

    const recordsResult = await pool.query(`
      SELECT 
        student_code,
        student_name,
        class_code,
        class_name,
        attendance_status,
        recognition_status,
        confidence_score,
        sharpness_score,
        checkin_time,
        note
      FROM vw_attendance_session_detail
      WHERE session_id = $1
      ORDER BY student_code
    `, [sessionId]);

    const headers = [
      { key: 'stt', label: 'STT' },
      { key: 'session_id', label: 'Ma phien' },
      { key: 'session_title', label: 'Ten phien' },
      { key: 'session_date', label: 'Ngay hoc' },
      { key: 'course_code', label: 'Ma mon' },
      { key: 'course_name', label: 'Ten mon' },
      { key: 'class_code', label: 'Ma lop' },
      { key: 'class_name', label: 'Ten lop' },
      { key: 'lecturer_name', label: 'Giang vien' },
      { key: 'student_code', label: 'Ma sinh vien' },
      { key: 'student_name', label: 'Ho ten' },
      { key: 'attendance_status', label: 'Trang thai diem danh' },
      { key: 'recognition_status', label: 'Nhan dien' },
      { key: 'confidence_score', label: 'Do tin cay' },
      { key: 'sharpness_score', label: 'Do sac net' },
      { key: 'checkin_time', label: 'Thoi gian check in' },
      { key: 'note', label: 'Ghi chu' },
    ];

    const rows = recordsResult.rows.map((row, index) => ({
      stt: index + 1,
      session_id: session.session_id,
      session_title: session.session_title,
      session_date: session.session_date,
      course_code: session.course_code,
      course_name: session.course_name,
      class_code: row.class_code || session.class_code,
      class_name: row.class_name || session.class_name,
      lecturer_name: session.lecturer_name,
      student_code: row.student_code,
      student_name: row.student_name,
      attendance_status: row.attendance_status,
      recognition_status: row.recognition_status,
      confidence_score: row.confidence_score,
      sharpness_score: row.sharpness_score,
      checkin_time: row.checkin_time ? new Date(row.checkin_time).toLocaleString('vi-VN') : '',
      note: row.note || '',
    }));

    const csv = toCsv(rows, headers);
    const safeName = String(session.session_title || `session_${sessionId}`)
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/_+/g, '_');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${safeName}.csv`);
    res.send(`\uFEFF${csv}`);
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.post('/recognize', uploadMemory.single('frame'), async (req, res) => {
  const { session_id, student_code } = req.body;

  if (!session_id) {
    return res.status(400).json({ status: 'error', message: 'Thiếu session_id.' });
  }
  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'Thiếu frame ảnh.' });
  }

  try {
    const sessionResult = await pool.query(`
      SELECT 
        att.session_id,
        att.section_id,
        att.status,
        att.session_title,
        co.course_name,
        cl.class_name
      FROM attendance_sessions att
      JOIN course_sections cs ON cs.section_id = att.section_id
      JOIN courses co ON co.course_id = cs.course_id
      JOIN classes cl ON cl.class_id = cs.class_id
      WHERE att.session_id = $1 AND att.status = 'open'
    `, [session_id]);

    if (sessionResult.rows.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Phiên điểm danh không tồn tại hoặc đã đóng.' });
    }
    const session = sessionResult.rows[0];

    let expectedStudentId = null;
    let expectedStudentCode = null;
    if (student_code?.trim()) {
      const studentResult = await pool.query(
        `SELECT student_id, student_code, full_name FROM students WHERE student_code = $1 AND status = 'active' LIMIT 1`,
        [student_code.trim().toUpperCase()]
      );
      if (studentResult.rows.length === 0) {
        return res.status(404).json({ status: 'error', message: 'Không tìm thấy mã sinh viên trong hệ thống.' });
      }
      expectedStudentId = studentResult.rows[0].student_id;
      expectedStudentCode = studentResult.rows[0].student_code;

      const enrollmentResult = await pool.query(
        `SELECT 1 FROM enrollments WHERE section_id = $1 AND student_id = $2 LIMIT 1`,
        [session.section_id, expectedStudentId]
      );
      if (enrollmentResult.rows.length === 0) {
        return res.status(403).json({
          status: 'error',
          message: `Sinh viên ${expectedStudentCode} không thuộc lớp/học phần của phiên này.`,
        });
      }
    }

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

    const embeddingStr = `[${aiData.embedding.join(',')}]`;
    const params = [embeddingStr, session.section_id];
    let matchFilter = '';

    if (expectedStudentId) {
      params.push(expectedStudentId);
      matchFilter = ` AND s.student_id = $${params.length}`;
    }

    const matchResult = await pool.query(`
      SELECT 
        s.student_id,
        s.student_code,
        s.full_name,
        1 - (fp.embedding <=> $1::vector) AS similarity
      FROM face_profiles fp
      JOIN students s ON fp.student_id = s.student_id
      JOIN enrollments e ON e.student_id = s.student_id AND e.section_id = $2
      WHERE s.status = 'active'
      ${matchFilter}
      ORDER BY fp.embedding <=> $1::vector
      LIMIT 1
    `, params);

    if (matchResult.rows.length === 0) {
      return res.json({
        status: 'not_found',
        message: 'Không tìm thấy sinh viên hợp lệ trong phiên điểm danh này.',
        recognized: false,
      });
    }

    const best = matchResult.rows[0];
    const similarityPercent = Math.round(best.similarity * 10000) / 100;

    if (similarityPercent < 60) {
      return res.json({
        status: 'low_confidence',
        message: 'Độ tương đồng thấp, không xác nhận được danh tính.',
        recognized: false,
        similarity: similarityPercent,
      });
    }

    const upsertResult = await pool.query(
      'SELECT * FROM upsert_attendance_record($1, $2, $3, $4, $5, $6, $7)',
      [
        session.session_id,
        best.student_id,
        null,
        new Date().toISOString(),
        similarityPercent,
        aiData.sharpness_score || null,
        'matched',
      ]
    );

    const record = upsertResult.rows[0];

    return res.json({
      status: 'success',
      recognized: true,
      data: {
        session_id: session.session_id,
        session_title: session.session_title,
        course_name: session.course_name,
        class_name: session.class_name,
        student_id: best.student_id,
        student_code: best.student_code,
        full_name: best.full_name,
        similarity: similarityPercent,
        sharpness_score: aiData.sharpness_score || null,
        attendance_status: record.attendance_status,
        recognition_status: record.recognition_status,
        checkin_time: record.checkin_time,
      },
    });
  } catch (err) {
    const msg = err.response?.data?.detail || err.message;
    return res.status(500).json({ status: 'error', message: msg });
  }
});

export default router;
