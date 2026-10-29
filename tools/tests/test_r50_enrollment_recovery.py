"""Synthetic browser-input lifecycle regression; no camera, models or live data."""
import ast
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
import sqlite3
import sys
import threading
import unittest
from unittest.mock import Mock

import numpy as np
import cv2

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'AIOT/edge'))
from cpu_test_runtime import CPUWorkerAdapter
from capture_session import CaptureSession, SampleRejected
from health import AppState
from integration_gate import candidate_contract_id
import pipeline
from pipeline import Consensus, normalize
from recovery import Recovery, RecoveryExhausted, WorkerStopping
from stream_server import create_app


class BrowserEnrollmentRecoveryTests(unittest.TestCase):
    def run_browser_gap(self, capture_state, *, source_changed=False, source='camera'):
        # Execute the actual orchestrator without importing config/live .env or
        # loading models. Only the camera input and external owners are stubs.
        tree = ast.parse((ROOT / 'AIOT/edge/main.py').read_text(encoding='utf-8'))
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                     and node.name in ('main', '_cleanup', '_read_camera')]
        contract = dict(schema=2, mode='experimental-cpu-only', production_approved=False,
                        dimension=512, detector_sha256='1' * 64,
                        recognizer_sha256='2' * 64, preprocess_id='synthetic-only',
                        alignment_id='synthetic-five-point', numeric_mode='synthetic-f32')
        contract['contract_id'] = candidate_contract_id(contract)
        state, clock = AppState(), [0.]
        camera = SimpleNamespace(is_opened=True, device='synthetic-browser',
                                 browser_source=True, waiting_for_frame=True,
                                 source_changed=source_changed, open=Mock(return_value=True),
                                 release=Mock())
        gallery = SimpleNamespace(entries=[], expire=Mock(),
                                  status=lambda: dict(origin='server', member_count=0))
        client = Mock(storage_ok=True, fatal_error=None, server_reachable=True)
        client.base_url = 'http://127.0.0.1:1'
        decision, publisher, stream = Mock(), Mock(), Mock()
        stream.server = SimpleNamespace(server_port=0)
        consensus = Consensus()
        consensus.observe('SYNTHETIC_PREVIOUS')
        # A real adapter type keeps main's explicit isolated-adapter gate intact;
        # its external model/backend setup is replaced only in this fixture.
        adapter = object.__new__(CPUWorkerAdapter)
        adapter.contract = contract
        adapter.run = {'purpose': 'isolated-r50-laptop-test'}
        adapter.validate = Mock()
        adapter.capture_deadline_seconds = 180
        adapter.capture_max_sample_gap_seconds = 60
        adapter.camera_factory = lambda: camera
        adapter.initialize_gallery = lambda *_: gallery
        adapter.diagnostics = Mock()
        adapter.publish_port = Mock()
        config = SimpleNamespace(**{name: 1 for name in (
            'HTTP_TIMEOUT_SECONDS OUTBOX_RETRY_BASE_SECONDS OUTBOX_RETRY_MAX_SECONDS '
            'SIMILARITY_THRESHOLD ATTENDANCE_COOLDOWN_SECONDS STREAM_PORT JPEG_QUALITY'
        ).split()}, EMBEDDING_BACKEND='cv2dnn', CAMERA_DEVICE='synthetic-browser',
            SERVER_BASE_URL=client.base_url, EDGE_DEVICE_KEY='a' * 32,
            EDGE_OUTBOX_PATH='unused', STREAM_HOST='127.0.0.1',
            PROCESS_EVERY_N_FRAMES=2, FACE_DATA_REFRESH_SECONDS=300,
            validate_runtime=lambda: None)
        ns = dict(ExitStack=ExitStack, config=config, validate_backend=lambda _: None,
                  signal=Mock(), _handle_signal=Mock(), AppState=lambda **_: state,
                  WorkerStatus=lambda *a, **k: publisher, Consensus=lambda: consensus,
                  ApiClient=lambda *a, **k: client,
                  AttendanceDecision=lambda *a, **k: decision,
                  StreamServer=lambda *a, **k: stream,
                  Recovery=lambda **kw: Recovery(**kw, sleep=lambda _: None),
                  WorkerStopping=WorkerStopping, RecoveryExhausted=RecoveryExhausted,
                  time=SimpleNamespace(monotonic=lambda: clock[0], time=lambda: clock[0],
                                       sleep=lambda _: None), sqlite3=sqlite3,
                  normalize=normalize, logger=Mock(), notify=Mock(), _running=True,
                  draw_and_publish=Mock())
        adapter.margin = .05
        session = {}

        def start_capture():
            state.capture.clock = lambda: clock[0]
            session.update(state.capture.start('SYNTHETIC_R50', contract, 1 if source=='upload' else 3, source=source))
            count = {'queued': 0, 'capturing': 1, 'ready': 3}[capture_state]
            for _ in range(count):
                state.capture.observe([object()], lambda _: np.eye(1, 512)[0], source=source)
                clock[0] += .25
            self.assertEqual(state.capture.status(session['session_id'])['state'], capture_state)

        def read():
            ns['_running'] = False
            return ((True, np.zeros((8, 8, 3), dtype=np.uint8))
                    if source_changed else (False, None))

        camera.read = read
        stream.start.side_effect = start_capture
        exec(compile(ast.Module(body=functions, type_ignores=[]), 'actual-main-browser-gap', 'exec'), ns)
        ns['main'](cpu_test=adapter)
        self.assertEqual(len(consensus.votes), 0)
        camera.release.assert_called_once()
        client.stop.assert_called_once()
        worker = create_app(state, device_key='a' * 32).test_client()
        return state, clock, session['session_id'], worker

    def test_ready_browser_capture_is_cancelled_on_input_gap(self):
        _, _, session, worker = self.run_browser_gap('ready')
        self.assertEqual(worker.get('/capture-sessions/' + session).status_code, 401)
        result = worker.get('/capture-sessions/' + session,
                            headers={'X-Device-Key': 'a' * 32})
        self.assertEqual(result.status_code, 404)

    def test_incomplete_browser_capture_is_still_cancelled_on_input_gap(self):
        for capture_state in ('queued', 'capturing'):
            with self.subTest(capture_state=capture_state):
                _, _, session, worker = self.run_browser_gap(capture_state)
                result = worker.get('/capture-sessions/' + session,
                                    headers={'X-Device-Key': 'a' * 32})
                self.assertEqual(result.status_code, 404)

    def test_changed_browser_owner_still_cancels_ready_samples(self):
        _, _, session, worker = self.run_browser_gap('ready', source_changed=True)
        result = worker.get('/capture-sessions/' + session,
                            headers={'X-Device-Key': 'a' * 32})
        self.assertEqual(result.status_code, 404)

    def test_uploaded_ready_image_is_independent_of_camera_input_gap(self):
        _, _, session, worker = self.run_browser_gap('ready', source='upload')
        result = worker.get('/capture-sessions/' + session,headers={'X-Device-Key': 'a'*32})
        self.assertEqual(result.status_code, 200)
        self.assertEqual((result.json['source'],result.json['state']), ('upload','ready'))


