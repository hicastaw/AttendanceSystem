-- Seed du lieu demo quy mo lon cho he thong diem danh
-- Tu dong tao: 8 lop, 10 mon, 8 giang vien, 160 sinh vien, 16 hoc phan, 64 phien diem danh

TRUNCATE TABLE attendance_records RESTART IDENTITY CASCADE;
TRUNCATE TABLE attendance_sessions RESTART IDENTITY CASCADE;
TRUNCATE TABLE enrollments RESTART IDENTITY CASCADE;
TRUNCATE TABLE face_profiles RESTART IDENTITY CASCADE;
TRUNCATE TABLE course_sections RESTART IDENTITY CASCADE;
TRUNCATE TABLE students RESTART IDENTITY CASCADE;
TRUNCATE TABLE lecturers RESTART IDENTITY CASCADE;
TRUNCATE TABLE courses RESTART IDENTITY CASCADE;
TRUNCATE TABLE classes RESTART IDENTITY CASCADE;

INSERT INTO classes (class_code, class_name) VALUES
    ('DHKTPM18A', 'Dai hoc Ky thuat Phan mem 18A'),
    ('DHKTPM18B', 'Dai hoc Ky thuat Phan mem 18B'),
    ('DHKTPM18C', 'Dai hoc Ky thuat Phan mem 18C'),
    ('DHHTTT18A', 'Dai hoc He thong Thong tin 18A'),
    ('DHHTTT18B', 'Dai hoc He thong Thong tin 18B'),
    ('DHKHMT18A', 'Dai hoc Khoa hoc May tinh 18A'),
    ('DHKHDL18A', 'Dai hoc Khoa hoc Du lieu 18A'),
    ('DHMANG18A', 'Dai hoc Mang may tinh 18A');

INSERT INTO courses (course_code, course_name) VALUES
    ('CSDL001', 'Co so du lieu'),
    ('LTW001', 'Lap trinh Web'),
    ('AI001', 'Tri tue nhan tao'),
    ('CNPM001', 'Cong nghe phan mem'),
    ('MMT001', 'Mang may tinh'),
    ('PTTK001', 'Phan tich thiet ke he thong'),
    ('KTDL001', 'Khai thac du lieu'),
    ('TTNT002', 'Thi giac may tinh'),
    ('LTJAVA01', 'Lap trinh Java nang cao'),
    ('ATTT001', 'An toan thong tin');

INSERT INTO lecturers (lecturer_code, full_name, email) VALUES
    ('GV001', 'Nguyen Van An', 'an.nguyen@university.edu.vn'),
    ('GV002', 'Tran Thi Bich', 'bich.tran@university.edu.vn'),
    ('GV003', 'Le Hoang Minh', 'minh.le@university.edu.vn'),
    ('GV004', 'Pham Quoc Dat', 'dat.pham@university.edu.vn'),
    ('GV005', 'Do Thu Ha', 'ha.do@university.edu.vn'),
    ('GV006', 'Vo Quoc Hung', 'hung.vo@university.edu.vn'),
    ('GV007', 'Dang Thu Trang', 'trang.dang@university.edu.vn'),
    ('GV008', 'Bui Thanh Son', 'son.bui@university.edu.vn');


CREATE OR REPLACE FUNCTION make_demo_embedding(p_seed INT)
RETURNS VECTOR(512)
LANGUAGE plpgsql
AS $$
DECLARE
    v_text TEXT := '[';
    i INT;
    v_value NUMERIC(6,3);
BEGIN
    FOR i IN 1..512 LOOP
        v_value := ((p_seed * 37 + i * 17) % 1000) / 1000.0;
        v_text := v_text || to_char(v_value, 'FM0.000');
        IF i < 512 THEN
            v_text := v_text || ',';
        END IF;
    END LOOP;
    v_text := v_text || ']';
    RETURN v_text::VECTOR(512);
END;
$$;

DO $$
DECLARE
    first_names TEXT[] := ARRAY['Nguyen','Tran','Le','Pham','Hoang','Vo','Dang','Bui','Do','Truong'];
    middle_names TEXT[] := ARRAY['Gia','Minh','Thanh','Quoc','Bao','Thuy','Ngoc','Anh','Khanh','Tien','Duc','Lan'];
    last_names TEXT[] := ARRAY['An','Binh','Chau','Dung','Giang','Ha','Huy','Khang','Linh','Mai','Nam','Phuong','Quan','Son','Trang','Vy'];
    class_codes TEXT[] := ARRAY['DHKTPM18A','DHKTPM18B','DHKTPM18C','DHHTTT18A','DHHTTT18B','DHKHMT18A','DHKHDL18A','DHMANG18A'];
    idx INT := 1;
    class_idx INT;
    student_idx INT;
    v_student_code TEXT;
    v_full_name TEXT;
    v_class_id BIGINT;
    v_status TEXT;
