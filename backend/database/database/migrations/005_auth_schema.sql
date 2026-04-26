-- Bo sung bang tai khoan dang nhap that cho he thong

CREATE TABLE IF NOT EXISTS auth_users (
    auth_user_id BIGSERIAL PRIMARY KEY,
    username VARCHAR(120) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL,
    lecturer_id BIGINT UNIQUE REFERENCES lecturers(lecturer_id) ON DELETE CASCADE,
    student_id BIGINT UNIQUE REFERENCES students(student_id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_auth_users_role CHECK (role IN ('admin', 'lecturer', 'student')),
    CONSTRAINT chk_auth_users_identity CHECK (
        (role = 'admin' AND lecturer_id IS NULL AND student_id IS NULL)
        OR (role = 'lecturer' AND lecturer_id IS NOT NULL AND student_id IS NULL)
        OR (role = 'student' AND lecturer_id IS NULL AND student_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_users_lecturer_id_not_null
ON auth_users (lecturer_id)
WHERE lecturer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_users_student_id_not_null
ON auth_users (student_id)
WHERE student_id IS NOT NULL;
