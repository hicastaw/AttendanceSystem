from datetime import datetime
import importlib.util
from pathlib import Path
import sys
import tempfile
import uuid
import unittest
from types import SimpleNamespace
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'AIOT/edge'))
from pipeline import TARGET, similarity_transform, normalize, normalized_centroid, inverse_letterbox, Consensus
from attendance_service import AttendanceDecision
from model_contract import validate_backend, verify_legacy_model
from api_client import ApiClient


class PipelineTests(unittest.TestCase):
    def test_all_five_points_fit_similarity_and_reject_degenerate(self):
        angle=.2
        rotation=np.array([[np.cos(angle),-np.sin(angle)],[np.sin(angle),np.cos(angle)]])
        source=2*TARGET@rotation.T+[100,20]
        matrix=similarity_transform(source)
        actual=np.c_[source,np.ones(5)]@matrix.T
        np.testing.assert_allclose(actual,TARGET,atol=1e-8)
        changed=source.copy();changed[4]+=[3,4]
        self.assertGreater(np.linalg.norm(similarity_transform(changed)-matrix),.01)
        for bad in [np.zeros((5,2)),np.zeros((3,2)),np.full((5,2),np.nan)]:
            with self.assertRaises(ValueError):similarity_transform(bad)

    def test_centroid_normalization_and_invalid_vectors(self):
        a=np.eye(1,512,0)[0];b=np.eye(1,512,1)[0]
        np.testing.assert_allclose(normalized_centroid([2*a,3*b]),(a+b)/np.sqrt(2))
        for vector in [np.zeros(512),np.ones(511),np.full(512,np.nan),np.full(512,np.inf)]:
            with self.assertRaises(ValueError):normalize(vector)
            self.assertIsNone(AttendanceDecision().match(vector,[dict(user_code='A',embedding=a)]))
        with self.assertRaises(ValueError):normalized_centroid([a,-a])

    def test_margin_rejects_ambiguous_top_candidates(self):
        query=np.eye(1,512)[0]
        entries=[dict(user_code='A',embedding=query),dict(user_code='B',embedding=query.copy())]
        self.assertIsNone(AttendanceDecision(minimum_margin=.05).match(query,entries))

    def test_inverse_letterbox(self):
        np.testing.assert_allclose(inverse_letterbox([[40,30],[60,50]],scale=2,padding=[20,10]),[[10,10],[20,20]])
        with self.assertRaises(ValueError):inverse_letterbox([[1,2]],scale=0,padding=[0,0])

    def test_consensus_resets_track_revision_age_and_unknown(self):
        clock=[0.0];v=Consensus(clock=lambda:clock[0])
        self.assertFalse(v.observe('A',version='old'));self.assertFalse(v.observe('A',version='old'))
        self.assertTrue(v.observe('A',version='old'))
        self.assertFalse(v.observe('A',version='new'))
        self.assertFalse(v.observe('A',track='other',version='new'))
        clock[0]=3;self.assertFalse(v.observe('A',track='other',version='new'))
        v.reset();self.assertFalse(v.observe(None));self.assertEqual(len(v.votes),1)

    def test_no_implicit_hailo_or_mock_backend_and_changed_model_rejected(self):
        self.assertEqual(validate_backend('cv2dnn'),'cv2dnn')
        for backend in ['hailo','mock','typo','']:
            with self.assertRaises(ValueError):validate_backend(backend)
        with tempfile.TemporaryDirectory() as folder:
            model=Path(folder)/'w600k_mbf.onnx';model.write_bytes(b'synthetic-invalid-artifact')
            with self.assertRaises(ValueError):verify_legacy_model(model)

    def test_simulator_unknown_never_enqueues_known_persists_before_success(self):
        spec=importlib.util.spec_from_file_location('simulator',ROOT/'tools/simulate_recognition.py')
        simulator=importlib.util.module_from_spec(spec);spec.loader.exec_module(simulator)
        with tempfile.TemporaryDirectory() as folder:
            client=ApiClient('http://127.0.0.1:1',outbox_path=Path(folder)/'mock-outbox.db')
            decision=AttendanceDecision(outbox=client.outbox,now=lambda:datetime.fromisoformat('2026-10-14T08:00:00+07:00'))
            gallery=SimpleNamespace(entries=[dict(user_code='DEMO001',embedding=np.eye(1,512)[0])],version='synthetic')
            states=[];publisher=SimpleNamespace(update=lambda state,**kwargs:states.append((state,kwargs)))
            self.assertIsNone(simulator.recognize_once(client,gallery,decision,publisher,'unknown'))
            self.assertEqual(client.outbox.counts()['pending'],0)
            identifier=simulator.recognize_once(client,gallery,decision,publisher,'known')
            self.assertEqual(client.outbox.get(identifier)['status'],'pending')
            self.assertNotIn('confirmed',[state for state,_ in states])
            client.stop()

    def test_remote_confirmation_exposes_persisted_id_for_fresh_kiosk_without_ack_pending(self):
        with tempfile.TemporaryDirectory() as folder:
            client=ApiClient('http://127.0.0.1:1',outbox_path=Path(folder)/'outbox.db')
            identifier=str(uuid.uuid4());key='default-morning:2026-10-14'
            client.outbox.sync_policy(client.base_url,[],[dict(user_code='A',occurrence_key=key,event_id=identifier)])
            self.assertEqual(client.outbox.confirmed_event_id('A',key),identifier)
            self.assertIsNone(client.outbox.state('A'))
            self.assertEqual(client.outbox.counts(),dict(pending=0,blocked=0,acked=0))
            client.stop()


if __name__=='__main__':unittest.main()
