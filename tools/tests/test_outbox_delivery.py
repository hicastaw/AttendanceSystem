"""Transport is mocked; real sender/decision/SQLite/dispatch logic runs."""
import logging
from datetime import datetime
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from attendance_test_support import ROOT, attendance, production_main_block
from api_client import ApiClient
from outbox import DurableOutbox
from recovery import Recovery, RecoveryExhausted


def ack(event, *, duplicate=False):
    response = Mock(status_code=200)
    response.json.return_value = {"status": "success", "duplicate": duplicate,
                                  "data": {k: event[k] for k in
                                           ("event_id", "user_code", "event_type", "timestamp")}}
    return response


class DeliveryFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="aiot-delivery-test-")
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "outbox.db"
        self.now = 100.0
        # Keep calendar time independent of transport/cooldown deadline fixtures.
        # Event rollover is exercised explicitly in test_event_attendance.py.
        self.civil_time = datetime.fromisoformat('2026-10-10T08:00:00+07:00')
        self.store = DurableOutbox(self.path, clock=lambda: self.now, monotonic=lambda: self.now)
        self.client = self.make_client(self.store)
        self.decision = attendance.AttendanceDecision(cooldown_seconds=60, outbox=self.store, now=self.attendance_now)

    def attendance_now(self):
        return self.civil_time

    def make_client(self, store):
        client = ApiClient("http://127.0.0.1:1", outbox=store)
        client._session.get = Mock(side_effect=AssertionError("Unexpected network GET"))
        client._send_session.post = Mock(side_effect=AssertionError("Unexpected network POST"))
        self.addCleanup(client.stop)
        return client

    def event(self, code="TEST001", kind="check_in"):
        return self.decision.build_event("SYNTH_DEVICE", code, kind, 0.8, timestamp=self.attendance_now())

    def dispatch(self, code="TEST001"):
        ns = dict(decision=self.decision, api_client=self.client,
                  config=SimpleNamespace(DEVICE_ID="SYNTH_DEVICE"), user_code=code,
                  entry={"full_name": "Synthetic User"}, score=0.8, sqlite3=sqlite3,
                  logger=logging.getLogger("test.dispatch"))
        ns.update(recovery=Recovery(attempts=2,sleep=lambda _:None),state=SimpleNamespace(storage_ok=True))
        exec(production_main_block("dispatch"), ns)
        return ns