BEGIN
    FOR class_idx IN 1..array_length(class_codes, 1) LOOP
        SELECT class_id INTO v_class_id FROM classes WHERE class_code = class_codes[class_idx];
        FOR student_idx IN 1..20 LOOP
            v_student_code := 'SV' || lpad(idx::TEXT, 4, '0');
            v_full_name := first_names[((idx - 1) % array_length(first_names,1)) + 1]
                || ' ' || middle_names[((idx + class_idx - 2) % array_length(middle_names,1)) + 1]
                || ' ' || last_names[((idx + student_idx - 2) % array_length(last_names,1)) + 1];
            v_status := CASE WHEN idx % 17 = 0 THEN 'inactive' ELSE 'active' END;

            INSERT INTO students (student_code, full_name, class_id, email, status)
            VALUES (
                v_student_code,
                v_full_name,
                v_class_id,
                lower(v_student_code) || '@student.university.edu.vn',
                v_status
            );

            IF idx % 6 NOT IN (0, 5) THEN
                INSERT INTO face_profiles (student_id, image_path, embedding, model_name, quality_score)
                VALUES (
                    (SELECT student_id FROM students WHERE student_code = v_student_code),
                    'uploads/faces/' || v_student_code || '.jpg',
                    make_demo_embedding(idx),
                    'insightface',
                    72 + (idx % 24)
                );
            END IF;

            idx := idx + 1;
        END LOOP;
    END LOOP;
END;
$$;

INSERT INTO course_sections (course_id, class_id, lecturer_id, schedule_note)
VALUES
    ((SELECT course_id FROM courses WHERE course_code = 'CSDL001'), (SELECT class_id FROM classes WHERE class_code = 'DHKTPM18A'), (SELECT lecturer_id FROM lecturers WHERE lecturer_code = 'GV001'), 'Thu 2 ca 1'),
    ((SELECT course_id FROM courses WHERE course_code = 'LTW001'), (SELECT class_id FROM classes WHERE class_code = 'DHKTPM18A'), (SELECT lecturer_id FROM lecturers WHERE lecturer_code = 'GV002'), 'Thu 4 ca 2'),
    ((SELECT course_id FROM courses WHERE course_code = 'CNPM001'), (SELECT class_id FROM classes WHERE class_code = 'DHKTPM18B'), (SELECT lecturer_id FROM lecturers WHERE lecturer_code = 'GV003'), 'Thu 3 ca 1'),
    ((SELECT course_id FROM courses WHERE course_code = 'AI001'), (SELECT class_id FROM classes WHERE class_code = 'DHKTPM18B'), (SELECT lecturer_id FROM lecturers WHERE lecturer_code = 'GV004'), 'Thu 5 ca 2'),
    ((SELECT course_id FROM courses WHERE course_code = 'LTJAVA01'), (SELECT class_id FROM classes WHERE class_code = 'DHKTPM18C'), (SELECT lecturer_id FROM lecturers WHERE lecturer_code = 'GV005'), 'Thu 2 ca 2'),
    ((SELECT course_id FROM courses WHERE course_code = 'PTTK001'), (SELECT class_id FROM classes WHERE class_code = 'DHKTPM18C'), (SELECT lecturer_id FROM lecturers WHERE lecturer_code = 'GV003'), 'Thu 6 ca 1'),
    ((SELECT course_id FROM courses WHERE course_code = 'CSDL001'), (SELECT class_id FROM classes WHERE class_code = 'DHHTTT18A'), (SELECT lecturer_id FROM lecturers WHERE lecturer_code = 'GV001'), 'Thu 3 ca 2'),
    ((SELECT course_id FROM courses WHERE course_code = 'KTDL001'), (SELECT class_id FROM classes WHERE class_code = 'DHHTTT18A'), (SELECT lecturer_id FROM lecturers WHERE lecturer_code = 'GV006'), 'Thu 5 ca 1'),
    ((SELECT course_id FROM courses WHERE course_code = 'PTTK001'), (SELECT class_id FROM classes WHERE class_code = 'DHHTTT18B'), (SELECT lecturer_id FROM lecturers WHERE lecturer_code = 'GV007'), 'Thu 2 ca 3'),
    ((SELECT course_id FROM courses WHERE course_code = 'LTW001'), (SELECT class_id FROM classes WHERE class_code = 'DHHTTT18B'), (SELECT lecturer_id FROM lecturers WHERE lecturer_code = 'GV002'), 'Thu 6 ca 2'),
    ((SELECT course_id FROM courses WHERE course_code = 'AI001'), (SELECT class_id FROM classes WHERE class_code = 'DHKHMT18A'), (SELECT lecturer_id FROM lecturers WHERE lecturer_code = 'GV004'), 'Thu 4 ca 1'),
    ((SELECT course_id FROM courses WHERE course_code = 'TTNT002'), (SELECT class_id FROM classes WHERE class_code = 'DHKHMT18A'), (SELECT lecturer_id FROM lecturers WHERE lecturer_code = 'GV006'), 'Thu 6 ca 3'),
    ((SELECT course_id FROM courses WHERE course_code = 'KTDL001'), (SELECT class_id FROM classes WHERE class_code = 'DHKHDL18A'), (SELECT lecturer_id FROM lecturers WHERE lecturer_code = 'GV006'), 'Thu 2 ca 1'),
    ((SELECT course_id FROM courses WHERE course_code = 'CSDL001'), (SELECT class_id FROM classes WHERE class_code = 'DHKHDL18A'), (SELECT lecturer_id FROM lecturers WHERE lecturer_code = 'GV001'), 'Thu 4 ca 3'),
    ((SELECT course_id FROM courses WHERE course_code = 'MMT001'), (SELECT class_id FROM classes WHERE class_code = 'DHMANG18A'), (SELECT lecturer_id FROM lecturers WHERE lecturer_code = 'GV008'), 'Thu 3 ca 3'),
    ((SELECT course_id FROM courses WHERE course_code = 'ATTT001'), (SELECT class_id FROM classes WHERE class_code = 'DHMANG18A'), (SELECT lecturer_id FROM lecturers WHERE lecturer_code = 'GV007'), 'Thu 5 ca 3');


