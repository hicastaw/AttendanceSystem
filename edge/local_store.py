"""SQLite cục bộ của edge — nguồn dữ liệu vận hành khi offline (offline-first).

- access_events: hàng đợi sự kiện check_in/check_out. Ghi xuống đĩa TRƯỚC khi gửi
  (mất điện lúc đang gửi cũng không mất); server nhận xong thì XOÁ NGAY — khi có mạng
  bảng gần như luôn trống. sync_status: pending (chờ gửi) | rejected (server từ chối
  vĩnh viễn, vd người dùng không tồn tại; giữ lại để tra cứu, tự xoá sau N ngày).
- person_state: trạng thái vào/ra gần nhất của từng người, để toggle đúng sau restart.
- face_cache: bản dữ liệu khuôn mặt tải từ server ('current') và bản trước đó
  ('previous', để rollback) — edge vẫn nhận diện được khi khởi động lúc mất mạng.

Ghi sự kiện + cập nhật person_state trong 1 transaction để không lệch nhau.
"""
import json
import sqlite3
import threading
from datetime import datetime, timedelta, timezone

_SCHEMA = """
CREATE TABLE IF NOT EXISTS access_events (
    event_id    TEXT PRIMARY KEY,
    user_code   TEXT NOT NULL,
    device_id   TEXT NOT NULL,
    event_type  TEXT NOT NULL CHECK (event_type IN ('check_in', 'check_out')),
    confidence  REAL,
    event_time  TEXT NOT NULL,
    sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'rejected')),
    attempts    INTEGER NOT NULL DEFAULT 0,
    last_error  TEXT,
    created_at  TEXT NOT NULL,
    rejected_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_pending ON access_events(sync_status, event_time);

CREATE TABLE IF NOT EXISTS person_state (
    user_code       TEXT PRIMARY KEY,
    last_event_type TEXT NOT NULL CHECK (last_event_type IN ('check_in', 'check_out')),
    last_event_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS face_cache (
    slot       TEXT PRIMARY KEY CHECK (slot IN ('current', 'previous')),
    version    TEXT,
    pipeline   TEXT,
    data       TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);
"""


def _now():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


