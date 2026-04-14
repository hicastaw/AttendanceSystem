CREATE INDEX IF NOT EXISTS idx_students_class_id
    ON students(class_id);

CREATE INDEX IF NOT EXISTS idx_face_profiles_student_id
    ON face_profiles(student_id);

CREATE INDEX IF NOT EXISTS idx_course_sections_course_id
    ON course_sections(course_id);

CREATE INDEX IF NOT EXISTS idx_course_sections_class_id
    ON course_sections(class_id);

CREATE INDEX IF NOT EXISTS idx_course_sections_lecturer_id
    ON course_sections(lecturer_id);

CREATE INDEX IF NOT EXISTS idx_enrollments_section_id
    ON enrollments(section_id);

CREATE INDEX IF NOT EXISTS idx_enrollments_student_id
    ON enrollments(student_id);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_section_id
    ON attendance_sessions(section_id);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_date
    ON attendance_sessions(session_date);

CREATE INDEX IF NOT EXISTS idx_attendance_records_session_id
    ON attendance_records(session_id);

CREATE INDEX IF NOT EXISTS idx_attendance_records_student_id
    ON attendance_records(student_id);

CREATE INDEX IF NOT EXISTS idx_attendance_records_checkin_time
    ON attendance_records(checkin_time);

CREATE INDEX IF NOT EXISTS idx_attendance_records_status
    ON attendance_records(attendance_status);

CREATE INDEX IF NOT EXISTS idx_face_profiles_embedding_hnsw
    ON face_profiles USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE VIEW vw_attendance_session_detail AS
SELECT
    s.session_id,
    s.session_title,
    s.session_date,
    s.start_time,
    s.end_time,
    s.status AS session_status,
    cs.section_id,
    c.course_code,
    c.course_name,
    cl.class_code,
    cl.class_name,
    l.lecturer_code,
    l.full_name AS lecturer_name,
    st.student_id,
    st.student_code,
    st.full_name AS student_name,
    ar.record_id,
    ar.checkin_image_path,
    ar.checkin_time,
    ar.confidence_score,
    ar.sharpness_score,
    ar.recognition_status,
    ar.attendance_status,
    ar.is_manual_override,
    ar.note,
    ar.updated_at
FROM attendance_sessions s
JOIN course_sections cs ON cs.section_id = s.section_id
JOIN courses c ON c.course_id = cs.course_id
JOIN classes cl ON cl.class_id = cs.class_id
JOIN lecturers l ON l.lecturer_id = cs.lecturer_id
JOIN attendance_records ar ON ar.session_id = s.session_id
JOIN students st ON st.student_id = ar.student_id;

CREATE OR REPLACE VIEW vw_attendance_student_summary AS
SELECT
    cs.section_id,
    c.course_code,
    c.course_name,
    st.student_id,
    st.student_code,
    st.full_name AS student_name,
    COUNT(ar.record_id) AS total_sessions,
    COUNT(*) FILTER (WHERE ar.attendance_status IN ('early', 'on_time', 'late')) AS total_present,
    COUNT(*) FILTER (WHERE ar.attendance_status = 'early') AS total_early,
    COUNT(*) FILTER (WHERE ar.attendance_status = 'on_time') AS total_on_time,
    COUNT(*) FILTER (WHERE ar.attendance_status = 'late') AS total_late,
    COUNT(*) FILTER (WHERE ar.attendance_status = 'absent') AS total_absent,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE ar.attendance_status IN ('early', 'on_time', 'late'))
        / NULLIF(COUNT(ar.record_id), 0),
        2
    ) AS attendance_rate_percent
FROM attendance_records ar
JOIN attendance_sessions s ON s.session_id = ar.session_id
JOIN course_sections cs ON cs.section_id = s.section_id
JOIN courses c ON c.course_id = cs.course_id
JOIN students st ON st.student_id = ar.student_id
GROUP BY cs.section_id, c.course_code, c.course_name, st.student_id, st.student_code, st.full_name;

CREATE OR REPLACE VIEW vw_attendance_section_summary AS
SELECT
    cs.section_id,
    c.course_code,
    c.course_name,
    cl.class_code,
    cl.class_name,
    l.full_name AS lecturer_name,
    COUNT(DISTINCT e.student_id) AS enrolled_students,
    COUNT(DISTINCT s.session_id) AS total_sessions,
    COUNT(ar.record_id) FILTER (WHERE ar.attendance_status IN ('early', 'on_time', 'late')) AS total_present_records,
    COUNT(ar.record_id) FILTER (WHERE ar.attendance_status = 'absent') AS total_absent_records,
    ROUND(
        100.0 * COUNT(ar.record_id) FILTER (WHERE ar.attendance_status IN ('early', 'on_time', 'late'))
        / NULLIF(COUNT(ar.record_id), 0),
        2
    ) AS overall_attendance_rate_percent
FROM course_sections cs
JOIN courses c ON c.course_id = cs.course_id
JOIN classes cl ON cl.class_id = cs.class_id
JOIN lecturers l ON l.lecturer_id = cs.lecturer_id
LEFT JOIN enrollments e ON e.section_id = cs.section_id
LEFT JOIN attendance_sessions s ON s.section_id = cs.section_id
LEFT JOIN attendance_records ar ON ar.session_id = s.session_id
GROUP BY cs.section_id, c.course_code, c.course_name, cl.class_code, cl.class_name, l.full_name;
