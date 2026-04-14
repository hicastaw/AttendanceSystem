\echo '=== TABLES ==='
\dt

\echo '=== SESSIONS ==='
SELECT session_id, session_title, session_date, status
FROM attendance_sessions
ORDER BY session_id;

\echo '=== ATTENDANCE DETAIL ==='
SELECT session_id, session_title, student_code, student_name, recognition_status, attendance_status, is_manual_override
FROM vw_attendance_session_detail
ORDER BY session_id, student_code;

\echo '=== STUDENT SUMMARY ==='
SELECT section_id, course_code, student_code, total_sessions, total_present, total_absent, attendance_rate_percent
FROM vw_attendance_student_summary
ORDER BY section_id, student_code;

\echo '=== SECTION SUMMARY ==='
SELECT section_id, course_code, enrolled_students, total_sessions, overall_attendance_rate_percent
FROM vw_attendance_section_summary
ORDER BY section_id;