class WorkerFreshnessTests(unittest.TestCase):
    def test_actual_worker_rejects_detector_and_embedding_expiry_and_continues(self):
        for slow_stage, required in ((stage,n) for stage in ('detector','embedding') for n in (1,3)):
            with self.subTest(stage=slow_stage, required=required):
                clock = [0.]
                state = AppState(clock=lambda: clock[0])
                self.assertEqual(state.max_age, 5)
                contract = dict(schema=2, mode='experimental-cpu-only', production_approved=False,
                                dimension=512, detector_sha256='1'*64, recognizer_sha256='2'*64,
                                preprocess_id='synthetic-only', alignment_id='synthetic-five-point',
                                numeric_mode='synthetic-f32')
                contract['contract_id'] = candidate_contract_id(contract)
                camera = SimpleNamespace(is_opened=True, device='synthetic', browser_source=False,
                                         open=Mock(return_value=True), release=Mock())
                gallery = SimpleNamespace(entries=[], expire=Mock(), status=lambda: dict(origin='server', member_count=0))
                client = Mock(storage_ok=True, fatal_error=None, server_reachable=True)
                client.base_url = 'http://127.0.0.1:1'
                decision, publisher, stream = Mock(), Mock(), Mock()
                decision.current_day.return_value = '2026-10-28'
                stream.server = SimpleNamespace(server_port=0)
                adapter = object.__new__(CPUWorkerAdapter)
                adapter.contract, adapter.run = contract, {'purpose': 'isolated-r50-laptop-test'}
                adapter.validate, adapter.diagnostics, adapter.publish_port = Mock(), Mock(), Mock()
                adapter.capture_deadline_seconds, adapter.capture_max_sample_gap_seconds = 180, 60
                adapter.camera_factory, adapter.initialize_gallery = lambda: camera, lambda *_: gallery
                adapter.margin = .05
                sample = np.eye(1, 512)[0]
                crop = np.repeat(((np.indices((112, 112)).sum(axis=0) % 2)*255).astype(np.uint8)[:, :, None], 3, axis=2)
                adapter.align = Mock(return_value=crop)
                reads, embeds, session, snapshots = [0], [0], {}, []
                def detect(*_args, **_kwargs):
                    if reads[0] == 1 and slow_stage == 'detector':
                        clock[0] += 5.01
                    # Nondegenerate five-point geometry so this tests timing,
                    # rather than failing the new enrollment geometry check first.
                    return np.array([[0, 0, 112, 112, 30, 35, 80, 35, 55, 60, 35, 85, 75, 85, .99]])
                def embedding(_crop):
                    embeds[0] += 1
                    clock[0] += 5.01 if embeds[0] == 1 and slow_stage == 'embedding' else .01
                    return sample
                adapter.detect, adapter.get_embedding = detect, embedding
                def start_capture():
                    state.capture.clock = lambda: clock[0]
                    session.update(state.capture.start('SYNTHETIC_R50', contract, required))
                    for _ in range(required-1):
                        state.capture.observe([object()], lambda _: sample)
                        clock[0] += .25
                def read():
                    reads[0] += 1
                    if reads[0] == 2:
                        snapshots.append(state.capture.status(session['session_id']))
                    if reads[0] > 2:
                        raise WorkerStopping()
                    clock[0] += .25
                    return True, crop.copy()
                camera.read, stream.start.side_effect = read, start_capture
                config = SimpleNamespace(**{name: 1 for name in (
                    'HTTP_TIMEOUT_SECONDS OUTBOX_RETRY_BASE_SECONDS OUTBOX_RETRY_MAX_SECONDS '
                    'SIMILARITY_THRESHOLD ATTENDANCE_COOLDOWN_SECONDS STREAM_PORT JPEG_QUALITY').split()},
                    EMBEDDING_BACKEND='cv2dnn', CAMERA_DEVICE='synthetic', SERVER_BASE_URL=client.base_url,
                    EDGE_DEVICE_KEY='a'*32, EDGE_OUTBOX_PATH='unused', STREAM_HOST='127.0.0.1',
                    PROCESS_EVERY_N_FRAMES=1, DETECT_WIDTH=640, FACE_DATA_REFRESH_SECONDS=300, validate_runtime=lambda: None)
                ns = dict(ExitStack=ExitStack, config=config, validate_backend=lambda _: None,
                          signal=Mock(), _handle_signal=Mock(), AppState=lambda **_: state,
                          WorkerStatus=lambda *a, **k: publisher, Consensus=Consensus,
                          ApiClient=lambda *a, **k: client, AttendanceDecision=lambda *a, **k: decision,
                          StreamServer=lambda *a, **k: stream, Recovery=lambda **kw: Recovery(**kw, sleep=lambda _: None),
                          WorkerStopping=WorkerStopping, RecoveryExhausted=RecoveryExhausted,
                          time=SimpleNamespace(monotonic=lambda: clock[0], time=lambda: clock[0], sleep=lambda _: None),
                          sqlite3=sqlite3, normalize=normalize, recognition_confirmed=pipeline.recognition_confirmed,
                          SampleRejected=SampleRejected, cv2=cv2, logger=Mock(), notify=Mock(), _running=True,
                          draw_and_publish=Mock())
                tree = ast.parse((ROOT/'AIOT/edge/main.py').read_text(encoding='utf-8'))
                functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and
                             n.name in ('main', '_cleanup', '_read_camera', '_get_embedding')]
                exec(compile(ast.Module(body=functions, type_ignores=[]), 'actual-main-stale-frame', 'exec'), ns)
                ns['main'](cpu_test=adapter)
                self.assertEqual(snapshots[0]['samples'], 0)
                self.assertEqual(snapshots[0].get('reason'), 'stale_frame')
                self.assertNotIn('embedding', snapshots[0])
                fresh = state.capture.status(session['session_id'])
                self.assertEqual(fresh['samples'], 1)
                self.assertNotIn('reason', fresh)
                self.assertEqual(reads[0], 3, 'worker must reach a fresh frame after rejecting the stale one')
                client.send_event_async.assert_not_called()
                camera.release.assert_called_once()
                client.stop.assert_called_once()