class DeliveryTests(DeliveryFixture):
    def test_dispatch_persists_pending_without_confirming_or_starting_cooldown(self):
        ns = self.dispatch()
        self.assertEqual(ns["att_status"], "pending")
        self.assertIsNone(self.store.state("TEST001"))
        self.assertEqual(self.store.cooldown_remaining("TEST001", 60), 0)
        self.assertEqual(self.decision.next_event_type("TEST001"), "check_in")
        self.assertFalse(self.decision.should_send("TEST001"))  # reservation, NOT cooldown
        self.client._send_session.post.assert_not_called()

    def test_repeated_dispatch_while_pending_does_not_create_extra_uuid(self):
        first = self.dispatch()["event"]
        self.now = 1e6  # Even when offline much longer than configured cooldown.
        second = self.dispatch()
        self.assertEqual(second["att_status"], "pending")
        self.assertEqual(self.store.counts()["pending"], 1)
        self.assertEqual(self.store.next_due()["event"], first)

    def test_ack_changes_state_and_starts_cooldown_at_ack_not_enqueue(self):
        event = self.dispatch()["event"]
        self.now = 1000
        self.client._send_session.post.side_effect = None
        self.client._send_session.post.return_value = ack(event)
        self.assertTrue(self.client.run_once())
        self.assertEqual(self.store.state("TEST001")["acked_at"], 1000)
        self.assertEqual(self.decision.next_event_type("TEST001"), "check_in")
        self.assertEqual(self.decision.delivery_status("TEST001"), "confirmed")
        self.assertTrue(self.decision.should_send("TEST002"))
        self.now = 1059.999
        self.assertFalse(self.decision.should_send("TEST001"))
        self.now = 1060
        self.assertEqual(self.store.cooldown_remaining('TEST001',60),0)
        self.assertFalse(self.decision.should_send("TEST001"))  # Same occurrence remains confirmed.

    def test_legacy_pre_ack_mark_is_rejected_in_production_mode(self):
        with self.assertRaisesRegex(RuntimeError, "validated sender ACK"):
            self.decision.mark_sent("TEST001", "check_in")
        self.assertIsNone(self.store.state("TEST001"))

    def test_retry_same_immutable_payload_and_uuid_without_exhaustion(self):
        event = self.event()
        self.client.send_event_async(event)
        event["confidence"] = 1  # Caller mutation cannot alter persisted payload.
        self.client._send_session.post.side_effect = __import__("requests").ConnectionError("offline")
        for expected_attempt in range(1, 9):
            before = self.now
            self.assertTrue(self.client.run_once())
            row = self.store.get(event["event_id"])
            self.assertEqual(row["status"], "pending")
            self.assertEqual(row["attempts"], expected_attempt)
            self.assertEqual(row["next_retry"] - before, min(60, 2 ** (expected_attempt - 1)))
            self.assertIsNone(self.store.state("TEST001"))
            self.assertFalse(self.client.run_once())
            self.now = row["next_retry"]
        payloads = [call.kwargs["json"] for call in self.client._send_session.post.call_args_list]
        self.assertTrue(all(p == payloads[0] for p in payloads))
        self.assertEqual(payloads[0]["confidence"], 80)

    def test_reopen_replays_same_uuid_and_accepts_duplicate_ack(self):
        event = self.dispatch()["event"]
        reopened = DurableOutbox(self.path, clock=lambda: self.now, monotonic=lambda: self.now)
        other = self.make_client(reopened)
        decision = attendance.AttendanceDecision(outbox=reopened, now=self.attendance_now)
        self.assertFalse(decision.should_send("TEST001"))
        other._send_session.post.side_effect = None
        other._send_session.post.return_value = ack(event, duplicate=True)
        other.run_once()
        self.assertEqual(other._send_session.post.call_args.kwargs["json"], event)
        self.assertEqual(reopened.counts(), {"pending": 0, "blocked": 0, "acked": 1})
        self.assertEqual(decision.next_event_type("TEST001"), "check_in")

    def test_invalid_ack_never_confirms(self):
        event = self.event()
        self.client.send_event_async(event)
        valid = ack(event).json.return_value
        invalid = [None, [], {}, {**valid, "status": "error"}, {**valid, "duplicate": "true"}]
        invalid += [{**valid, "data": {**valid["data"], k: "WRONG"}}
                    for k in ("event_id", "user_code", "event_type", "timestamp")]
        for body in invalid:
            with self.subTest(body=body):
                self.client._send_session.post.side_effect = None
                self.client._send_session.post.return_value = Mock(status_code=200, json=Mock(return_value=body))
                self.client.run_once()
                row = self.store.get(event["event_id"])
                self.assertEqual(row["status"], "pending")
                self.assertEqual(row["last_error"], "invalid_ack")
                self.assertIsNone(self.store.state("TEST001"))
                self.now = row["next_retry"]

    def test_bad_json_is_retryable_not_confirmed(self):
        event = self.event()
        self.client.send_event_async(event)
        self.client._send_session.post.side_effect = None
        self.client._send_session.post.return_value = Mock(status_code=200, json=Mock(side_effect=ValueError("bad json")))
        self.client.run_once()
        self.assertEqual(self.store.get(event["event_id"])["status"], "pending")
        self.assertIsNone(self.store.state("TEST001"))

    def test_permanent_http_error_blocks_only_that_user_and_preserves_event(self):
        first = self.event()
        second = self.event("TEST002")
        self.client.send_event_async(first)
        self.client.send_event_async(second)
        self.client._send_session.post.side_effect = [Mock(status_code=401), ack(second)]
        self.client.run_once()
        self.client.run_once()
        self.assertEqual(self.store.get(first["event_id"])["status"], "blocked")
        self.assertEqual(self.decision.delivery_status("TEST001"), "blocked")
        self.assertFalse(self.decision.should_send("TEST001"))
        self.assertEqual(self.store.get(second["event_id"])["status"], "acked")
        self.assertTrue(self.store.requeue_blocked(first["event_id"]))
        self.client._send_session.post.side_effect = None
        self.client._send_session.post.return_value = ack(first)
        self.client.run_once()
        self.assertEqual(self.store.get(first["event_id"])["status"], "acked")

    def test_transient_http_errors_keep_retrying(self):
        event = self.event()
        self.client.send_event_async(event)
        for status in (408, 429, 500, 503):
            self.client._send_session.post.side_effect = None
            self.client._send_session.post.return_value = Mock(status_code=status)
            self.client.run_once()
            row = self.store.get(event["event_id"])
            self.assertEqual(row["status"], "pending")
            self.now = row["next_retry"]

    def test_local_commit_failure_after_ack_is_replayed_not_lost(self):
        event = self.event()
        self.client.send_event_async(event)
        self.client._send_session.post.side_effect = None
        self.client._send_session.post.return_value = ack(event)
        with patch.object(self.store, "confirm", side_effect=sqlite3.OperationalError("disk failure")):
            with self.assertRaises(sqlite3.OperationalError):
                self.client.run_once()
        self.assertEqual(self.store.get(event["event_id"])["status"], "pending")
        self.assertIsNone(self.store.state("TEST001"))
        self.client._send_session.post.return_value = ack(event, duplicate=True)
        self.client.run_once()
        self.assertEqual(self.store.get(event["event_id"])["status"], "acked")

    def test_disk_full_dispatch_does_not_claim_pending_or_confirmed(self):
        with patch.object(self.store, "enqueue", side_effect=sqlite3.OperationalError("disk full")) as enqueue:
            with self.assertRaises(RecoveryExhausted):self.dispatch()
            self.assertEqual(enqueue.call_count,2)
        self.assertEqual(self.store.counts()["pending"], 0)
        self.assertIsNone(self.store.state("TEST001"))
        self.client._send_session.post.assert_not_called()

    def test_worker_replays_on_start_and_stop_keeps_offline_pending(self):
        event = self.event()
        self.client.send_event_async(event)
        attempted = threading.Event()
        def offline(*args, **kwargs):
            attempted.set()
            raise __import__("requests").ConnectionError("offline")
        self.client._send_session.post.side_effect = offline
        self.client.start()
        self.assertTrue(attempted.wait(3), "Worker did not replay on startup")
        self.assertTrue(self.client.stop())
        self.assertEqual(DurableOutbox(self.path).get(event["event_id"])["status"], "pending")

    def test_abrupt_process_exit_after_commit_replays_from_disk(self):
        event = self.event()
        import json
        script = """import sys,json,os
sys.path.insert(0,sys.argv[1])
from outbox import DurableOutbox
DurableOutbox(sys.argv[2]).enqueue(json.loads(sys.argv[3]))
os._exit(23)
"""
        child = subprocess.run([sys.executable, "-c", script, str(ROOT / "AIOT/edge"),
                                str(self.path), json.dumps(event)], cwd=self.temp.name,
                               capture_output=True, text=True, timeout=10)
        self.assertEqual(child.returncode, 23, child.stderr)
        self.assertEqual(DurableOutbox(self.path).next_due()["event"], event)
        self.now = 2e9
        self.client._send_session.post.side_effect = None
        self.client._send_session.post.return_value = ack(event)
        self.client.run_once()
        self.assertEqual(self.store.state("TEST001")["event_type"], "check_in")


if __name__ == "__main__":
    unittest.main()
