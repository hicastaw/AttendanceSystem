CREATE TABLE IF NOT EXISTS classes (
    class_id BIGSERIAL PRIMARY KEY,
    class_code VARCHAR(50) NOT NULL UNIQUE,
    class_name VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS courses (
    course_id BIGSERIAL PRIMARY KEY,
    course_code VARCHAR(20) NOT NULL UNIQUE,
    course_name VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS lecturers (
    lecturer_id BIGSERIAL PRIMARY KEY,
    lecturer_code VARCHAR(20) UNIQUE,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS students (
    student_id BIGSERIAL PRIMARY KEY,
    student_code VARCHAR(20) NOT NULL UNIQUE,
    full_name VARCHAR(100) NOT NULL,
    class_id BIGINT NOT NULL REFERENCES classes(class_id),
    email VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_students_status CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE IF NOT EXISTS face_profiles (
    face_profile_id BIGSERIAL PRIMARY KEY,
    student_id BIGINT NOT NULL UNIQUE REFERENCES students(student_id) ON DELETE CASCADE,
    image_path TEXT NOT NULL,
    embedding VECTOR(512) NOT NULL,
    model_name VARCHAR(50) NOT NULL DEFAULT 'insightface',
    quality_score NUMERIC(5,2),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_face_profiles_quality CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 100))
);

CREATE TABLE IF NOT EXISTS course_sections (
    section_id BIGSERIAL PRIMARY KEY,
    course_id BIGINT NOT NULL REFERENCES courses(course_id),
    class_id BIGINT NOT NULL REFERENCES classes(class_id),
    lecturer_id BIGINT NOT NULL REFERENCES lecturers(lecturer_id),
    schedule_note VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_course_sections UNIQUE (course_id, class_id, lecturer_id, schedule_note)
);

CREATE TABLE IF NOT EXISTS enrollments (
    enrollment_id BIGSERIAL PRIMARY KEY,
    section_id BIGINT NOT NULL REFERENCES course_sections(section_id) ON DELETE CASCADE,
    student_id BIGINT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_enrollments_section_student UNIQUE (section_id, student_id)
);

CREATE TABLE IF NOT EXISTS attendance_sessions (
    session_id BIGSERIAL PRIMARY KEY,
    section_id BIGINT NOT NULL REFERENCES course_sections(section_id) ON DELETE CASCADE,
    session_title VARCHAR(100) NOT NULL,
    session_date DATE NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    late_after_minutes INT NOT NULL DEFAULT 15,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_attendance_sessions_status CHECK (status IN ('draft', 'open', 'closed', 'submitted')),
    CONSTRAINT chk_attendance_sessions_late_after CHECK (late_after_minutes >= 0),
    CONSTRAINT chk_attendance_sessions_time_range CHECK (end_time > start_time),
    CONSTRAINT uq_attendance_session UNIQUE (section_id, session_date, session_title)
);

CREATE TABLE IF NOT EXISTS attendance_records (
    record_id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES attendance_sessions(session_id) ON DELETE CASCADE,
    student_id BIGINT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    checkin_image_path TEXT,
    checkin_time TIMESTAMP,
    confidence_score NUMERIC(5,2),
    sharpness_score NUMERIC(10,2),
    recognition_status VARCHAR(30),
    attendance_status VARCHAR(20) NOT NULL DEFAULT 'absent',
    is_manual_override BOOLEAN NOT NULL DEFAULT FALSE,
    note VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_attendance_records_session_student UNIQUE (session_id, student_id),
    CONSTRAINT chk_attendance_records_confidence CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)),
    CONSTRAINT chk_attendance_records_sharpness CHECK (sharpness_score IS NULL OR sharpness_score >= 0),
    CONSTRAINT chk_attendance_records_recognition CHECK (
        recognition_status IS NULL OR recognition_status IN (
            'matched',
            'unknown',
            'blurry_rejected',
            'low_confidence',
            'manual_marked'
        )
    ),
    CONSTRAINT chk_attendance_records_status CHECK (attendance_status IN ('early', 'on_time', 'late', 'absent'))
);
