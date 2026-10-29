"""Synthetic 30-member fixtures, real gallery/HTTP adapter/AST/cache persistence.

No config/.env, camera, person images, actual enrollment or live member DB.
"""
import json
import logging
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from attendance_test_support import ROOT, attendance, production_main_block, production_gallery_startup
from api_client import ApiClient
from member_gallery import LEGACY_MBF_CONTRACT, GalleryFetchResult, MemberGallery


def members(count=30):
    data = []
    for i in range(count):
        vector = np.zeros(512)
        vector[i] = 2.0
        data.append(dict(user_code=f"TEST{i + 1:03}", full_name=f"Synthetic member {i + 1}",
                         embedding=vector.tolist()))
    return data


class GalleryFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="aiot-member-gallery-test-")
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "member-gallery.json"
        self.now = 1000.0
        self.client = ApiClient("http://127.0.0.1:1", outbox_path=Path(self.temp.name) / "outbox.db")
        self.addCleanup(self.client.stop)
        self.client._session.get = Mock(side_effect=AssertionError("Unexpected network"))
        self.client._send_session.post = Mock(side_effect=AssertionError("Unexpected network"))
        self.gallery = self.new_gallery()

    def new_gallery(self, **kwargs):
        return MemberGallery(self.path, source=self.client.base_url, clock=lambda: self.now,
                             **kwargs)

    def respond(self, data, *, contract=None):
        body = dict(status="success", data=data)
        if contract is not None:
            body["embedding_contract"] = contract
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = body
        self.client._session.get.side_effect = None
        self.client._session.get.return_value = response

    def seed(self, data=None):
        self.respond(members() if data is None else data)
        self.assertTrue(self.gallery.refresh(self.client))

    def refresh_ast(self):
        ns = dict(api_client=self.client, gallery=self.gallery,
                  config=SimpleNamespace(FACE_DATA_REFRESH_SECONDS=300), now=301,
                  last_face_data_refresh=0,
                  known_embeddings=self.gallery.entries,
                  state=SimpleNamespace(server_reachable=False, gallery_status={}),
                  logger=logging.getLogger("test.gallery.refresh"))
        exec(production_main_block("refresh"), ns)
        return ns


class GalleryFetchTests(GalleryFixture):
    def test_success_empty_distinct_from_failure(self):
        self.respond([])
        result = self.client.get_face_data()
        self.assertTrue(result.success)
        self.assertEqual(result.data, [])
        self.client._session.get.side_effect = requests.Timeout("synthetic offline")
        result = self.client.get_face_data()
        self.assertFalse(result.success)
        self.assertIsNone(result.data)

    def test_http_error_is_failure_not_empty(self):
        self.respond([])
        self.client._session.get.return_value.raise_for_status.side_effect = requests.HTTPError("503")
        result = self.client.get_face_data()
        self.assertFalse(result.success)
        self.assertIsNone(result.data)

    def test_missing_data_status_and_wrong_envelope_are_failures(self):
        for body in ({"status": "success"}, {"status": "success", "data": None},
                     {"status": "error", "data": []}, {"data": []},
                     {"status": "success", "data": {}}, [], None):
            with self.subTest(body=body):
                self.respond([])
                self.client._session.get.return_value.json.return_value = body
                result = self.client.get_face_data()
                self.assertFalse(result.success)
                self.assertIsNone(result.data)

    def test_invalid_json_is_failure_not_empty(self):
        for error in (ValueError("invalid JSON"), requests.exceptions.JSONDecodeError("invalid JSON", "bad", 0)):
            self.respond([])
            self.client._session.get.return_value.json.side_effect = error
            result = self.client.get_face_data()
            self.assertFalse(result.success)
            self.assertEqual(result.error, "gallery_invalid_json")
            self.assertTrue(self.client.server_reachable)

    def test_explicit_invalid_contract_is_not_metadata_less_legacy(self):
        for contract in (None, "mbf", []):
            self.respond([])
            self.client._session.get.return_value.json.return_value["embedding_contract"] = contract
            self.assertFalse(self.client.get_face_data().success)


