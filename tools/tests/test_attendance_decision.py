"""Current check-in contract; original toggle results remain in Step 01 report.

Threshold=0.5 is a test fixture, NOT a calibrated recognition threshold.
Known safety gaps are checked separately by reproduce_attendance_known_issues.py.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from attendance_test_support import attendance, gallery_entry, unit_vector

Decision = attendance.AttendanceDecision


class MatchingTests(unittest.TestCase):
    def setUp(self):
        self.decision = Decision(similarity_threshold=0.5)
        self.query = unit_vector()

    def test_empty_gallery_has_no_candidate_or_match(self):
        self.assertIsNone(self.decision.best_match(self.query, []))
        self.assertIsNone(self.decision.match(self.query, []))

    def test_selects_highest_cosine_not_first_entry(self):
        entries = [gallery_entry("LOW", 0.2), gallery_entry("BEST", 0.9), gallery_entry("MID", 0.7)]
        entry, score = self.decision.best_match(self.query, entries)
        self.assertIs(entry, entries[1])
        self.assertAlmostEqual(score, 0.9)
        self.assertEqual(self.decision.match(self.query, entries)[0]["user_code"], "BEST")

    def test_best_candidate_below_threshold_is_not_a_match(self):
        entries = [gallery_entry("LOW", 0.25)]
        self.assertEqual(self.decision.best_match(self.query, entries)[0]["user_code"], "LOW")
        self.assertIsNone(self.decision.match(self.query, entries))

    def test_score_below_threshold(self):
        self.assertIsNone(self.decision.match(self.query, [gallery_entry("BELOW", 0.49)]))

    def test_score_exactly_at_threshold_is_accepted(self):
        self.assertEqual(self.decision.match(self.query, [gallery_entry("BOUNDARY", 0.5)])[1], 0.5)

    def test_score_above_threshold(self):
        self.assertEqual(self.decision.match(self.query, [gallery_entry("ABOVE", 0.51)])[0]["user_code"], "ABOVE")

    def test_unknown_does_not_change_attendance_state(self):
        entries = [gallery_entry("A", 0.1), gallery_entry("B", 0.2)]
        self.assertIsNone(self.decision.match(self.query, entries))
        self.assertEqual(self.decision._last_sent, {})
        self.assertEqual(self.decision._last_state, {})

    def test_gallery_of_thirty_synthetic_identities(self):
        entries = [gallery_entry(f"TEST{i:02d}", i / 40) for i in range(30)]
        result = self.decision.match(self.query, entries)
        self.assertEqual(result[0]["user_code"], "TEST29")
        self.assertAlmostEqual(result[1], 29 / 40)

    def test_equal_scores_keep_first_candidate_current_behavior(self):
        entries = [gallery_entry("FIRST", 0.8), gallery_entry("SECOND", 0.8)]
        self.assertIs(self.decision.best_match(self.query, entries)[0], entries[0])


class CooldownTests(unittest.TestCase):
    def setUp(self):
        self.decision = Decision(cooldown_seconds=60,
                                 now=lambda: datetime.fromisoformat('2026-10-12T12:30:00+07:00'))

    def test_first_event_is_allowed(self):
        self.assertTrue(self.decision.should_send("A"))

    def test_immediate_repeat_is_blocked(self):
        with patch.object(attendance.time, "monotonic", return_value=100.0):
            self.decision.mark_sent("A", "check_in")
            self.assertFalse(self.decision.should_send("A"))

    def test_before_at_and_after_boundary(self):
        with patch.object(attendance.time, "monotonic", return_value=100.0):
            self.decision.mark_sent("A", "check_in")
        for current, expected in [(159.999, False), (160.0, True), (160.001, True)]:
            with self.subTest(current=current), patch.object(attendance.time, "monotonic", return_value=current):
                self.assertEqual(self.decision.should_send("A"), expected)

    def test_cooldown_is_independent_per_user(self):
        with patch.object(attendance.time, "monotonic", return_value=100.0):
            self.decision.mark_sent("A", "check_in")
        with patch.object(attendance.time, "monotonic", return_value=130.0):
            self.assertFalse(self.decision.should_send("A"))
            self.assertTrue(self.decision.should_send("B"))
            self.decision.mark_sent("B", "check_in")
        with patch.object(attendance.time, "monotonic", return_value=160.0):
            self.assertTrue(self.decision.should_send("A"))
            self.assertFalse(self.decision.should_send("B"))


class StateTests(unittest.TestCase):
    def setUp(self):
        self.decision = Decision()

    def test_new_user_defaults_to_check_in(self):
        self.assertEqual(self.decision.next_event_type("A"), "check_in")

    def test_seed_check_in_still_proposes_check_in(self):
        self.decision.seed_last_state({"A": "check_in"})
        self.assertEqual(self.decision.next_event_type("A"), "check_in")

    def test_seed_check_out_proposes_check_in(self):
        self.decision.seed_last_state({"A": "check_out"})
        self.assertEqual(self.decision.next_event_type("A"), "check_in")

    def test_mark_sent_no_longer_toggles(self):
        with patch.object(attendance.time, "monotonic", return_value=100.0):
            self.decision.mark_sent("A", "check_in")
            self.assertEqual(self.decision.next_event_type("A"), "check_in")
            with self.assertRaises(ValueError):
                self.decision.mark_sent("A", "check_out")
            self.assertEqual(self.decision.next_event_type("A"), "check_in")

    def test_users_have_independent_state(self):
        self.decision.seed_last_state({"A": "check_in", "B": "check_out"})
        self.assertEqual(self.decision.next_event_type("A"), "check_in")
        self.assertEqual(self.decision.next_event_type("B"), "check_in")
        self.assertEqual(self.decision.next_event_type("C"), "check_in")

    def test_empty_seed_preserves_existing_state_current_behavior(self):
        self.decision.seed_last_state({"A": "check_in"})
        self.decision.seed_last_state(None)
        self.decision.seed_last_state({})
        self.assertEqual(self.decision._last_state, {"A":"check_in"})
        self.assertEqual(self.decision.next_event_type("A"), "check_in")


class EventPayloadTests(unittest.TestCase):
    def test_payload_keys_device_and_user(self):
        event = Decision.build_event("SYNTH_DEVICE", "TEST001", "check_in", 0.8)
        self.assertEqual(set(event), {"event_id", "device_id", "user_code", "event_type", "timestamp", "confidence"})
        self.assertEqual(event["device_id"], "SYNTH_DEVICE")
        self.assertEqual(event["user_code"], "TEST001")

    def test_event_ids_are_distinct_valid_uuid4(self):
        events = [Decision.build_event("SYNTH_DEVICE", "TEST001", "check_in", 0.8) for _ in range(2)]
        for event in events:
            identifier = uuid.UUID(event["event_id"])
            self.assertEqual(identifier.version, 4)
            self.assertEqual(identifier.variant, uuid.RFC_4122)
        self.assertNotEqual(events[0]["event_id"], events[1]["event_id"])

    def test_builder_checkin_only_rejects_checkout(self):
        self.assertEqual(Decision.build_event('D','U','check_in',0.8)['event_type'],'check_in')
        with self.assertRaises(ValueError):
            Decision.build_event('D','U','check_out',0.8)

    def test_timestamp_contains_timezone_and_second_precision(self):
        fixed = datetime(2026, 10, 10, 8, 9, 10, 123456, tzinfo=timezone(timedelta(hours=7)))
        with patch.object(attendance, "datetime", wraps=datetime) as clock:
            clock.now.return_value = fixed
            event = Decision.build_event("D", "U", "check_in", 0.8)
            clock.now.assert_called_once_with(attendance._VN_TZ)
        parsed = datetime.fromisoformat(event["timestamp"])
        self.assertEqual(parsed.utcoffset(), timedelta(hours=7))
        self.assertEqual(parsed.microsecond, 0)
        self.assertEqual(event["timestamp"], "2026-10-10T08:09:10+07:00")

    def test_confidence_is_rounded_score_times_100_not_probability(self):
        for score, percent in [(0.723456, 72.35), (0.0, 0.0), (1.0, 100.0), (0.005, 0.5)]:
            with self.subTest(score=score):
                self.assertEqual(Decision.build_event("D", "U", "check_in", score)["confidence"], percent)


if __name__ == "__main__":
    unittest.main()
