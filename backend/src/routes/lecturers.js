import { Router } from 'express';
import pool from '../db.js';
import { requireLecturerSelf, requireRoles } from '../middleware/auth.js';

const router = Router();

// GET /api/v1/lecturers — danh sách tất cả giảng viên
router.get('/', requireRoles('admin', 'lecturer'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT lecturer_id, lecturer_code, full_name, email FROM lecturers ORDER BY lecturer_id`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

// GET /api/v1/lecturers/:code — thông tin giảng viên theo mã
router.get('/:code', requireLecturerSelf('code'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT lecturer_id, lecturer_code, full_name, email FROM lecturers WHERE lecturer_code = $1`,
      [req.params.code.toUpperCase()]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy giảng viên' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

// PUT /api/v1/lecturers/:code — cập nhật tên và email giảng viên
router.put('/:code', requireLecturerSelf('code'), async (req, res) => {
  const { full_name, email } = req.body;
  if (!full_name || !full_name.trim()) {
    return res.status(400).json({ success: false, message: 'Họ tên không được để trống' });
  }
  try {
    const result = await pool.query(
      `UPDATE lecturers SET full_name = $1, email = $2 WHERE lecturer_code = $3 RETURNING lecturer_id, lecturer_code, full_name, email`,
      [full_name.trim(), email?.trim() || null, req.params.code.toUpperCase()]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy giảng viên' });
    }
    res.json({ success: true, data: result.rows[0], message: 'Cập nhật profile giáo viên thành công' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

// GET /api/v1/lecturers/:code/sections — các học phần giáo viên đang dạy
router.get('/:code/sections', requireLecturerSelf('code'), async (req, res) => {
  try {
    const lecturerRes = await pool.query(
      `SELECT lecturer_id FROM lecturers WHERE lecturer_code = $1`,
      [req.params.code.toUpperCase()]
    );
    if (lecturerRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy giảng viên' });
    }
    const lecturerId = lecturerRes.rows[0].lecturer_id;

    const result = await pool.query(`
      SELECT
        cs.section_id,
        co.course_id,
        co.course_code,
        co.course_name,
        cl.class_id,
        cl.class_code,
        cl.class_name,
        cs.schedule_note,
        COUNT(DISTINCT e.student_id)::INT AS enrolled_count,
        COUNT(DISTINCT att.session_id)::INT AS session_count
      FROM course_sections cs
      JOIN courses co ON cs.course_id = co.course_id
      JOIN classes cl ON cs.class_id = cl.class_id
      LEFT JOIN enrollments e ON e.section_id = cs.section_id
      LEFT JOIN attendance_sessions att ON att.section_id = cs.section_id
      WHERE cs.lecturer_id = $1
      GROUP BY cs.section_id, co.course_id, co.course_code, co.course_name, cl.class_id, cl.class_code, cl.class_name, cs.schedule_note
      ORDER BY co.course_name, cl.class_name
    `, [lecturerId]);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

// GET /api/v1/lecturers/:code/available-sections — học phần chưa có giáo viên dạy (có thể đăng ký)
router.get('/:code/available-sections', requireLecturerSelf('code'), async (req, res) => {
  try {
    const lecturerRes = await pool.query(
      `SELECT lecturer_id FROM lecturers WHERE lecturer_code = $1`,
      [req.params.code.toUpperCase()]
    );
    if (lecturerRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy giảng viên' });
    }
    const lecturerId = lecturerRes.rows[0].lecturer_id;

    // Lấy tất cả môn học + lớp, kèm giáo viên hiện tại (nếu có)
    const result = await pool.query(`
      SELECT
        cs.section_id,
        co.course_id,
        co.course_code,
        co.course_name,
        cl.class_id,
        cl.class_code,
        cl.class_name,
        cs.schedule_note,
        l.lecturer_id AS current_lecturer_id,
        l.lecturer_code AS current_lecturer_code,
        l.full_name AS current_lecturer_name,
        COUNT(DISTINCT e.student_id)::INT AS enrolled_count,
        CASE WHEN cs.lecturer_id = $1 THEN true ELSE false END AS is_mine
      FROM course_sections cs
      JOIN courses co ON cs.course_id = co.course_id
      JOIN classes cl ON cs.class_id = cl.class_id
      JOIN lecturers l ON cs.lecturer_id = l.lecturer_id
      LEFT JOIN enrollments e ON e.section_id = cs.section_id
      GROUP BY cs.section_id, co.course_id, co.course_code, co.course_name,
               cl.class_id, cl.class_code, cl.class_name, cs.schedule_note,
               l.lecturer_id, l.lecturer_code, l.full_name
      ORDER BY co.course_name, cl.class_name
    `, [lecturerId]);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

// POST /api/v1/lecturers/:code/sections — đăng ký dạy học phần (cập nhật lecturer_id)
router.post('/:code/sections', requireLecturerSelf('code'), async (req, res) => {
  const { section_id } = req.body;
  if (!section_id) {
    return res.status(400).json({ success: false, message: 'Thiếu section_id' });
  }
  try {
    const lecturerRes = await pool.query(
      `SELECT lecturer_id, full_name FROM lecturers WHERE lecturer_code = $1`,
      [req.params.code.toUpperCase()]
    );
    if (lecturerRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy giảng viên' });
    }
    const { lecturer_id, full_name } = lecturerRes.rows[0];

    // Kiểm tra học phần tồn tại
    const sectionRes = await pool.query(
      `SELECT section_id, lecturer_id FROM course_sections WHERE section_id = $1`,
      [section_id]
    );
    if (sectionRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy học phần' });
    }

    // Cập nhật giáo viên dạy học phần
    await pool.query(
      `UPDATE course_sections SET lecturer_id = $1 WHERE section_id = $2`,
      [lecturer_id, section_id]
    );

    res.json({ success: true, message: `Đã đăng ký ${full_name} dạy học phần này` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

// DELETE /api/v1/lecturers/:code/sections/:sectionId — rút khỏi học phần (chuyển về GV khác không được; chỉ reset sang GV mặc định hoặc từ chối nếu có session)
// Thực tế: không cho xóa nếu đã có phiên điểm danh, nếu không thì mới cho phép chuyển
router.delete('/:code/sections/:sectionId', requireLecturerSelf('code'), async (req, res) => {
  try {
    const lecturerRes = await pool.query(
      `SELECT lecturer_id FROM lecturers WHERE lecturer_code = $1`,
      [req.params.code.toUpperCase()]
    );
    if (lecturerRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy giảng viên' });
    }
    const lecturerId = lecturerRes.rows[0].lecturer_id;

    // Kiểm tra giáo viên có đang dạy học phần này không
    const sectionRes = await pool.query(
      `SELECT section_id FROM course_sections WHERE section_id = $1 AND lecturer_id = $2`,
      [req.params.sectionId, lecturerId]
    );
    if (sectionRes.rows.length === 0) {
      return res.status(403).json({ success: false, message: 'Bạn không phụ trách học phần này' });
    }

    // Kiểm tra có phiên điểm danh nào không
    const sessionRes = await pool.query(
      `SELECT COUNT(*) FROM attendance_sessions WHERE section_id = $1`,
      [req.params.sectionId]
    );
    if (parseInt(sessionRes.rows[0].count) > 0) {
      return res.status(400).json({
        success: false,
        message: 'Không thể rút khỏi học phần này vì đã có phiên điểm danh. Hãy liên hệ quản trị viên.'
      });
    }

    // Xác nhận: không xóa học phần, chỉ trả về lỗi (giữ nguyên giáo viên) 
    // Thực tế production cần có cơ chế gán GV khác — ở đây báo lỗi an toàn
    return res.status(400).json({
      success: false,
      message: 'Chức năng rút khỏi học phần cần được thực hiện qua quản trị viên hệ thống.'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

export default router;

