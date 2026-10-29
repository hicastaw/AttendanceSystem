"""SQLite delivery ledger. One database belongs to one device and one sender.

Persist before transport; ACK and confirmed state commit in ONE transaction.
No images, embeddings, credentials, or HTTP response bodies are stored.
"""
from contextlib import contextmanager
import json
import math
from datetime import datetime
from pathlib import Path
import sqlite3
import threading
import time
import uuid

from attendance_schedule import OUTSIDE_KEY, local_time, validate_events

_ANY_CONTEXT = object()


class DurableOutbox:
    def __init__(self, path, *, clock=None, monotonic=None):
        if str(path) == ":memory:":
            raise ValueError("Outbox requires a persistent file")
        self.path = Path(path).expanduser().resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.clock = clock or time.time
        self.monotonic = monotonic or time.monotonic
        self._cooldown_lock = threading.RLock()
        self._cooldowns = {}
        with self._connect() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1, 2):
                raise RuntimeError(f"Unsupported outbox schema {version}; refusing to modify it")
            tables = {row[0] for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
            if (version == 0 and tables) or (version in (1, 2) and tables != {"metadata", "events", "confirmed_state"}):
                raise RuntimeError("Existing database is not an outbox; refusing to modify it")
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS events (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT NOT NULL UNIQUE,
                    user_code TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('pending','blocked','acked')),
                    attempts INTEGER NOT NULL DEFAULT 0,
                    next_retry REAL NOT NULL,
                    created_at REAL NOT NULL,
                    acked_at REAL,
                    last_error TEXT
                );
                CREATE TABLE IF NOT EXISTS confirmed_state (
                    user_code TEXT PRIMARY KEY,
                    event_type TEXT NOT NULL CHECK(event_type IN ('check_in','check_out')),
                    acked_at REAL
                );
            """)
            # Migration is transactional. Preserve old immutable payloads/UUIDs;
            # NULL marks legacy reservations which conservatively block all contexts.
            db.execute("BEGIN IMMEDIATE")
            try:
                columns = {row[1] for row in db.execute("PRAGMA table_info(events)")}
                if "attendance_key" not in columns:
                    db.execute("ALTER TABLE events ADD COLUMN attendance_key TEXT")
                db.execute("DROP INDEX IF EXISTS one_reservation_per_user")
                db.execute("CREATE UNIQUE INDEX IF NOT EXISTS one_reservation_per_context "
                           "ON events(user_code,COALESCE(attendance_key,'__legacy__')) WHERE status IN ('pending','blocked')")
                db.execute("PRAGMA user_version=2")
                db.execute("COMMIT")
            except BaseException:
                db.execute("ROLLBACK")
                raise

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(str(self.path), timeout=0.25, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA synchronous=FULL")
            yield db
        finally:
            db.close()

    @contextmanager
    def _transaction(self):
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                yield db
                db.execute("COMMIT")
            except BaseException:
                db.execute("ROLLBACK")
                raise

    def enqueue(self, event, *, attendance_key=None):
        """Return queued/already_pending/already_acked/reserved/already_attended.

        Storage errors propagate to caller. Reusing an ID with another payload is
        rejected. Context dedup/reservation is atomic with durable insertion.
        """
        if event.get("event_type") not in ("check_in", "check_out"):
            raise ValueError("Invalid event type")
        if attendance_key is not None and event["event_type"] != "check_in":
            raise ValueError("Contextual kiosk events must be check_in")
        for key in ("event_id", "device_id", "user_code", "timestamp"):
            if not isinstance(event.get(key), str) or not event[key].strip():
                raise ValueError(f"Missing {key}")
        if event["user_code"] != event["user_code"].strip().upper():
            raise ValueError("user_code must be canonical uppercase")
        uuid.UUID(event["event_id"])
        timestamp = datetime.fromisoformat(event["timestamp"])
        if timestamp.utcoffset() is None:
            raise ValueError("Event timestamp needs a timezone")
        if set(event) != {"event_id", "device_id", "user_code", "event_type", "timestamp", "confidence"}:
            raise ValueError("Unexpected event fields; do not persist biometrics or credentials")
        confidence = event["confidence"]
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not math.isfinite(confidence) or not 0 <= confidence <= 100:
            raise ValueError("Confidence must be finite and in [0,100]")
        payload = json.dumps(event, sort_keys=True, separators=(",", ":"), allow_nan=False)
        now = self.clock()
        self._validate_key(attendance_key)
        with self._transaction() as db:
            device = db.execute("SELECT value FROM metadata WHERE key='device_id'").fetchone()
            if device and device[0] != event["device_id"]:
                raise ValueError("Outbox belongs to a different device")
            existing = db.execute("SELECT payload,status FROM events WHERE event_id=?",
                                  (event["event_id"],)).fetchone()
            if existing:
                if existing["payload"] != payload:
                    raise ValueError("Event ID already has a different immutable payload")
                return "already_acked" if existing["status"] == "acked" else "already_pending"
            if self._reservation(db, event["user_code"], attendance_key):
                return "reserved"
            if attendance_key not in (None, OUTSIDE_KEY) and self._confirmed(db, event["user_code"], attendance_key):
                return "already_attended"
            db.execute("INSERT OR IGNORE INTO metadata VALUES ('device_id',?)", (event["device_id"],))
            db.execute("INSERT INTO events(event_id,user_code,payload,status,next_retry,created_at,attendance_key) "
                       "VALUES (?,?,?,'pending',?,?,?)",
                       (event["event_id"], event["user_code"], payload, now, now, attendance_key))
        return "queued"

    def get(self, event_id):
        with self._connect() as db:
            row = db.execute("SELECT * FROM events WHERE event_id=?", (event_id,)).fetchone()
        return self._decode(row)

    @staticmethod
    def _decode(row):
        if row is None:
            return None
        result = dict(row)
        result["event"] = json.loads(result.pop("payload"))
        return result

    def next_due(self):
        with self._connect() as db:
            row = db.execute("SELECT * FROM events WHERE status='pending' AND next_retry<=? "
                             "ORDER BY sequence LIMIT 1", (self.clock(),)).fetchone()
        return self._decode(row)

    def latest_for(self, user_code, attendance_key):
        with self._connect() as db:
            row=db.execute('SELECT * FROM events WHERE user_code=? AND attendance_key=? ORDER BY sequence DESC LIMIT 1',
                           (user_code,attendance_key)).fetchone()
        return self._decode(row)

    @staticmethod
    def _validate_key(key):
        if key is not None and key != OUTSIDE_KEY:
            if not isinstance(key, str) or key.count(":") != 1:
                raise ValueError("Invalid occurrence key")
            identity, day = key.split(":")
            if not identity or local_time(day + "T00:00:00+07:00").date().isoformat() != day:
                raise ValueError("Invalid occurrence key")

    @staticmethod
    def _reservation(db, user_code, key):
        if key is _ANY_CONTEXT or key is None:  # Old API still queries any reservation.
            return db.execute("SELECT status FROM events WHERE user_code=? AND status!='acked' ORDER BY sequence LIMIT 1", (user_code,)).fetchone()
        return db.execute("SELECT status FROM events WHERE user_code=? AND status!='acked' "
                          "AND (attendance_key=? OR attendance_key IS NULL) ORDER BY sequence LIMIT 1", (user_code, key)).fetchone()

    def reservation(self, user_code, attendance_key=_ANY_CONTEXT):
        with self._connect() as db:
            row = self._reservation(db, user_code, attendance_key)
        return row[0] if row else None

    @staticmethod
    def _confirmed(db, user_code, key):
        if db.execute("SELECT 1 FROM events WHERE user_code=? AND attendance_key=? AND status='acked'",
                      (user_code, key)).fetchone():
            return True
        seed = db.execute("SELECT value FROM metadata WHERE key=?", ("attendance:" + key,)).fetchone()
        return bool(seed and user_code in json.loads(seed[0]))

    def has_attended(self, user_code, key):
        self._validate_key(key)
        if key in (None, OUTSIDE_KEY):
            return False
        with self._connect() as db:
            return self._confirmed(db, user_code, key)

    def sync_policy(self, source, events, confirmed):
        events = validate_events(events)
        if not isinstance(confirmed, list):
            raise ValueError("Invalid confirmed attendance")
        grouped = {}
        receipts = {}
        for item in confirmed:
            if not isinstance(item, dict):
                raise ValueError("Invalid confirmed attendance")
            code, key = item.get("user_code"), item.get("occurrence_key")
            if not isinstance(code, str) or not code or code != code.strip().upper() or key in (None, OUTSIDE_KEY):
                raise ValueError("Invalid confirmed attendance")
            self._validate_key(key)
            grouped.setdefault(key, set()).add(code)
            if item.get('event_id') is not None:
                if not isinstance(item['event_id'],str):raise ValueError('Invalid confirmed event ID')
                uuid.UUID(item['event_id'])
                receipts.setdefault(key,{})[code]=item['event_id']
        with self._transaction() as db:
            db.execute("INSERT INTO metadata VALUES ('attendance_policy',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                       (json.dumps(dict(source=source, events=events)),))
            for key, codes in grouped.items():
                name = "attendance:" + key
                old = db.execute("SELECT value FROM metadata WHERE key=?", (name,)).fetchone()
                values = sorted(codes.union(json.loads(old[0]) if old else []))
                db.execute("INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (name, json.dumps(values)))
            for key, values in receipts.items():
                db.execute('INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                           ('attendance-receipt:'+key,json.dumps(values)))
        return events

    def confirmed_event_id(self, user_code, key):
        with self._connect() as db:
            row=db.execute("SELECT event_id FROM events WHERE user_code=? AND attendance_key=? AND status='acked' ORDER BY sequence DESC LIMIT 1",(user_code,key)).fetchone()
            if row:return row[0]
            stored=db.execute('SELECT value FROM metadata WHERE key=?',('attendance-receipt:'+key,)).fetchone()
            return json.loads(stored[0]).get(user_code) if stored else None

    def cached_policy(self, source):
        with self._connect() as db:
            row = db.execute("SELECT value FROM metadata WHERE key='attendance_policy'").fetchone()
        if not row:
            return None
        try:
            data = json.loads(row[0])
            return validate_events(data["events"]) if data["source"] == source else None
        except (ValueError, TypeError, KeyError):
            return None

    def counts(self):
        result = {"pending": 0, "blocked": 0, "acked": 0}
        with self._connect() as db:
            result.update({row[0]: row[1] for row in db.execute(
                "SELECT status,COUNT(*) FROM events GROUP BY status")})
        return result

    def begin_attempt(self, event_id):
        # Count before HTTP, so a crash during transport is also an attempted send.
        with self._transaction() as db:
            db.execute("UPDATE events SET attempts=attempts+1 WHERE event_id=? AND status='pending'",
                       (event_id,))

    def defer(self, event_id, error_code, delay, *, blocked=False):
        with self._transaction() as db:
            db.execute("UPDATE events SET status=?,next_retry=?,last_error=? "
                       "WHERE event_id=? AND status='pending'",
                       ("blocked" if blocked else "pending", self.clock() + delay,
                        error_code, event_id))

    def requeue_blocked(self, event_id):
        """Operator action AFTER fixing credentials/user/validation; retain UUID/payload."""
        with self._transaction() as db:
            return db.execute("UPDATE events SET status='pending',next_retry=?,last_error=NULL,attempts=0 "
                              "WHERE event_id=? AND status='blocked'",
                              (self.clock(), event_id)).rowcount == 1

    def confirm(self, event_id, *, attendance_context=None):
        """Internal sender operation, ONLY after checking the bound server ACK."""
        now = self.clock()
        if attendance_context is not None:
            self._validate_key(attendance_context["occurrence_key"])
        with self._cooldown_lock:
            with self._transaction() as db:
                row = db.execute("SELECT * FROM events WHERE event_id=? AND status='pending'",
                                 (event_id,)).fetchone()
                if row is None:
                    return False
                event = json.loads(row["payload"])
                db.execute("UPDATE events SET status='acked',acked_at=?,last_error=NULL WHERE event_id=?",
                           (now, event_id))
                if attendance_context is not None:
                    key = attendance_context["occurrence_key"] or OUTSIDE_KEY
                    db.execute("UPDATE events SET attendance_key=? WHERE event_id=?", (key, event_id))
                db.execute("INSERT INTO confirmed_state VALUES (?,?,?) "
                           "ON CONFLICT(user_code) DO UPDATE SET event_type=excluded.event_type, "
                           "acked_at=excluded.acked_at", (event["user_code"], event["event_type"], now))
            self._cooldowns[event["user_code"]] = (now, self.monotonic(), 0.0)
        return True

    def state(self, user_code):
        with self._connect() as db:
            row = db.execute("SELECT * FROM confirmed_state WHERE user_code=?", (user_code,)).fetchone()
        return dict(row) if row else None

    def seed_last_state(self, state_map):
        # Remote endpoint has no timestamp/version. It must NOT overwrite a local
        # confirmed state or a pending user's baseline with a possibly stale value.
        with self._transaction() as db:
            for user_code, event_type in (state_map or {}).items():
                if event_type in ("check_in", "check_out"):
                    db.execute("INSERT OR IGNORE INTO confirmed_state "
                               "SELECT ?,?,NULL WHERE NOT EXISTS "
                               "(SELECT 1 FROM events WHERE user_code=? AND status!='acked')",
                               (user_code, event_type, user_code))

    def cooldown_remaining(self, user_code, seconds):
        with self._cooldown_lock:
            state = self.state(user_code)
            if not state or state["acked_at"] is None:
                return 0.0
            stamp = state["acked_at"]
            anchor = self._cooldowns.get(user_code)
            if anchor is None or anchor[0] != stamp:
                # Wall time reconstructs elapsed time ONCE after reopen. In-process
                # cooldown then uses monotonic time, immune to NTP/time-zone changes.
                elapsed = min(seconds, max(0.0, self.clock() - stamp))
                anchor = (stamp, self.monotonic(), elapsed)
                self._cooldowns[user_code] = anchor
            return max(0.0, seconds - anchor[2] - max(0.0, self.monotonic() - anchor[1]))
