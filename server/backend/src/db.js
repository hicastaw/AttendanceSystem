import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.DB_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'attendance.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

// Migration cho DB tạo trước khi có cột pipeline (CREATE TABLE IF NOT EXISTS không
// tự thêm cột mới). Embedding cũ giữ pipeline = NULL -> cần đăng ký lại.
const faceColumns = db.prepare('PRAGMA table_info(face_profiles)').all().map((c) => c.name);
if (!faceColumns.includes('pipeline')) {
  db.exec('ALTER TABLE face_profiles ADD COLUMN pipeline TEXT');
}

// Pipeline "hiện tại" = pipeline của khuôn mặt được đăng ký/cập nhật gần nhất.
// Khi đổi model nhận diện, chỉ cần đăng ký lại: các embedding pipeline cũ tự bị
// loại khỏi /api/face-data và hiện "Cần đăng ký lại" trên trang quản trị.
export function getCurrentPipeline() {
  const row = db.prepare(`
    SELECT pipeline FROM face_profiles
    WHERE pipeline IS NOT NULL
    ORDER BY updated_at DESC, face_profile_id DESC
    LIMIT 1
  `).get();
  return row ? row.pipeline : null;
}

console.log(`✅ SQLite sẵn sàng tại ${DB_PATH}`);

export default db;