INSERT INTO enrollments (section_id, student_id)
SELECT
    cs.section_id,
    s.student_id
FROM course_sections cs
JOIN classes c ON c.class_id = cs.class_id
JOIN students s ON s.class_id = c.class_id
ON CONFLICT (section_id, student_id) DO NOTHING;

DO $$
DECLARE
    section_rec RECORD;
    base_date DATE;
    start_hour INT;
    session_idx INT;
    v_session_id BIGINT;
    enrolled_rec RECORD;
    seq_no INT;
    v_checkin_time TIMESTAMP;
BEGIN
    FOR section_rec IN
        SELECT
            cs.section_id,
            c.class_code,
            co.course_code,
            co.course_name,
            row_number() OVER (ORDER BY cs.section_id) AS section_order
        FROM course_sections cs
        JOIN classes c ON c.class_id = cs.class_id
        JOIN courses co ON co.course_id = cs.course_id
        ORDER BY cs.section_id
    LOOP
        base_date := DATE '2026-03-02' + ((section_rec.section_order - 1) % 8);
        start_hour := CASE section_rec.section_order % 3
            WHEN 1 THEN 7
            WHEN 2 THEN 13
            ELSE 18
        END;

        FOR session_idx IN 1..4 LOOP
            INSERT INTO attendance_sessions (
                section_id,
                session_title,
                session_date,
                start_time,
                end_time,
                late_after_minutes,
                status
            ) VALUES (
                section_rec.section_id,
                CASE session_idx
                    WHEN 1 THEN 'Buoi 01 - Gioi thieu hoc phan'
                    WHEN 2 THEN 'Buoi 02 - Thuc hanh nen tang'
                    WHEN 3 THEN 'Buoi 03 - Kiem tra tien do'
                    ELSE 'Buoi 04 - Tong ket chu de'
                END,
                base_date + ((session_idx - 1) * 7),
                (base_date + ((session_idx - 1) * 7))::timestamp + make_interval(hours => start_hour),
                (base_date + ((session_idx - 1) * 7))::timestamp + make_interval(hours => start_hour + 2),
                CASE WHEN session_idx IN (1,4) THEN 15 ELSE 10 END,
                'draft'
            )
            RETURNING session_id INTO v_session_id;

            IF session_idx = 1 THEN
                PERFORM open_attendance_session(v_session_id);
            ELSIF session_idx = 2 THEN
                PERFORM open_attendance_session(v_session_id);
            ELSIF session_idx = 3 THEN
                PERFORM open_attendance_session(v_session_id);
            END IF;

            IF session_idx IN (1,2,3) THEN
                seq_no := 0;
                FOR enrolled_rec IN
                    SELECT s.student_id, s.student_code, row_number() OVER (ORDER BY s.student_code) AS rn
                    FROM enrollments e
                    JOIN students s ON s.student_id = e.student_id
                    WHERE e.section_id = section_rec.section_id
                    ORDER BY s.student_code
                LOOP
                    seq_no := seq_no + 1;
                    CASE seq_no % 10
                        WHEN 1 THEN
                            v_checkin_time := (SELECT start_time - interval '8 minutes' FROM attendance_sessions WHERE session_id = v_session_id);
                            PERFORM upsert_attendance_record(v_session_id, enrolled_rec.student_id, 'uploads/checkin/' || enrolled_rec.student_code || '_s' || v_session_id || '.jpg', v_checkin_time, 94, 150, 'matched');
                        WHEN 2 THEN
                            v_checkin_time := (SELECT start_time + interval '3 minutes' FROM attendance_sessions WHERE session_id = v_session_id);
                            PERFORM upsert_attendance_record(v_session_id, enrolled_rec.student_id, 'uploads/checkin/' || enrolled_rec.student_code || '_s' || v_session_id || '.jpg', v_checkin_time, 91, 146, 'matched');
                        WHEN 3 THEN
                            v_checkin_time := (SELECT start_time + interval '7 minutes' FROM attendance_sessions WHERE session_id = v_session_id);
                            PERFORM upsert_attendance_record(v_session_id, enrolled_rec.student_id, 'uploads/checkin/' || enrolled_rec.student_code || '_s' || v_session_id || '.jpg', v_checkin_time, 89, 144, 'matched');
                        WHEN 4 THEN
                            v_checkin_time := (SELECT start_time + interval '18 minutes' FROM attendance_sessions WHERE session_id = v_session_id);
                            PERFORM upsert_attendance_record(v_session_id, enrolled_rec.student_id, 'uploads/checkin/' || enrolled_rec.student_code || '_s' || v_session_id || '.jpg', v_checkin_time, 87, 142, 'matched');
                        WHEN 5 THEN
                            v_checkin_time := (SELECT start_time + interval '5 minutes' FROM attendance_sessions WHERE session_id = v_session_id);
                            PERFORM upsert_attendance_record(v_session_id, enrolled_rec.student_id, 'uploads/checkin/' || enrolled_rec.student_code || '_s' || v_session_id || '.jpg', v_checkin_time, 56, 140, 'unknown');
                        WHEN 6 THEN
                            v_checkin_time := (SELECT start_time + interval '4 minutes' FROM attendance_sessions WHERE session_id = v_session_id);
                            PERFORM upsert_attendance_record(v_session_id, enrolled_rec.student_id, 'uploads/checkin/' || enrolled_rec.student_code || '_s' || v_session_id || '.jpg', v_checkin_time, 88, 72, 'matched');
                        WHEN 7 THEN
                            UPDATE attendance_records
                            SET attendance_status = 'absent',
                                recognition_status = 'manual_marked',
                                is_manual_override = TRUE,
                                note = 'Giang vien danh dau vang co phep',
                                updated_at = CURRENT_TIMESTAMP
                            WHERE session_id = v_session_id AND student_id = enrolled_rec.student_id;
                        WHEN 8 THEN
                            v_checkin_time := (SELECT start_time - interval '2 minutes' FROM attendance_sessions WHERE session_id = v_session_id);
                            PERFORM upsert_attendance_record(v_session_id, enrolled_rec.student_id, 'uploads/checkin/' || enrolled_rec.student_code || '_s' || v_session_id || '.jpg', v_checkin_time, 93, 149, 'matched');
                        WHEN 9 THEN
                            v_checkin_time := (SELECT start_time + interval '1 minutes' FROM attendance_sessions WHERE session_id = v_session_id);
                            PERFORM upsert_attendance_record(v_session_id, enrolled_rec.student_id, 'uploads/checkin/' || enrolled_rec.student_code || '_s' || v_session_id || '.jpg', v_checkin_time, 90, 147, 'matched');
                        ELSE
                            -- de nguyen absent de demo sinh vien vang mat
                            NULL;
                    END CASE;
                END LOOP;
            END IF;

            IF session_idx = 1 THEN
                PERFORM submit_attendance_session(v_session_id);
            ELSIF session_idx = 2 THEN
                PERFORM close_attendance_session(v_session_id);
            ELSIF session_idx = 3 THEN
                -- giu trang thai open de demo dashboard va scan realtime
                NULL;
            ELSE
                -- giu draft
                NULL;
            END IF;
        END LOOP;
    END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS make_demo_embedding(INT);
