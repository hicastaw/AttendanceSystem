"""Real file-backed SQLite; synthetic metadata only, no config/.env/hardware."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import sqlite3
import sys
import tempfile
from pathlib import Path
import unittest
import uuid
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "AIOT/edge"))
sys.path.insert(0, str(ROOT / "tools"))
from outbox import DurableOutbox
from rpi_deployment import backup_database


def event(code="TEST001", event_id="synthetic-event-1", kind="check_in"):
    return dict(event_id=str(uuid.uuid5(uuid.NAMESPACE_URL, event_id)), user_code=code, device_id="SYNTH_DEVICE",
                event_type=kind, timestamp="2026-10-10T08:00:00+07:00", confidence=80)


class OutboxTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="aiot-outbox-test-")
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "outbox.db"
        self.now = 100.0
        self.mono = 100.0
        self.store = self.reopen()

    def reopen(self):
        return DurableOutbox(self.path, clock=lambda: self.now, monotonic=lambda: self.mono)

    def test_persist_payload_and_reservation_before_transport(self):
        self.assertEqual(self.store.enqueue(event()), "queued")
        reopened = self.reopen()
        self.assertEqual(reopened.next_due()["event"], event())
        self.assertEqual(reopened.reservation("TEST001"), "pending")
        self.assertIsNone(reopened.state("TEST001"))

    def test_duplicate_uuid_is_idempotent_and_payload_immutable(self):
        self.store.enqueue(event())
        self.assertEqual(self.store.enqueue(event()), "already_pending")
        with self.assertRaisesRegex(ValueError, "immutable"):
            self.store.enqueue({**event(), "confidence": 90})
        self.assertEqual(self.store.counts()["pending"], 1)

    def test_reservation_is_independent_per_person(self):
        self.store.enqueue(event())
        self.assertEqual(self.store.enqueue(event(event_id="second")), "reserved")
        self.assertEqual(self.store.enqueue(event("TEST002", "third")), "queued")
        self.assertEqual(self.store.counts()["pending"], 2)

    def test_concurrent_enqueue_only_one_reservation(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda n: self.store.enqueue(event(event_id=f"event-{n}")), range(4)))
        self.assertEqual(results.count("queued"), 1)
        self.assertEqual(results.count("reserved"), 3)

    def test_no_ram_queue_capacity_drops_burst(self):
        for i in range(75):
            self.assertEqual(self.store.enqueue(event(f"TEST{i:03}", f"burst-{i}")), "queued")
        self.assertEqual(self.reopen().counts()["pending"], 75)

    def test_retry_schedule_and_attempts_survive_reopen(self):
        self.store.enqueue(event())
        self.store.begin_attempt(event()["event_id"])
        self.store.defer(event()["event_id"], "transport_error", 5)
        reopened = self.reopen()
        self.assertIsNone(reopened.next_due())
        self.assertEqual(reopened.get(event()["event_id"])["attempts"], 1)
        self.now = 105
        self.assertEqual(reopened.next_due()["event"], event())

    def test_ack_and_state_persist_cooldown_boundary_and_duplicate_ack(self):
        self.store.enqueue(event())
        self.now = self.mono = 120
        self.assertTrue(self.store.confirm(event()["event_id"]))
        reopened = self.reopen()
        self.assertEqual(reopened.reservation("TEST001"), None)
        self.assertEqual(reopened.state("TEST001")["event_type"], "check_in")
        self.assertEqual(reopened.cooldown_remaining("TEST001", 60), 60)
        self.mono = 179.999
        self.assertGreater(reopened.cooldown_remaining("TEST001", 60), 0)
        self.mono = 180
        self.assertEqual(reopened.cooldown_remaining("TEST001", 60), 0)
        self.assertFalse(reopened.confirm(event()["event_id"]))
        self.assertEqual(reopened.enqueue(event()), "already_acked")

    def test_transaction_rolls_back_ack_if_state_update_fails(self):
        self.store.enqueue(event())
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("CREATE TRIGGER reject_state BEFORE INSERT ON confirmed_state "
                       "BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.confirm(event()["event_id"])
        self.assertEqual(self.reopen().get(event()["event_id"])["status"], "pending")
        self.assertIsNone(self.store.state("TEST001"))

    def test_storage_failure_is_visible_and_does_not_confirm(self):
        with patch.object(self.store, "_connect", side_effect=sqlite3.OperationalError("disk full")):
            with self.assertRaises(sqlite3.OperationalError):
                self.store.enqueue(event())
        self.assertEqual(self.reopen().counts()["pending"], 0)
        self.assertIsNone(self.store.state("TEST001"))

    def test_blocked_event_keeps_reservation_then_operator_requeues_same_id(self):
        self.store.enqueue(event())
        self.store.defer(event()["event_id"], "http_401", 0, blocked=True)
        reopened = self.reopen()
        self.assertIsNone(reopened.next_due())
        self.assertEqual(reopened.reservation("TEST001"), "blocked")
        self.assertEqual(reopened.enqueue(event(event_id="new")), "reserved")
        self.assertTrue(reopened.requeue_blocked(event()["event_id"]))
        self.assertEqual(reopened.next_due()["event"], event())

    def test_stale_remote_seed_cannot_override_local_confirmed_state(self):
        self.store.seed_last_state({"TEST001": "check_out"})
        self.store.enqueue(event())
        self.store.confirm(event()["event_id"])
        self.reopen().seed_last_state({"TEST001": "check_out", "TEST002": "check_in"})
        self.assertEqual(self.store.state("TEST001")["event_type"], "check_in")
        self.assertEqual(self.store.state("TEST002")["event_type"], "check_in")

    def test_monotonic_cooldown_ignores_wall_clock_jump(self):
        self.store.enqueue(event())
        self.store.confirm(event()["event_id"])
        self.now = 1e9
        self.mono += 1
        self.assertEqual(self.store.cooldown_remaining("TEST001", 60), 59)

    def test_reopen_clock_rollback_is_conservative(self):
        self.store.enqueue(event())
        self.store.confirm(event()["event_id"])
        self.now = 1
        self.assertEqual(self.reopen().cooldown_remaining("TEST001", 60), 60)

    def test_remote_snapshot_cannot_confirm_pending_event_without_bound_ack(self):
        self.store.enqueue(event())
        self.reopen().seed_last_state({"TEST001": "check_in"})
        self.assertIsNone(self.store.state("TEST001"))
        self.assertEqual(self.store.reservation("TEST001"), "pending")

    def test_refuse_different_device_and_unknown_schema(self):
        self.store.enqueue(event())
        with self.assertRaisesRegex(ValueError, "different device"):
            self.store.enqueue({**event("TEST002", "second"), "device_id": "OTHER"})
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("PRAGMA user_version=99")
        with self.assertRaisesRegex(RuntimeError, "schema"):
            self.reopen()

    def test_refuse_non_outbox_database_without_adding_tables(self):
        other = Path(self.temp.name) / "unrelated.db"
        with closing(sqlite3.connect(other)) as db, db:
            db.execute("CREATE TABLE unrelated(value TEXT)")
        with self.assertRaisesRegex(RuntimeError, "not an outbox"):
            DurableOutbox(other)
        with closing(sqlite3.connect(other)) as db:
            self.assertEqual(db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall(),
                             [("unrelated",)])

    def test_invalid_metadata_and_extra_biometrics_are_not_persisted(self):
        invalid = [{**event(), "event_id": "bad"}, {**event(), "timestamp": "2026-10-10T08:00:00"},
                   {**event(), "confidence": float("nan")}, {**event(), "confidence": 101},
                   {**event(), "embedding": [0.1]}, {**event(), "user_code": "lowercase"}]
        for payload in invalid:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                self.store.enqueue(payload)
        self.assertEqual(self.store.counts()["pending"], 0)

    def test_online_backup_preserves_pending_and_confirmed_ledger(self):
        self.store.enqueue(event())
        self.store.confirm(event()["event_id"])
        pending = event("TEST002", "second")
        self.store.enqueue(pending)
        destination = Path(self.temp.name) / "edge-outbox-backup.db"
        self.assertEqual(backup_database(self.path, destination)["integrity_check"], "ok")
        restored = DurableOutbox(destination, clock=lambda: self.now)
        self.assertEqual(restored.next_due()["event"], pending)
        self.assertEqual(restored.reservation("TEST002"), "pending")
        self.assertEqual(restored.state("TEST001")["event_type"], "check_in")


if __name__ == "__main__":
    unittest.main()
