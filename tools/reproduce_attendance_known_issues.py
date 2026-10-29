"""KI01-KI05 acceptance; scheduled check-in only, not HIL/production data.

No xfail/hidden skip. Real SQLite in temp directories, mocked HTTP and actual
dispatch/refresh AST. Never imports config, main, camera or .env.
"""
import logging
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

import numpy as np
from attendance_test_support import gallery_entry, production_main_block
sys.path.insert(0, str(Path(__file__).resolve().parent / "tests"))
from test_outbox_delivery import DeliveryFixture, DeliveryTests, ack
from member_gallery import MemberGallery, GalleryFetchResult


class KnownIssueAcceptanceTests(DeliveryFixture):
    def test_KI01_state_and_cooldown_must_wait_for_ack(self):
        DeliveryTests.test_dispatch_persists_pending_without_confirming_or_starting_cooldown(self)

    def test_KI02_retry_exhaustion_must_keep_event_pending(self):
        DeliveryTests.test_retry_same_immutable_payload_and_uuid_without_exhaustion(self)

    def test_KI03_no_ram_capacity_drop(self):
        for i in range(75):
            self.assertEqual(self.client.send_event_async(self.event(f"TEST{i:03}")), "queued")
        self.client._send_session.post.assert_not_called()
        self.assertEqual(self.store.counts()["pending"], 75)
        self.assertEqual(type(self.store)(self.path).counts()["pending"], 75)

    def test_KI04_successful_empty_gallery_must_clear_old_users(self):
        gallery = MemberGallery(Path(self.temp.name) / "member-gallery.json",
                                source=self.client.base_url, clock=lambda: self.now)
        old = gallery_entry("DEACTIVATED", 0.8)
        old["embedding"] = old["embedding"].tolist()
        gallery.refresh(SimpleNamespace(get_face_data=lambda: GalleryFetchResult(True, data=[old])))
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"status": "success", "data": []}
        self.client._session.get.side_effect = None
        self.client._session.get.return_value = response
        ns = dict(np=np, api_client=self.client, gallery=gallery, config=SimpleNamespace(FACE_DATA_REFRESH_SECONDS=300),
                  now=301.0, last_face_data_refresh=0.0,
                  known_embeddings=[gallery_entry("DEACTIVATED", 0.8)],
                  state=SimpleNamespace(server_reachable=False), logger=logging.getLogger("step02.gallery"))
        exec(production_main_block("refresh"), ns)
        self.assertEqual([item["user_code"] for item in ns["known_embeddings"]], [],
                         "KI04: valid data=[] must remove DEACTIVATED user")
        restored = MemberGallery(gallery.path, source=self.client.base_url, clock=lambda: self.now)
        self.assertTrue(restored.restore())
        self.assertEqual(restored.entries, [])

    def test_KI05_continuous_presence_must_not_generate_automatic_check_out(self):
        event = self.dispatch()["event"]
        self.client._send_session.post.side_effect = None
        self.client._send_session.post.return_value = ack(event)
        self.client.run_once()
        self.assertEqual(self.store.get(event["event_id"])["status"], "acked")
        self.now = 160.0
        self.dispatch()  # No departure/explicit action since previous detection.
        pending = self.store.next_due()
        self.assertEqual([] if pending is None else [pending["event"]["event_type"]], [],
                         "KI05: continuous presence after cooldown still creates automatic check_out")


if __name__ == "__main__":
    print("Acceptance: KI01-KI05 with scheduled check-in-only (not HIL).", flush=True)
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(KnownIssueAcceptanceTests)
    sys.exit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
