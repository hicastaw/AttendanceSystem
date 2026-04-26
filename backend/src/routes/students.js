import express from 'express';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import pool from '../db.js';
import { upload } from '../upload.js';
import { getEffectiveStudentCode, requireRoles, requireStudentSelf, requireStudentSelfOrStaff } from '../middleware/auth.js';

const router = express.Router();
const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8001';

router.get('/classes', requireRoles('admin', 'lecturer', 'student'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT class_id, class_name, class_code FROM classes ORDER BY class_name'
    );
    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.get('/course-sections', requireRoles('admin', 'lecturer', 'student'), async (req, res) => {
  try {
    const { class_id } = req.query;
    const params = [];
    let where = '';
    if (class_id) {
      params.push(class_id);
      where = `WHERE cs.class_id = $${params.length}`;
    }

    const result = await pool.query(`
      SELECT
        cs.section_id,
        cs.class_id,
        co.course_code,
        co.course_name,
        cl.class_code,
        cl.class_name,
        l.full_name AS lecturer_name,
        cs.schedule_note,
        COUNT(e.student_id)::int AS enrolled_count
      FROM course_sections cs
      JOIN courses co ON cs.course_id = co.course_id
      JOIN classes cl ON cs.class_id = cl.class_id
      JOIN lecturers l ON cs.lecturer_id = l.lecturer_id
      LEFT JOIN enrollments e ON e.section_id = cs.section_id
      ${where}
      GROUP BY cs.section_id, cs.class_id, co.course_code, co.course_name, cl.class_code, cl.class_name, l.full_name, cs.schedule_note
      ORDER BY cl.class_name, co.course_name, cs.schedule_note
    `, params);

    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.get('/', requireRoles('admin', 'lecturer'), async (req, res) => {
  try {
    const params = [];
    let where = '';

    if (req.actor?.role === 'lecturer') {
      params.push(req.actor.lecturerCode);
      where = `WHERE cs.lecturer_id IN (SELECT lecturer_id FROM lecturers WHERE lecturer_code = $${params.length})`;
    }

    const result = await pool.query(`
      SELECT
        s.student_id,
        s.student_code,
        s.full_name,
        s.email,
        s.status,
        c.class_name,
        c.class_code,
        c.class_id,
        fp.image_path,
        fp.quality_score,
        fp.model_name,
        fp.updated_at AS face_updated_at,
        CASE WHEN fp.student_id IS NOT NULL THEN true ELSE false END AS has_face_profile,
        COUNT(DISTINCT e.section_id)::int AS enrolled_section_count,
        COALESCE(
          STRING_AGG(DISTINCT co.course_code || ' - ' || co.course_name, ' | ') FILTER (WHERE co.course_id IS NOT NULL),
          ''
        ) AS enrolled_courses_summary
      FROM students s
      JOIN classes c ON s.class_id = c.class_id
      LEFT JOIN face_profiles fp ON fp.student_id = s.student_id
      LEFT JOIN enrollments e ON e.student_id = s.student_id
      LEFT JOIN course_sections cs ON e.section_id = cs.section_id
      LEFT JOIN courses co ON cs.course_id = co.course_id
      ${where}
      GROUP BY s.student_id, s.student_code, s.full_name, s.email, s.status, c.class_name, c.class_code, c.class_id, fp.image_path, fp.quality_score, fp.model_name, fp.updated_at, fp.student_id
      ORDER BY s.student_code
    `, params);
    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.get('/:code', requireRoles('admin', 'lecturer', 'student'), requireStudentSelfOrStaff('code'), async (req, res) => {
  try {
    const studentResult = await pool.query(`
      SELECT
        s.student_id,
        s.student_code,
        s.full_name,
        s.email,
        s.status,
        c.class_name,
        c.class_code,
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

    if (studentResult.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy sinh viên.' });
    }

    const student = studentResult.rows[0];

    if (req.actor?.role === 'lecturer') {
      const accessResult = await pool.query(`
        SELECT 1
        FROM enrollments e
        JOIN course_sections cs ON cs.section_id = e.section_id
        JOIN lecturers l ON l.lecturer_id = cs.lecturer_id
        WHERE e.student_id = $1 AND l.lecturer_code = $2
        LIMIT 1
      `, [student.student_id, req.actor.lecturerCode]);

      if (accessResult.rows.length === 0) {
        return res.status(403).json({ status: 'error', message: 'Bạn không có quyền xem hồ sơ sinh viên này.' });
      }
    }

    const sectionsResult = await pool.query(`
      SELECT
        e.section_id,
        co.course_code,
        co.course_name,
        cl.class_code,
        cl.class_name,
        l.full_name AS lecturer_name,
        cs.schedule_note
      FROM enrollments e
      JOIN course_sections cs ON e.section_id = cs.section_id
      JOIN courses co ON cs.course_id = co.course_id
      JOIN classes cl ON cs.class_id = cl.class_id
      JOIN lecturers l ON cs.lecturer_id = l.lecturer_id
      WHERE e.student_id = $1
      ORDER BY co.course_name, cs.schedule_note
    `, [student.student_id]);

    res.json({
      status: 'success',
      data: {
        ...student,
        enrolled_sections: sectionsResult.rows,
        enrollment_section_ids: sectionsResult.rows.map((row) => row.section_id),
      },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.post('/face/validate', requireRoles('admin', 'student'), upload.single('face_image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'Thiếu file ảnh.' });
  }

  try {
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
    const relativePath = `uploads/faces/${req.file.filename}`;

    if (!aiData.is_valid) {
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
    if (req.file) fs.unlink(req.file.path, () => {});
    const errMsg = err.response?.data?.detail || err.message;
    res.status(500).json({ status: 'error', message: `Lỗi AI Service: ${errMsg}` });
  }
});

router.post('/profile', requireRoles('admin', 'student'), async (req, res) => {
  const { student_code, full_name, class_id, email, face_path, embedding, enrollment_section_ids } = req.body;
  const effectiveStudent = getEffectiveStudentCode(req, student_code);
  if (effectiveStudent.error) {
    return res.status(effectiveStudent.error.status).json({ status: 'error', message: effectiveStudent.error.message });
  }

  if (!effectiveStudent.studentCode || !full_name || !class_id) {
    return res.status(400).json({
      status: 'error',
      message: 'Thiếu thông tin bắt buộc: student_code, full_name, class_id',
    });
  }

  const normalizedSectionIds = Array.isArray(enrollment_section_ids)
    ? [...new Set(enrollment_section_ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
    : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const studentResult = await client.query(`
      INSERT INTO students (student_code, full_name, class_id, email, status)
      VALUES ($1, $2, $3, $4, 'active')
      ON CONFLICT (student_code) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        class_id  = EXCLUDED.class_id,
        email     = EXCLUDED.email
      RETURNING student_id, student_code, class_id
    `, [effectiveStudent.studentCode.toUpperCase(), full_name, class_id, email || null]);

    const { student_id, student_code: code, class_id: resolvedClassId } = studentResult.rows[0];

    if (Array.isArray(embedding) && embedding.length > 0) {
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
    } else {
      const existingFace = await client.query(
        'SELECT face_profile_id FROM face_profiles WHERE student_id = $1 LIMIT 1',
        [student_id]
      );
      if (existingFace.rows.length === 0) {
        throw new Error('Sinh viên chưa có hồ sơ khuôn mặt. Hãy upload và xác thực ảnh trước khi lưu.');
      }
    }

    if (normalizedSectionIds.length > 0) {
      const validSections = await client.query(`
        SELECT section_id
        FROM course_sections
        WHERE class_id = $1 AND section_id = ANY($2::bigint[])
      `, [resolvedClassId, normalizedSectionIds]);

      if (validSections.rows.length !== normalizedSectionIds.length) {
        throw new Error('Có học phần không thuộc lớp hành chính đã chọn.');
      }
    }

    await client.query('DELETE FROM enrollments WHERE student_id = $1', [student_id]);

    if (normalizedSectionIds.length > 0) {
      await client.query(`
        INSERT INTO enrollments (section_id, student_id)
        SELECT section_id, $1
        FROM UNNEST($2::bigint[]) AS section_id
        ON CONFLICT (section_id, student_id) DO NOTHING
      `, [student_id, normalizedSectionIds]);
    }

    await client.query('COMMIT');

    res.json({
      status: 'success',
      message: 'Đã lưu hồ sơ, khuôn mặt và đăng ký học phần thành công',
      data: {
        student_id,
        student_code: code,
        enrollment_section_ids: normalizedSectionIds,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ status: 'error', message: err.message });
  } finally {
    client.release();
  }
});

router.put('/:code', requireRoles('admin', 'student'), requireStudentSelf('code'), async (req, res) => {
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
