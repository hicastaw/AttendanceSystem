# Attendance DB Package

Bo package nay cung cap bo chuong trinh trien khai co so du lieu PostgreSQL cho du an diem danh sinh vien bang nhan dien khuon mat.

## Cong nghe
- PostgreSQL 16
- pgvector
- Docker Compose

## Cau truc

```text
attendance_db_package/
├── docker-compose.yml
├── .env.example
├── README.md
├── docker-entrypoint-initdb.d/
│   ├── 001_extensions.sql
│   ├── 002_schema.sql
│   ├── 003_functions_triggers.sql
│   ├── 004_indexes_views.sql
│   └── 005_seed_demo.sql
└── database/
    ├── init/
    │   └── 001_extensions.sql
    ├── migrations/
    │   ├── 002_schema.sql
    │   ├── 003_functions_triggers.sql
    │   └── 004_indexes_views.sql
    ├── seeds/
    │   └── 001_seed_demo.sql
    └── scripts/
        ├── reset_dev.sql
        └── verify.sql
```

## Chay nhanh bang Docker

1. Tao file `.env` tu `.env.example`.
2. Chay:

```bash
docker compose up -d
```

3. Ket noi DB:

```bash
psql postgresql://attendance_user:attendance_pass@localhost:5432/attendance_db
```

## Thu tu cai dat neu chay thu cong

```bash
psql -U attendance_user -d attendance_db -f database/init/001_extensions.sql
psql -U attendance_user -d attendance_db -f database/migrations/002_schema.sql
psql -U attendance_user -d attendance_db -f database/migrations/003_functions_triggers.sql
psql -U attendance_user -d attendance_db -f database/migrations/004_indexes_views.sql
psql -U attendance_user -d attendance_db -f database/seeds/001_seed_demo.sql
```

## Luong van hanh chinh

### 1. Tao buoi diem danh
- Them ban ghi vao `attendance_sessions`
- Goi `bootstrap_attendance_sheet(session_id)` de tao san so diem danh cho toan bo sinh vien da dang ky hoc phan

### 2. Sinh vien check-in
Backend goi:

```sql
SELECT *
FROM upsert_attendance_record(
    p_session_id := 1,
    p_student_id := 1,
    p_checkin_image_path := 'uploads/checkin/sv001.jpg',
    p_checkin_time := NOW(),
    p_confidence_score := 89.25,
    p_sharpness_score := 145.80,
    p_recognition_status := 'matched'
);
```

Ham se:
- Kiem tra sinh vien co thuoc hoc phan cua buoi hoc hay khong
- Tu dong tinh `attendance_status`
- Upsert vao `attendance_records`

### 3. Giang vien sua tay
Cap nhat truc tiep `attendance_records`:

```sql
UPDATE attendance_records
SET attendance_status = 'absent',
    recognition_status = 'manual_marked',
    is_manual_override = TRUE,
    note = 'Giang vien xac nhan vang',
    updated_at = NOW()
WHERE session_id = 1
  AND student_id = 1;
```

### 4. Chot buoi hoc
```sql
SELECT close_attendance_session(1);
```

Ham se dong session va giu `absent` cho cac sinh vien khong check-in.

## View bao cao
- `vw_attendance_student_summary`
- `vw_attendance_section_summary`
- `vw_attendance_session_detail`

## Kiem tra nhanh

```bash
psql -U attendance_user -d attendance_db -f database/scripts/verify.sql
```

