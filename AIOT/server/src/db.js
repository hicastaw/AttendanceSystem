import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { defaults } from './attendance-schedule.js';
import {mode, legacyContract} from './runtime.js';
import {cpuTestScope} from './cpu-test-scope.js';
import {initializeLabAttendance} from './lab-attendance-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.DB_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'attendance.db');
if (mode === 'mock' && (!process.env.DB_PATH || path.resolve(DB_PATH).startsWith(path.resolve(__dirname, '..', 'data') + path.sep))) {
  throw new Error('Mock requires an explicit, separate DB_PATH outside server/data');
}
const db = new Database(DB_PATH);
// Check mode BEFORE schema/WAL migrations. Never adopt an unmarked real DB as mock.
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);
const storedMode = tables.includes('app_metadata') ? db.prepare("SELECT value FROM app_metadata WHERE key='runtime_mode'").get()?.value : null;
const storedCpuRun = tables.includes('app_metadata') ? db.prepare("SELECT value FROM app_metadata WHERE key='cpu_test_run'").get()?.value : null;
if ((cpuTestScope && tables.length && storedCpuRun!==cpuTestScope.runId) || (!cpuTestScope && storedCpuRun)) {
  db.close();throw new Error('CPU test database isolation mismatch; refusing migrations');
}
if ((storedMode && storedMode !== mode) || (mode === 'mock' && tables.length && !storedMode)) {
  db.close();
  throw new Error('Database mode mismatch; refusing to modify data');
}
const schemaVersion = db.pragma('user_version', {simple:true});
if (schemaVersion > 1) { db.close(); throw new Error('Unsupported backend schema version'); }
db.pragma('journal_mode = WAL');
db.pragma('synchronous = FULL');
db.pragma('busy_timeout = 3000');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

// Additive migration, preserve all legacy rows without assigning past events.
db.transaction(() => {
  db.exec('CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.exec(`CREATE TABLE IF NOT EXISTS event_receipts (
    event_id TEXT PRIMARY KEY, payload TEXT NOT NULL,
    attendance_event_id TEXT NOT NULL REFERENCES access_events(event_id)
  )`);
  db.prepare("INSERT OR IGNORE INTO app_metadata VALUES ('runtime_mode',?)").run(mode);
  if(cpuTestScope)db.prepare("INSERT OR IGNORE INTO app_metadata VALUES ('cpu_test_run',?)").run(cpuTestScope.runId);
  const profiles = new Set(db.pragma('table_info(face_profiles)').map(c=>c.name));
  if (!profiles.has('embedding_contract')) {
    db.exec(`ALTER TABLE face_profiles ADD COLUMN embedding_contract TEXT DEFAULT '${JSON.stringify(legacyContract)}'`);
    // Legacy provenance is explicitly named legacy; never relabel as R50.
    db.prepare('UPDATE face_profiles SET embedding_contract=?').run(JSON.stringify(legacyContract));
  }
  const columns = new Set(db.pragma('table_info(access_events)').map(c=>c.name));
  if (!columns.has('scheduled_event_id')) db.exec('ALTER TABLE access_events ADD COLUMN scheduled_event_id TEXT REFERENCES scheduled_events(schedule_id)');
  if (!columns.has('occurrence_key')) db.exec('ALTER TABLE access_events ADD COLUMN occurrence_key TEXT');
  if (!columns.has('event_name')) db.exec('ALTER TABLE access_events ADD COLUMN event_name TEXT');
  // Seed ONCE, not again on restart if an admin has disabled the defaults.
  const seeded = db.prepare("SELECT 1 FROM scheduled_events WHERE schedule_id='__initialized__'").get();
  if (!seeded) {
    const insert = db.prepare('INSERT OR IGNORE INTO scheduled_events VALUES (?,?)');
    for (const event of defaults) insert.run(event.schedule_id, JSON.stringify(event));
    insert.run('__initialized__', '{}');
  }
  db.pragma('user_version = 1');
})();

// Daily attendance frequency is available only in the named, temporary R50
// laptop run. Production schema/history retains its existing schedule semantics.
if (cpuTestScope?.purpose === 'isolated-r50-laptop-test') initializeLabAttendance(db);

console.log(`✅ SQLite sẵn sàng tại ${DB_PATH}`);

export default db;