class GalleryLifecycleTests(GalleryFixture):
    def test_thirty_members_normalized_and_real_cosine_matches(self):
        self.seed()
        self.assertEqual(len(self.gallery.entries), 30)
        decision = attendance.AttendanceDecision(similarity_threshold=0.5)
        for i, entry in enumerate(self.gallery.entries):
            self.assertAlmostEqual(float(np.linalg.norm(entry["embedding"])), 1)
            match = decision.match(entry["embedding"], self.gallery.entries)
            self.assertEqual(match[0]["user_code"], f"TEST{i + 1:03}")
            self.assertAlmostEqual(match[1], 1)

    def test_production_refresh_valid_empty_clears_ram_and_disk(self):
        self.seed()
        old_version = self.gallery.version
        self.respond([])
        ns = self.refresh_ast()
        self.assertEqual(ns["known_embeddings"], [])
        self.assertEqual(ns["state"].gallery_status["member_count"], 0)
        self.assertEqual(ns["last_face_data_refresh"], 301)
        self.assertNotEqual(self.gallery.version, old_version)
        restored = self.new_gallery()
        self.assertTrue(restored.restore())
        self.assertEqual(restored.entries, [])
        self.assertEqual(restored.version, self.gallery.version)
        self.assertEqual(restored.origin, "cache")
        self.assertIsNone(attendance.AttendanceDecision().match(np.eye(1, 512)[0], restored.entries))

    def test_partial_member_removal_replaces_not_merges(self):
        self.seed()
        self.respond(members()[1:])
        ns = self.refresh_ast()
        self.assertEqual(len(ns["known_embeddings"]), 29)
        self.assertNotIn("TEST001", [entry["user_code"] for entry in ns["known_embeddings"]])
        restored = self.new_gallery()
        self.assertTrue(restored.restore())
        self.assertEqual(len(restored.entries), 29)

    def test_network_error_keeps_fresh_cache_and_marks_origin(self):
        self.seed()
        before = self.path.read_bytes()
        version = self.gallery.version
        self.client._session.get.side_effect = requests.ConnectionError("offline")
        ns = self.refresh_ast()
        self.assertEqual(len(ns["known_embeddings"]), 30)
        self.assertEqual(self.gallery.origin, "cache")
        self.assertIsNotNone(self.gallery.error)
        self.assertEqual(self.gallery.version, version)
        self.assertEqual(self.path.read_bytes(), before)

    def test_empty_cache_survives_network_failure_without_resurrecting_users(self):
        self.seed()
        self.seed([])
        restored = self.new_gallery()
        self.assertTrue(restored.restore())
        self.client._session.get.side_effect = requests.Timeout("offline")
        self.assertFalse(restored.refresh(self.client))
        self.assertEqual(restored.entries, [])
        self.assertIsNotNone(restored.version)

    def test_content_revision_stable_for_same_data_and_order(self):
        self.seed()
        first = self.gallery.version
        self.now += 1
        self.seed(list(reversed(members())))
        self.assertEqual(self.gallery.version, first)
        self.assertEqual(self.gallery.fetched_at, 1001)
        raw = json.loads(self.path.read_text(encoding="utf-8"))["data"]
        self.seed(raw)
        self.assertEqual(self.gallery.version, first)

    def test_revision_changes_on_name_membership_and_embedding(self):
        self.seed()
        last = self.gallery.version
        for kind in ("name", "membership", "embedding"):
            data = members()
            if kind == "name":
                data[0]["full_name"] = "Updated member"
            elif kind == "membership":
                data.pop()
            else:
                data[0]["embedding"][1] = 0.5
            self.seed(data)
            self.assertNotEqual(self.gallery.version, last)
            last = self.gallery.version

    def test_restore_then_real_startup_function_keeps_cache_when_offline(self):
        self.seed()
        self.client._session.get.side_effect = requests.ConnectionError("offline")
        ns = dict(MemberGallery=MemberGallery)
        exec(production_gallery_startup(), ns)
        config = SimpleNamespace(MEMBER_GALLERY_CACHE_PATH=self.path, GALLERY_CACHE_MAX_AGE_SECONDS=86400)
        with patch("member_gallery.time.time", return_value=self.now):
            restored = ns["initialize_member_gallery"](self.client, config)
        self.assertEqual(len(restored.entries), 30)
        self.assertEqual(restored.origin, "cache")

    def test_production_startup_online_empty_overrides_restored_cache(self):
        self.seed()
        self.respond([])
        ns = dict(MemberGallery=MemberGallery)
        exec(production_gallery_startup(), ns)
        config = SimpleNamespace(MEMBER_GALLERY_CACHE_PATH=self.path, GALLERY_CACHE_MAX_AGE_SECONDS=86400)
        with patch("member_gallery.time.time", return_value=self.now):
            restored = ns["initialize_member_gallery"](self.client, config)
        self.assertEqual(restored.entries, [])
        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8"))["data"], [])

    def test_cache_age_boundary_and_live_expiry_after_error(self):
        self.seed()
        self.now += 86400
        self.assertTrue(self.new_gallery().restore())
        self.now += 0.001
        self.assertFalse(self.new_gallery().restore())
        self.client._session.get.side_effect = requests.ConnectionError("offline")
        self.assertFalse(self.gallery.refresh(self.client))
        self.assertEqual(self.gallery.entries, [])
        self.assertEqual(self.gallery.origin, "none")

    def test_corrupt_missing_or_future_schema_cache_ignored(self):
        self.assertFalse(self.new_gallery().restore())
        self.seed()
        original = self.path.read_text(encoding="utf-8")
        for content in ("not json", "[]", "null", json.dumps({"cache_schema_version": 99})):
            with self.subTest(content=content):
                with self.path.open("w", encoding="utf-8") as file:
                    file.write(content)  # Test fixture mutation in its temporary directory.
                gallery = self.new_gallery()
                self.assertFalse(gallery.restore())
                self.assertEqual(gallery.entries, [])
        with self.path.open("w", encoding="utf-8") as file:
            file.write(original)
        self.assertTrue(self.new_gallery().restore())

    def test_cache_source_mismatch_ignored(self):
        self.seed()
        gallery = MemberGallery(self.path, source="http://other-backend", clock=lambda: self.now)
        self.assertFalse(gallery.restore())
        self.assertEqual(gallery.error, "cache_source_mismatch")

    def test_future_timestamp_and_changed_content_without_revision_rejected(self):
        self.seed()
        original = json.loads(self.path.read_text(encoding="utf-8"))
        for mutation in ("time", "content"):
            snapshot = json.loads(json.dumps(original))
            if mutation == "time":
                snapshot["fetched_at"] = self.now + 10
            else:
                snapshot["data"][0]["full_name"] = "Different member"
            with self.path.open("w", encoding="utf-8") as file:
                json.dump(snapshot, file)
            self.assertFalse(self.new_gallery().restore())

    def test_write_failure_keeps_empty_ram_invalidates_old_disk_snapshot(self):
        self.seed()
        self.respond([])
        with patch("member_gallery.os.replace", side_effect=OSError("synthetic full disk")):
            self.assertTrue(self.gallery.refresh(self.client))
        self.assertEqual(self.gallery.entries, [])
        self.assertEqual(self.gallery.cache_error, "cache_write_failed")
        self.assertFalse(self.path.exists())
        self.assertFalse(self.new_gallery().restore())
        self.assertEqual(list(self.path.parent.glob("member-gallery.json.*.tmp")), [])

    def test_failed_cache_invalidation_is_reported_not_hidden(self):
        self.seed()
        self.respond([])
        with patch.object(self.gallery, "_save", side_effect=OSError("read only")), \
             patch("member_gallery.Path.unlink", side_effect=OSError("cannot unlink")):
            self.assertTrue(self.gallery.refresh(self.client))
        self.assertEqual(self.gallery.entries, [])
        self.assertEqual(self.gallery.cache_error, "cache_write_and_invalidation_failed")
        self.assertEqual(self.gallery.status()["cache_error"], "cache_write_and_invalidation_failed")

    def test_distinct_process_restores_snapshot_after_parent_sync(self):
        self.seed()
        script = """import sys,json
sys.path.insert(0,sys.argv[1])
from member_gallery import MemberGallery
g=MemberGallery(sys.argv[2],source='http://127.0.0.1:1',clock=lambda:1000)
assert g.restore()
assert len(g.entries)==30
print(g.version)
"""
        child = subprocess.run([sys.executable, "-c", script, str(ROOT / "AIOT/edge"), str(self.path)],
                               cwd=self.temp.name, capture_output=True, text=True, timeout=10)
        self.assertEqual(child.returncode, 0, child.stderr)
        self.assertEqual(child.stdout.strip(), self.gallery.version)

    def test_health_exposes_gallery_source_and_count_without_embeddings(self):
        from health import AppState
        self.seed()
        state = AppState()
        state.gallery_status = self.gallery.status()
        health = state.to_health_dict()
        self.assertEqual(health["gallery"]["member_count"], 30)
        self.assertEqual(health["gallery"]["origin"], "server")
        self.assertNotIn("embedding", json.dumps(health))