class CaptureConcurrencyTests(unittest.TestCase):
    def test_detector_rejection_cannot_affect_replacement_or_completed_session(self):
        capture = CaptureSession()
        old = capture.start('SYNTHETIC_OLD', capture.contract, 3)['session_id']
        capture.cancel(old)
        new = capture.start('SYNTHETIC_NEW', capture.contract, 3)['session_id']
        capture.reject_stale_frame(old)
        self.assertNotIn('reason', capture.status(new))
        for _ in range(3):
            capture.last_sample = None
            capture.observe([object()], lambda _: np.eye(1, 512)[0])
        capture.reject_stale_frame(new)
        self.assertEqual(capture.status(new)['state'], 'ready')
        self.assertEqual(capture.status(new)['samples'], 3)

    def test_expired_frame_is_reported_and_session_can_retry_without_crashing(self):
        capture = CaptureSession()
        session = capture.start('SYNTHETIC_R50', capture.contract, 3)['session_id']
        self.assertTrue(capture.observe([object()], lambda _: (_ for _ in ()).throw(
            SampleRejected('stale_frame'))))
        status = capture.status(session)
        self.assertEqual(status['state'], 'capturing')
        self.assertEqual(status['samples'], 0)
        self.assertEqual(status['reason'], 'stale_frame')
        self.assertTrue(capture.observe([object()], lambda _: np.eye(1, 512)[0]))
        status = capture.status(session)
        self.assertEqual(status['samples'], 1)
        self.assertNotIn('reason', status)

    def test_status_and_cancel_remain_responsive_during_embedding(self):
        state = AppState()
        capture = state.capture
        session = capture.start('SYNTHETIC_OLD', capture.contract, 3)['session_id']
        app = create_app(state, device_key='a' * 32)
        started, release, status_done = threading.Event(), threading.Event(), threading.Event()
        status_result, errors = [], []

        def embedding(_face):
            started.set()
            if not release.wait(5):
                raise RuntimeError('fixture embedding was not released')
            return np.eye(1, 512)[0]

        def observe():
            try:
                capture.observe([object()], embedding)
            except Exception as error:
                errors.append(error)

        def status():
            try:
                response = app.test_client().get('/capture-sessions/' + session,
                                                 headers={'X-Device-Key': 'a' * 32})
                status_result.append((response.status_code, response.json['state']))
            finally:
                status_done.set()

        owner = threading.Thread(target=observe)
        reader = threading.Thread(target=status)
        owner.start()
        try:
            self.assertTrue(started.wait(2), 'fixture embedding did not start')
            reader.start()
            self.assertTrue(status_done.wait(1), 'capture status blocked behind model inference')
            self.assertEqual(status_result, [(200, 'capturing')])
            response = app.test_client().delete('/capture-sessions/' + session,
                                                headers={'X-Device-Key': 'a' * 32})
            self.assertEqual(response.status_code, 200)
            replacement = capture.start('SYNTHETIC_NEW', capture.contract, 3)['session_id']
        finally:
            release.set()
            owner.join(5)
            if reader.ident is not None:
                reader.join(5)
        self.assertFalse(owner.is_alive())
        self.assertFalse(reader.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(capture.status(replacement)['samples'], 0,
                         'an old in-flight embedding must not enter a replacement session')

    def test_inflight_result_expires_and_rejection_cannot_affect_replacement(self):
        for reject in (False, True):
            with self.subTest(reject=reject):
                clock = [0.]
                capture = CaptureSession(clock=lambda: clock[0], deadline_seconds=1)
                session = capture.start('SYNTHETIC_OLD', capture.contract, 3)['session_id']
                started, release = threading.Event(), threading.Event()
                errors = []

                def embedding(_face):
                    started.set()
                    if not release.wait(5):
                        raise RuntimeError('fixture embedding was not released')
                    if reject:
                        raise SampleRejected('synthetic rejection')
                    return np.eye(1, 512)[0]

                def observe():
                    try:
                        capture.observe([object()], embedding)
                    except Exception as error:
                        errors.append(error)

                owner = threading.Thread(target=observe)
                owner.start()
                try:
                    self.assertTrue(started.wait(2))
                    if reject:
                        capture.cancel(session)
                        replacement = capture.start('SYNTHETIC_NEW', capture.contract, 3)['session_id']
                    else:
                        clock[0] = 2.
                finally:
                    release.set()
                    owner.join(5)
                self.assertFalse(owner.is_alive())
                self.assertEqual(errors, [])
                if reject:
                    status = capture.status(replacement)
                    self.assertEqual(status['samples'], 0)
                    self.assertNotIn('reason', status)
                else:
                    self.assertIsNone(capture.value)
                    self.assertEqual(capture.samples, [])


class IsolatedR50RecognitionTests(unittest.TestCase):
    def test_laptop_run_accepts_one_thresholded_match_without_vote_history(self):
        votes = Consensus()
        match = ({'user_code': 'SYNTHETIC_R50'}, .93)
        self.assertTrue(pipeline.recognition_confirmed(match, votes, version='contract-v1', single_frame=True))
        self.assertEqual(list(votes.votes), [])

    def test_laptop_unknown_does_not_accumulate_votes(self):
        votes = Consensus()
        self.assertFalse(pipeline.recognition_confirmed(None, votes, version='contract-v1', single_frame=True))
        self.assertEqual(list(votes.votes), [])

    def test_ordinary_recognition_retains_existing_consensus(self):
        votes = Consensus()
        match = ({'user_code': 'SYNTHETIC_MBF'}, .93)
        self.assertFalse(pipeline.recognition_confirmed(match, votes, version='mbf-v1'))
        self.assertFalse(pipeline.recognition_confirmed(match, votes, version='mbf-v1'))
        self.assertTrue(pipeline.recognition_confirmed(match, votes, version='mbf-v1'))


if __name__ == '__main__':
    unittest.main()
