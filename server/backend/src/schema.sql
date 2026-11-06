-- Schema tối giản cho PoC điểm danh ra/vào phòng lab bằng khuôn mặt.
-- Không có courses/classes/lecturers/sections/sessions — chỉ 3 bảng.
-- embedding lưu dạng TEXT (JSON.stringify của mảng 512 số) vì SQLite không có
-- kiểu vector, và cũng không cần: so khớp cosine đã chuyển hết xuống edge (numpy).

CREATE TABLE IF NOT EXISTS users (
    user_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    user_code   TEXT NOT NULL UNIQUE,
    full_name   TEXT NOT NULL,
    email       TEXT,
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS face_profiles (
    face_profile_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
    image_path      TEXT,
    embedding       TEXT NOT NULL,   -- JSON.stringify([...512 số...])
    -- JSON metadata model/preprocessing tạo ra embedding (AI service trả về), vd
    -- {"recognizer_sha256": "...", "preprocessing": "...", "embedding_dimension": 512}.
    -- Edge chỉ dùng embedding có pipeline khớp đúng model của nó.
    pipeline        TEXT,
    quality_score   REAL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime'))
);

-- event_id do edge sinh ra (uuid4) — dùng làm khoá chống trùng khi edge retry gửi mạng,
-- KHÔNG cần logic upsert phức tạp như attendance_records cũ.
CREATE TABLE IF NOT EXISTS access_events (
    event_id    TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    device_id   TEXT NOT NULL,
    event_type  TEXT NOT NULL CHECK (event_type IN ('check_in', 'check_out')),
    confidence  REAL,
    event_time  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_access_events_user_time ON access_events(user_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_access_events_time ON access_events(event_time DESC);

-- Thiết bị biên: cập nhật mỗi lần edge gửi heartbeat hoặc sự kiện. Trang quản trị
-- dùng last_seen_at để biết thiết bị online/offline, pending_events để biết còn bao
-- nhiêu sự kiện chưa đồng bộ lên server.
CREATE TABLE IF NOT EXISTS devices (
    device_id         TEXT PRIMARY KEY,
    first_seen_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime')),
    last_seen_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime')),
    last_ip           TEXT,
    last_event_at     TEXT,       -- lần cuối server nhận sự kiện mới từ thiết bị
    pending_events    INTEGER,    -- số sự kiện edge báo còn chờ đồng bộ (theo heartbeat)
    rejected_events   INTEGER,
    face_data_version TEXT,       -- phiên bản dữ liệu khuôn mặt edge đang dùng
    status            TEXT        -- JSON trạng thái edge gửi kèm heartbeat (camera, model...)
);
