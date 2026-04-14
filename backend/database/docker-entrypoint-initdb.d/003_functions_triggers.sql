CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION compute_attendance_status(
    p_session_id BIGINT,
    p_checkin_time TIMESTAMP
)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
    v_start_time TIMESTAMP;
    v_end_time TIMESTAMP;
    v_late_after_minutes INT;
BEGIN
    SELECT start_time, end_time, late_after_minutes
    INTO v_start_time, v_end_time, v_late_after_minutes
    FROM attendance_sessions
    WHERE session_id = p_session_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attendance session % does not exist', p_session_id;
    END IF;

    IF p_checkin_time IS NULL THEN
        RETURN 'absent';
    ELSIF p_checkin_time < v_start_time AT TIME ZONE 'Asia/Ho_Chi_Minh' THEN
        RETURN 'early';
    ELSIF p_checkin_time <= (v_start_time + make_interval(mins => v_late_after_minutes)) AT TIME ZONE 'Asia/Ho_Chi_Minh' THEN
        RETURN 'on_time';
    ELSIF p_checkin_time > v_end_time AT TIME ZONE 'Asia/Ho_Chi_Minh' THEN
        RETURN 'absent';
    ELSE
        RETURN 'late';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION bootstrap_attendance_sheet(
    p_session_id BIGINT
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_inserted_count INTEGER := 0;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM attendance_sessions
        WHERE session_id = p_session_id
    ) THEN
        RAISE EXCEPTION 'Attendance session % does not exist', p_session_id;
    END IF;

    INSERT INTO attendance_records (
        session_id,
        student_id,
        attendance_status,
        created_at,
        updated_at
    )
    SELECT
        p_session_id,
        e.student_id,
        'absent',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    FROM attendance_sessions s
    JOIN enrollments e ON e.section_id = s.section_id
    WHERE s.session_id = p_session_id
    ON CONFLICT (session_id, student_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    RETURN v_inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION open_attendance_session(
    p_session_id BIGINT
)
RETURNS attendance_sessions
LANGUAGE plpgsql
AS $$
DECLARE
    v_session attendance_sessions%ROWTYPE;
BEGIN
    UPDATE attendance_sessions
    SET status = 'open'
    WHERE session_id = p_session_id
      AND status IN ('draft', 'closed');

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attendance session % cannot be opened', p_session_id;
    END IF;

    PERFORM bootstrap_attendance_sheet(p_session_id);

    SELECT *
    INTO v_session
    FROM attendance_sessions
    WHERE session_id = p_session_id;

    RETURN v_session;
END;
$$;

CREATE OR REPLACE FUNCTION close_attendance_session(
    p_session_id BIGINT
)
RETURNS attendance_sessions
LANGUAGE plpgsql
AS $$
DECLARE
    v_session attendance_sessions%ROWTYPE;
BEGIN
    PERFORM bootstrap_attendance_sheet(p_session_id);

    UPDATE attendance_sessions
    SET status = 'closed'
    WHERE session_id = p_session_id
      AND status IN ('open', 'draft');

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attendance session % cannot be closed', p_session_id;
    END IF;

    SELECT *
    INTO v_session
    FROM attendance_sessions
    WHERE session_id = p_session_id;

    RETURN v_session;
END;
$$;

CREATE OR REPLACE FUNCTION submit_attendance_session(
    p_session_id BIGINT
)
RETURNS attendance_sessions
LANGUAGE plpgsql
AS $$
DECLARE
    v_session attendance_sessions%ROWTYPE;
BEGIN
    PERFORM bootstrap_attendance_sheet(p_session_id);

    UPDATE attendance_sessions
    SET status = 'submitted'
    WHERE session_id = p_session_id
      AND status IN ('open', 'closed');

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attendance session % cannot be submitted', p_session_id;
    END IF;

    SELECT *
    INTO v_session
    FROM attendance_sessions
    WHERE session_id = p_session_id;

    RETURN v_session;
END;
$$;

CREATE OR REPLACE FUNCTION upsert_attendance_record(
    p_session_id BIGINT,
    p_student_id BIGINT,
    p_checkin_image_path TEXT,
    p_checkin_time TIMESTAMP,
    p_confidence_score NUMERIC(5,2),
    p_sharpness_score NUMERIC(10,2),
    p_recognition_status VARCHAR(30)
)
RETURNS attendance_records
LANGUAGE plpgsql
AS $$
DECLARE
    v_session attendance_sessions%ROWTYPE;
    v_is_enrolled BOOLEAN;
    v_attendance_status VARCHAR(20) := 'absent';
    v_recognition_status VARCHAR(30);
    v_record attendance_records%ROWTYPE;
BEGIN
    SELECT *
    INTO v_session
    FROM attendance_sessions
    WHERE session_id = p_session_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attendance session % does not exist', p_session_id;
    END IF;

    IF v_session.status <> 'open' THEN
        RAISE EXCEPTION 'Attendance session % is not open', p_session_id;
    END IF;

    -- v_is_enrolled check removed for global attendance
    v_recognition_status := COALESCE(p_recognition_status, 'unknown');

    IF v_recognition_status = 'matched' THEN
        IF COALESCE(p_confidence_score, 0) < 60 THEN
            v_recognition_status := 'low_confidence';
            v_attendance_status := 'absent';
        ELSIF COALESCE(p_sharpness_score, 0) <= 100 THEN
            v_recognition_status := 'blurry_rejected';
            v_attendance_status := 'absent';
        ELSE
            v_recognition_status := 'matched';
            v_attendance_status := compute_attendance_status(p_session_id, p_checkin_time);
        END IF;
    ELSE
        v_attendance_status := 'absent';
    END IF;

    INSERT INTO attendance_records (
        session_id,
        student_id,
        checkin_image_path,
        checkin_time,
        confidence_score,
        sharpness_score,
        recognition_status,
        attendance_status,
        created_at,
        updated_at
    )
    VALUES (
        p_session_id,
        p_student_id,
        p_checkin_image_path,
        p_checkin_time,
        p_confidence_score,
        p_sharpness_score,
        v_recognition_status,
        v_attendance_status,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    )
    ON CONFLICT (session_id, student_id)
    DO UPDATE SET
        checkin_image_path = EXCLUDED.checkin_image_path,
        checkin_time = EXCLUDED.checkin_time,
        confidence_score = EXCLUDED.confidence_score,
        sharpness_score = EXCLUDED.sharpness_score,
        recognition_status = EXCLUDED.recognition_status,
        attendance_status = EXCLUDED.attendance_status,
        updated_at = CURRENT_TIMESTAMP
    WHERE attendance_records.is_manual_override = FALSE
    RETURNING * INTO v_record;

    IF v_record.record_id IS NULL THEN
        SELECT *
        INTO v_record
        FROM attendance_records
        WHERE session_id = p_session_id
          AND student_id = p_student_id;
    END IF;

    RETURN v_record;
END;
$$;

DROP TRIGGER IF EXISTS trg_face_profiles_set_updated_at ON face_profiles;
CREATE TRIGGER trg_face_profiles_set_updated_at
BEFORE UPDATE ON face_profiles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_attendance_records_set_updated_at ON attendance_records;
CREATE TRIGGER trg_attendance_records_set_updated_at
BEFORE UPDATE ON attendance_records
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