class LocalStore:
    def __init__(self, path):
        self.path = str(path)
        # 1 kết nối dùng chung cho vòng lặp camera + thread sync, bảo vệ bằng lock.
        self._conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA synchronous=NORMAL")
            self._conn.executescript(_SCHEMA)

    def close(self):
        with self._lock:
            self._conn.close()

    # --- Sự kiện ---------------------------------------------------------------

    def record_event(self, event):
        """Ghi sự kiện (pending) + trạng thái vào/ra của người đó trong 1 transaction."""
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                self._conn.execute(
                    """INSERT INTO access_events
                       (event_id, user_code, device_id, event_type, confidence, event_time, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (event["event_id"], event["user_code"], event["device_id"], event["event_type"],
                     event.get("confidence"), event["timestamp"], _now()),
                )
                self._conn.execute(
                    """INSERT INTO person_state (user_code, last_event_type, last_event_time)
                       VALUES (?, ?, ?)
                       ON CONFLICT(user_code) DO UPDATE SET
                         last_event_type = excluded.last_event_type,
                         last_event_time = excluded.last_event_time""",
                    (event["user_code"], event["event_type"], event["timestamp"]),
                )
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    def pending_events(self, limit=50):
        """Sự kiện chờ gửi, theo thứ tự phát sinh, đúng format API server."""
        with self._lock:
            rows = self._conn.execute(
                """SELECT event_id, device_id, user_code, event_type, event_time, confidence
                   FROM access_events WHERE sync_status = 'pending'
                   ORDER BY event_time, rowid LIMIT ?""",
                (limit,),
            ).fetchall()
        return [{"event_id": r["event_id"], "device_id": r["device_id"], "user_code": r["user_code"],
                 "event_type": r["event_type"], "timestamp": r["event_time"],
                 "confidence": r["confidence"]} for r in rows]

    def mark_synced(self, event_ids):
        """Server đã nhận (accepted/duplicate): xoá khỏi hàng đợi, server giữ bản chính."""
        if not event_ids:
            return
        with self._lock:
            self._conn.executemany("DELETE FROM access_events WHERE event_id = ?",
                                   [(event_id,) for event_id in event_ids])

    def mark_rejected(self, event_id, reason):
        with self._lock:
            self._conn.execute(
                "UPDATE access_events SET sync_status = 'rejected', last_error = ?, rejected_at = ? "
                "WHERE event_id = ?",
                (reason, _now(), event_id),
            )

    def record_attempt_failure(self, event_ids, error):
        with self._lock:
            self._conn.executemany(
                "UPDATE access_events SET attempts = attempts + 1, last_error = ? WHERE event_id = ?",
                [(str(error)[:500], event_id) for event_id in event_ids],
            )

    def event_counts(self):
        with self._lock:
            rows = self._conn.execute(
                "SELECT sync_status, COUNT(*) AS n FROM access_events GROUP BY sync_status"
            ).fetchall()
        counts = {"pending": 0, "rejected": 0}
        counts.update({r["sync_status"]: r["n"] for r in rows})
        return counts

    def prune_rejected(self, retention_days):
        """Xoá sự kiện bị server từ chối cũ hơn retention_days."""
        cutoff = (datetime.now(timezone.utc) - timedelta(days=retention_days)).astimezone()
        with self._lock:
            cur = self._conn.execute(
                "DELETE FROM access_events WHERE sync_status = 'rejected' AND rejected_at < ?",
                (cutoff.isoformat(timespec="seconds"),),
            )
        return cur.rowcount

    # --- Trạng thái vào/ra -------------------------------------------------------

    def last_states(self):
        with self._lock:
            rows = self._conn.execute("SELECT user_code, last_event_type FROM person_state").fetchall()
        return {r["user_code"]: r["last_event_type"] for r in rows}

    def last_state_days(self):
        """{user_code: 'YYYY-MM-DD'} ngày (giờ địa phương của thời điểm sự kiện) của lần gần nhất."""
        with self._lock:
            rows = self._conn.execute("SELECT user_code, last_event_time FROM person_state").fetchall()
        return {r["user_code"]: r["last_event_time"][:10] for r in rows}

    def seed_states(self, state_map, time_map=None):
        """Nạp trạng thái từ server khi edge chưa có dữ liệu cục bộ; không ghi đè người đã có.
        time_map: {user_code: thời điểm sự kiện}; thiếu thì coi là sự kiện cũ (ngày 1970-01-01)
        để lần quét tới của người đó luôn là check_in."""
        time_map = time_map or {}
        with self._lock:
            self._conn.executemany(
                """INSERT INTO person_state (user_code, last_event_type, last_event_time)
                   VALUES (?, ?, ?) ON CONFLICT(user_code) DO NOTHING""",
                [(code, event_type, time_map.get(code) or "1970-01-01T00:00:00+00:00")
                 for code, event_type in (state_map or {}).items()
                 if event_type in ("check_in", "check_out")],
            )

    # --- Cache dữ liệu khuôn mặt -------------------------------------------------

    def save_face_data(self, data, pipeline, version):
        """Thay bản 'current' bằng dữ liệu mới, đẩy bản cũ sang 'previous' (1 transaction)."""
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                self._conn.execute("DELETE FROM face_cache WHERE slot = 'previous'")
                self._conn.execute("UPDATE face_cache SET slot = 'previous' WHERE slot = 'current'")
                self._conn.execute(
                    "INSERT INTO face_cache (slot, version, pipeline, data, fetched_at) VALUES ('current', ?, ?, ?, ?)",
                    (version, json.dumps(pipeline) if pipeline is not None else None,
                     json.dumps(data), _now()),
                )
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    def load_face_data(self, slot="current"):
        """Trả {data, pipeline, version, fetched_at} hoặc None nếu chưa có cache."""
        with self._lock:
            row = self._conn.execute(
                "SELECT version, pipeline, data, fetched_at FROM face_cache WHERE slot = ?", (slot,)
            ).fetchone()
        if row is None:
            return None
        return {"data": json.loads(row["data"]),
                "pipeline": json.loads(row["pipeline"]) if row["pipeline"] else None,
                "version": row["version"], "fetched_at": row["fetched_at"]}
