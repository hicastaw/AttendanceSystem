"""Kiểm thử offline-first: LocalStore (SQLite) + SyncService với server giả lập."""
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import requests

import main
from local_store import LocalStore
from sync_service import SyncService


def make_event(user_code="NV001", event_type="check_in", timestamp="2026-11-06T08:00:00+07:00"):
    return {"event_id": str(uuid.uuid4()), "device_id": "TEST_PI", "user_code": user_code,
            "event_type": event_type, "timestamp": timestamp, "confidence": 90.0}


class LocalStoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "edge.db"
        self.store = LocalStore(self.path)

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def test_event_and_person_state_survive_restart(self):
        event = make_event()
        self.store.record_event(event)
        self.store.close()
        self.store = LocalStore(self.path)
        self.assertEqual(self.store.last_states(), {"NV001": "check_in"})
        pending = self.store.pending_events()
        self.assertEqual([e["event_id"] for e in pending], [event["event_id"]])
        self.assertEqual(pending[0]["timestamp"], event["timestamp"])

    def test_duplicate_event_id_rolls_back_state_change(self):
        event = make_event()
        self.store.record_event(event)
        with self.assertRaises(Exception):
            self.store.record_event({**event, "event_type": "check_out"})
        self.assertEqual(self.store.last_states(), {"NV001": "check_in"})
        self.assertEqual(self.store.event_counts()["pending"], 1)

    def test_pending_ordered_by_time_and_status_transitions(self):
        late = make_event(timestamp="2026-11-06T09:00:00+07:00")
        early = make_event(user_code="NV002", timestamp="2026-11-06T08:00:00+07:00")
        self.store.record_event(late)
        self.store.record_event(early)
        self.assertEqual([e["event_id"] for e in self.store.pending_events()],
                         [early["event_id"], late["event_id"]])
        self.store.mark_synced([early["event_id"]])
        self.store.mark_rejected(late["event_id"], "unknown user")
        self.assertEqual(self.store.event_counts(), {"pending": 0, "rejected": 1})
        self.assertEqual(self.store.pending_events(), [])

    def test_synced_event_is_deleted_but_person_state_kept(self):
        event = make_event()
        self.store.record_event(event)
        self.store.mark_synced([event["event_id"]])
        rows = self.store._conn.execute("SELECT COUNT(*) FROM access_events").fetchone()[0]
        self.assertEqual(rows, 0)
        self.assertEqual(self.store.last_states(), {"NV001": "check_in"})

    def test_seed_states_does_not_override_local(self):
        self.store.record_event(make_event(event_type="check_out"))
        self.store.seed_states({"NV001": "check_in", "NV002": "check_in", "BAD": "nonsense"})
        self.assertEqual(self.store.last_states(), {"NV001": "check_out", "NV002": "check_in"})

    def test_face_cache_keeps_previous_for_rollback(self):
        self.assertIsNone(self.store.load_face_data())
        self.store.save_face_data([{"user_code": "A"}], {"preprocessing": "p"}, "v1")
        self.store.save_face_data([{"user_code": "B"}], {"preprocessing": "p"}, "v2")
        self.assertEqual(self.store.load_face_data()["version"], "v2")
        self.assertEqual(self.store.load_face_data()["data"], [{"user_code": "B"}])
        self.assertEqual(self.store.load_face_data("previous")["version"], "v1")

    def test_prune_only_removes_old_rejected(self):
        rejected, pending = make_event(), make_event(user_code="NV002")
        self.store.record_event(rejected)
        self.store.record_event(pending)
        self.store.mark_rejected(rejected["event_id"], "unknown user")
        self.assertEqual(self.store.prune_rejected(retention_days=1), 0)  # vừa bị từ chối, chưa cũ
        self.assertEqual(self.store.prune_rejected(retention_days=-1), 1)
        self.assertEqual(self.store.event_counts(), {"pending": 1, "rejected": 0})


class SyncServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = LocalStore(Path(self.tmp.name) / "edge.db")
        self.api = MagicMock()
        self.sync = SyncService(self.store, self.api, "TEST_PI", batch_size=2)

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def test_offline_keeps_events_pending_then_syncs_after_reconnect(self):
        events = [make_event(user_code=f"NV00{i}") for i in range(3)]
        for event in events:
            self.store.record_event(event)

        self.api.send_events_batch.side_effect = requests.ConnectionError("server down")
        with self.assertRaises(requests.RequestException):
            self.sync.sync_once()
        self.assertEqual(self.store.event_counts()["pending"], 3)
        self.assertIn("server down", self.sync.last_sync_error)

        self.api.send_events_batch.side_effect = lambda device_id, batch: [
            {"event_id": e["event_id"], "result": "accepted"} for e in batch]
        self.assertFalse(self.sync.sync_once())   # lô đầy (2) -> còn nữa
        self.assertTrue(self.sync.sync_once())    # lô cuối (1)
        self.assertEqual(self.store.event_counts(), {"pending": 0, "rejected": 0})
        self.assertIsNone(self.sync.last_sync_error)

    def test_duplicate_is_cleared_and_rejected_is_not_retried(self):
        ok, dup, bad = make_event(), make_event(user_code="NV002"), make_event(user_code="GHOST")
        for event in (ok, dup, bad):
            self.store.record_event(event)
        self.api.send_events_batch.side_effect = lambda device_id, batch: [
            {"event_id": e["event_id"],
             "result": {ok["event_id"]: "accepted", dup["event_id"]: "duplicate"}.get(e["event_id"], "rejected"),
             "reason": "Không tìm thấy người dùng"} for e in batch]
        while not self.sync.sync_once():
            pass
        self.assertEqual(self.store.event_counts(), {"pending": 0, "rejected": 1})

    def test_missing_result_keeps_event_pending(self):
        event = make_event()
        self.store.record_event(event)
        self.api.send_events_batch.return_value = []
        self.sync.sync_once()
        self.assertEqual([e["event_id"] for e in self.store.pending_events()], [event["event_id"]])

    def test_heartbeat_triggers_face_reload_only_when_version_changes(self):
        changed = MagicMock()
        sync = SyncService(self.store, self.api, "TEST_PI", face_data_version=lambda: "v1",
                           on_face_data_changed=changed)
        self.api.send_heartbeat.return_value = {"face_data_version": "v1"}
        sync._heartbeat()
        changed.assert_not_called()
        self.api.send_heartbeat.return_value = {"face_data_version": "v2"}
        sync._heartbeat()
        changed.assert_called_once()
        payload = self.api.send_heartbeat.call_args.args[0]
        self.assertEqual(payload["device_id"], "TEST_PI")
        self.assertEqual(payload["pending_events"], 0)

    def test_heartbeat_offline_does_not_trigger_reload(self):
        changed = MagicMock()
        sync = SyncService(self.store, self.api, "TEST_PI", on_face_data_changed=changed)
        self.api.send_heartbeat.return_value = None
        sync._heartbeat()
        changed.assert_not_called()


class RecordEventInPipeline(unittest.TestCase):
    def test_failed_local_write_does_not_toggle_state(self):
        from attendance_service import AttendanceDecision
        embedding = np.zeros(512, np.float32)
        embedding[0] = 1
        detector, recognizer = MagicMock(), MagicMock()
        detector.detect.return_value = [np.array([100, 100, 100, 120, 120, 130, 170, 130,
                                                  145, 150, 125, 180, 165, 180, .95], np.float32)]
        recognizer.get_embedding.return_value = embedding
        decision = AttendanceDecision(.6, 60)
        known = [{"user_code": "NV001", "full_name": "Test", "embedding": embedding}]
        frame = np.zeros((480, 640, 3), np.uint8)

        failing = MagicMock(side_effect=OSError("disk full"))
        result = main.infer_faces(frame, detector, recognizer, decision, known, failing, attendance_enabled=True)
        self.assertEqual(result[0]["status"], "record_failed")
        self.assertEqual(decision._last_state, {})

        recorded = MagicMock()
        result = main.infer_faces(frame, detector, recognizer, decision, known, recorded, attendance_enabled=True)
        self.assertEqual(result[0]["status"], "sent")
        self.assertEqual(recorded.call_args.args[0]["event_type"], "check_in")
        self.assertEqual(decision._last_state, {"NV001": "check_in"})


class DailyToggleReset(unittest.TestCase):
    def test_first_scan_each_day_is_check_in(self):
        from attendance_service import AttendanceDecision
        decision = AttendanceDecision(.6, 60)
        # Hôm qua quên quét RA: trạng thái cuối là check_in.
        decision.seed_last_state({"NV001": "check_in"}, {"NV001": "2026-11-05"})
        self.assertEqual(decision.next_event_type("NV001", today="2026-11-06"), "check_in")
        decision.mark_sent("NV001", "check_in", today="2026-11-06")
        self.assertEqual(decision.next_event_type("NV001", today="2026-11-06"), "check_out")
        decision.mark_sent("NV001", "check_out", today="2026-11-06")
        self.assertEqual(decision.next_event_type("NV001", today="2026-11-06"), "check_in")

    def test_seed_without_day_is_treated_as_old(self):
        from attendance_service import AttendanceDecision
        decision = AttendanceDecision(.6, 60)
        decision.seed_last_state({"NV001": "check_in"})
        self.assertEqual(decision.next_event_type("NV001", today="2026-11-06"), "check_in")

    def test_store_keeps_event_day_and_server_seed_time(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = LocalStore(Path(tmp) / "edge.db")
            store.record_event(make_event(timestamp="2026-11-06T08:00:00+07:00"))
            store.seed_states({"NV002": "check_in", "NV003": "check_out"},
                              {"NV002": "2026-11-05T17:00:00+07:00"})
            self.assertEqual(store.last_state_days(),
                             {"NV001": "2026-11-06", "NV002": "2026-11-05", "NV003": "1970-01-01"})
            store.close()


if __name__ == "__main__":
    unittest.main()
