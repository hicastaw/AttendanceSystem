import express from 'express';
import axios from 'axios';
import FormData from 'form-data';
import pool from '../db.js';
import { uploadMemory } from '../upload.js';
import { ensureLecturerOwnsSection, ensureLecturerOwnsSession, getEffectiveStudentCode, requireRoles } from '../middleware/auth.js';

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

function normalizeAttendanceStatus(value) {
  const allowed = new Set(['early', 'on_time', 'late', 'absent']);
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.has(normalized) ? normalized : null;
}

router.get('/sections', requireRoles('admin', 'lecturer'), async (req, res) => {
  try {
    const params = [];
    let where = '';

    if (req.actor?.role === 'lecturer') {
      params.push(req.actor.lecturerCode);
      where = `WHERE l.lecturer_code = $${params.length}`;
    }

    const result = await pool.query(`
      SELECT 
        cs.section_id,
        co.course_name,
        co.course_code,
        cl.class_name,
        cl.class_code,
        l.full_name AS lecturer_name,
        l.lecturer_code,
        cs.schedule_note
      FROM course_sections cs
      JOIN courses co ON cs.course_id = co.course_id
      JOIN classes cl ON cs.class_id = cl.class_id
      JOIN lecturers l ON cs.lecturer_id = l.lecturer_id
      ${where}
      ORDER BY co.course_name, cl.class_name
    `, params);
    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.get('/open-sessions', requireRoles('admin', 'lecturer'), async (req, res) => {
  // Admin and lecturer can filter by student_code optionally
  const studentCode = req.query.student_code ? String(req.query.student_code).trim().toUpperCase() : null;

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

router.get('/sessions', requireRoles('admin', 'lecturer'), async (req, res) => {
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
        cl.class_code,
        l.lecturer_code,
        l.full_name AS lecturer_name
      FROM attendance_sessions att
      JOIN course_sections cs ON att.section_id = cs.section_id
      JOIN courses co ON cs.course_id = co.course_id
      JOIN classes cl ON cs.class_id = cl.class_id
      JOIN lecturers l ON l.lecturer_id = cs.lecturer_id
    `;
    const params = [];
    const where = [];
    if (section_id) {
      params.push(section_id);
      where.push(`att.section_id = $${params.length}`);
    }
    if (req.actor?.role === 'lecturer') {
      params.push(req.actor.lecturerCode);
      where.push(`l.lecturer_code = $${params.length}`);
    }
    if (where.length > 0) {
      query += ` WHERE ${where.join(' AND ')}`;
    }
    query += ' ORDER BY att.session_date DESC, att.start_time DESC';

    const result = await pool.query(query, params);
    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.post('/sessions', requireRoles('admin', 'lecturer'), ensureLecturerOwnsSection, async (req, res) => {
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

router.put('/sessions/:id/open', requireRoles('admin', 'lecturer'), ensureLecturerOwnsSession, async (req, res) => {
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

router.put('/sessions/:id/close', requireRoles('admin', 'lecturer'), ensureLecturerOwnsSession, async (req, res) => {
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

router.put('/sessions/:id/submit', requireRoles('admin', 'lecturer'), ensureLecturerOwnsSession, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM submit_attendance_session($1)',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy phiên điểm danh.' });
    }
    res.json({ status: 'success', message: 'Phiên điểm danh đã được chốt.', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.post('/global-sessions', requireRoles('admin'), async (req, res) => {
  const {
    start_time,
    end_time,
    late_after_minutes,
    section_ids,
    session_title,
    session_date,
    auto_open = true,
  } = req.body;

  if (!start_time || !end_time) {
    return res.status(400).json({ status: 'error', message: 'Thiếu start_time hoặc end_time' });
  }

  const normalizedSectionIds = Array.isArray(section_ids)
    ? [...new Set(section_ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
    : [];

  const effectiveDate = session_date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  const effectiveTitle = String(session_title || `General Session ${start_time}-${end_time}`).trim();
  const startTimestamp = `${effectiveDate} ${start_time}:00`;
  const endTimestamp = `${effectiveDate} ${end_time}:00`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sectionsResult = normalizedSectionIds.length > 0
      ? await client.query(
          'SELECT section_id FROM course_sections WHERE section_id = ANY($1::bigint[]) ORDER BY section_id',
          [normalizedSectionIds]
        )
      : await client.query('SELECT section_id FROM course_sections ORDER BY section_id');

    if (sectionsResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ status: 'error', message: 'Không có học phần nào để tạo phiên.' });
    }

    const createdSessions = [];

    for (const row of sectionsResult.rows) {
      const insertResult = await client.query(`
        INSERT INTO attendance_sessions
          (section_id, session_title, session_date, start_time, end_time, late_after_minutes, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'draft')
        ON CONFLICT (section_id, session_date, session_title)
        DO UPDATE SET
          start_time = EXCLUDED.start_time,
          end_time = EXCLUDED.end_time,
          late_after_minutes = EXCLUDED.late_after_minutes
        RETURNING *
      `, [row.section_id, effectiveTitle, effectiveDate, startTimestamp, endTimestamp, late_after_minutes || 15]);

      const session = insertResult.rows[0];
      if (auto_open && session?.session_id) {
        const opened = await client.query('SELECT * FROM open_attendance_session($1)', [session.session_id]);
        createdSessions.push(opened.rows[0]);
      } else {
        createdSessions.push(session);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({
      status: 'success',
      message: `Đã tạo ${createdSessions.length} phiên điểm danh.`,
      data: createdSessions,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ status: 'error', message: err.message });
  } finally {
    client.release();
  }
});

router.get('/sessions/:id/records', requireRoles('admin', 'lecturer'), ensureLecturerOwnsSession, async (req, res) => {
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

router.put('/sessions/:sessionId/records/:recordId/manual-override', requireRoles('admin', 'lecturer'), ensureLecturerOwnsSession, async (req, res) => {
  const { attendance_status, note, checkin_time, recognition_status } = req.body;
  const normalizedStatus = normalizeAttendanceStatus(attendance_status);

  if (!normalizedStatus) {
    return res.status(400).json({
      status: 'error',
      message: 'attendance_status phải là early, on_time, late hoặc absent.',
    });
  }

  try {
    const result = await pool.query(`
      UPDATE attendance_records ar
      SET
        attendance_status = $1,
        recognition_status = $2,
        is_manual_override = TRUE,
        note = $3,
        checkin_time = CASE
          WHEN $4::timestamp IS NOT NULL THEN $4::timestamp
          WHEN $1 = 'absent' THEN NULL
          ELSE COALESCE(ar.checkin_time, CURRENT_TIMESTAMP)
        END,
        updated_at = CURRENT_TIMESTAMP
      FROM attendance_sessions s
      WHERE ar.record_id = $5
        AND ar.session_id = $6
        AND s.session_id = ar.session_id
      RETURNING ar.*
    `, [
      normalizedStatus,
      recognition_status || 'manual_marked',
      note?.trim() || null,
      checkin_time || null,
      req.params.recordId,
      req.params.sessionId,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy bản ghi điểm danh.' });
    }

    res.json({
      status: 'success',
      message: 'Đã cập nhật điểm danh thủ công.',
      data: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.delete('/sessions/:sessionId/records/:recordId/manual-override', requireRoles('admin', 'lecturer'), ensureLecturerOwnsSession, async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE attendance_records ar
      SET
        is_manual_override = FALSE,
        note = NULL,
        recognition_status = CASE
          WHEN ar.checkin_time IS NULL THEN NULL
          WHEN COALESCE(ar.confidence_score, 0) < 60 THEN 'low_confidence'
          WHEN COALESCE(ar.sharpness_score, 0) <= 100 THEN 'blurry_rejected'
          ELSE 'matched'
        END,
        attendance_status = CASE
          WHEN ar.checkin_time IS NULL THEN 'absent'
          WHEN COALESCE(ar.confidence_score, 0) < 60 THEN 'absent'
          WHEN COALESCE(ar.sharpness_score, 0) <= 100 THEN 'absent'
          ELSE compute_attendance_status(ar.session_id, ar.checkin_time)
        END,
        updated_at = CURRENT_TIMESTAMP
      WHERE ar.record_id = $1
        AND ar.session_id = $2
      RETURNING ar.*
    `, [req.params.recordId, req.params.sessionId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy bản ghi điểm danh.' });
    }

    res.json({
      status: 'success',
      message: 'Đã hủy manual override.',
      data: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.get('/sessions/:id/export', requireRoles('admin', 'lecturer'), ensureLecturerOwnsSession, async (req, res) => {
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

router.post('/recognize', requireRoles('admin', 'lecturer'), uploadMemory.single('frame'), async (req, res) => {
  const { session_id } = req.body;
  // Admin/lecturer can optionally pass student_code to narrow down recognition
  const student_code = req.body?.student_code ? String(req.body.student_code).trim().toUpperCase() : null;

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

    // sửa backend trả về lỗi chi tiết hơn
    if (!aiData.found) {
      return res.json({
        status: 'no_face',
        message: aiData.message || 'Không phát hiện khuôn mặt.', 
        error_code: aiData.error_code, 
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

    // Generate checkin time in Vietnam timezone (YYYY-MM-DDTHH:mm:ss format)
    const vnCheckinTime = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).replace(' ', 'T');

    const upsertResult = await pool.query(
      'SELECT * FROM upsert_attendance_record($1, $2, $3, $4, $5, $6, $7)',
      [
        session.session_id,
        best.student_id,
        null,
        vnCheckinTime,
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