class GalleryCompatibilityTests(GalleryFixture):
    def test_contract_model_preprocess_alignment_dimension_mismatch_rejected(self):
        self.seed()
        version = self.gallery.version
        for field, value in (("model_id", "ms1mv3_r50_vnceleb"), ("preprocess_id", "other"),
                             ("alignment_id", "arcface-five-point"), ("dimension", 256)):
            with self.subTest(field=field):
                self.respond(members(), contract={**LEGACY_MBF_CONTRACT, field: value})
                self.assertFalse(self.gallery.refresh(self.client))
                self.assertEqual(self.gallery.version, version)
                self.assertEqual(self.gallery.origin, "cache")

    def test_matching_declared_contract_accepted(self):
        self.respond(members(), contract=LEGACY_MBF_CONTRACT)
        self.assertTrue(self.gallery.refresh(self.client))

    def test_cache_contract_mismatch_for_each_field_is_ignored(self):
        self.seed()
        for field, value in (("model_id", "r50"), ("preprocess_id", "other"),
                             ("alignment_id", "other")):
            with self.subTest(field=field):
                gallery = self.new_gallery(contract={**LEGACY_MBF_CONTRACT, field: value})
                self.assertFalse(gallery.restore())
                self.assertEqual(gallery.entries, [])
        with self.assertRaisesRegex(ValueError, "dimension"):
            self.new_gallery(contract={**LEGACY_MBF_CONTRACT, "dimension": 256})

    def test_non_axis_embeddings_do_not_churn_revision_after_restore(self):
        data = members(2)
        data[0]["embedding"] = np.random.default_rng(10).normal(size=512).tolist()
        self.seed(data)
        version = self.gallery.version
        self.seed(data)
        self.assertEqual(self.gallery.version, version)
        restored = self.new_gallery()
        self.assertTrue(restored.restore())
        self.respond(data)
        self.assertTrue(restored.refresh(self.client))
        self.assertEqual(restored.version, version)

    def test_r50_512d_cannot_load_mbf_cache_or_metadata_less_gallery(self):
        self.seed()
        r50 = self.new_gallery(contract={**LEGACY_MBF_CONTRACT, "model_id": "test-r50-finetuned-v1"})
        self.assertFalse(r50.restore())
        self.respond(members())
        self.assertFalse(r50.refresh(self.client))
        self.assertEqual(r50.entries, [])
        self.assertEqual(r50.error, "missing_embedding_contract")

    def test_legacy_adapter_can_be_disabled_and_not_used_for_r50(self):
        self.respond(members())
        gallery = self.new_gallery(allow_legacy=False)
        self.assertFalse(gallery.refresh(self.client))
        self.respond(members(), contract=LEGACY_MBF_CONTRACT)
        self.assertTrue(gallery.refresh(self.client))

    def test_invalid_vector_and_member_rows_reject_whole_batch_without_clearing(self):
        self.seed()
        version = self.gallery.version
        invalid = [[], [0] * 512, [1] * 511, [[1] * 512],
                   [float("nan")] + [0] * 511, [float("inf")] + [0] * 511,
                   ["1"] * 512, [True] * 512]
        for vector in invalid:
            with self.subTest(vector_type=str(vector[:1])):
                data = members(2)
                data[1]["embedding"] = vector
                self.respond(data)
                self.assertFalse(self.gallery.refresh(self.client))
                self.assertEqual(len(self.gallery.entries), 30)
                self.assertEqual(self.gallery.version, version)
        for data in ([None], [{}], [members(1)[0], members(1)[0]],
                     [{**members(1)[0], "user_code": "lower"}]):
            self.respond(data)
            self.assertFalse(self.gallery.refresh(self.client))
            self.assertEqual(len(self.gallery.entries), 30)

    def test_invalid_query_vectors_are_not_sent_to_cosine(self):
        self.assertTrue(self.gallery.valid_query(np.eye(1, 512)[0]))
        for vector in (None, [0] * 512, [1] * 511, [[1] * 512], [float("nan")] * 512):
            self.assertFalse(self.gallery.valid_query(vector))


if __name__ == "__main__":
    unittest.main()
