"""Execute production main AST with fault-injected dependencies, no config/camera I/O."""
import ast
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
import logging
from http.server import BaseHTTPRequestHandler, HTTPServer
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'AIOT/edge'))
from api_client import ApiClient
from outbox import DurableOutbox
from stream_server import StreamServer
from worker_status import WorkerStatus
from health import AppState
from recovery import WorkerStopping, RecoveryExhausted


class WorkerLifecycleTests(unittest.TestCase):
    def exercise(self, failure=None, cleanup_failure=False, running=False, cpu=False):
        tree = ast.parse((ROOT/'AIOT/edge/main.py').read_text(encoding='utf-8'))
        functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ('main', '_cleanup', '_read_camera')]
        calls, objects = [], {}

        def step(name):
            calls.append(name)
            if name == failure:
                raise RuntimeError('injected ' + name)

        def resource(name):
            step(name + '.create')
            obj = Mock()
            obj.device = 'synthetic'
            obj.is_opened = True
            obj.server_reachable = True
            obj.storage_ok, obj.fatal_error = True, None
            obj.open.side_effect = lambda: step(name + '.open')
            obj.start.side_effect = lambda: step(name + '.start')
            obj.read.side_effect = lambda: step('loop.read')
            def close():
                calls.append(name + '.close')
                if cleanup_failure and name == 'api':
                    raise OSError('injected cleanup failure')
                return True
            obj.stop.side_effect = close
            obj.release.side_effect = close
            objects[name] = obj
            return obj

        config = SimpleNamespace(**{name: 1 for name in (
            'CAMERA_WIDTH CAMERA_HEIGHT CAMERA_FPS CAMERA_FOURCC DETECTION_SCORE_THRESHOLD '
            'HTTP_TIMEOUT_SECONDS OUTBOX_RETRY_BASE_SECONDS OUTBOX_RETRY_MAX_SECONDS '
            'SIMILARITY_THRESHOLD ATTENDANCE_COOLDOWN_SECONDS STREAM_PORT '
            'FACE_DATA_REFRESH_SECONDS').split()}, EMBEDDING_BACKEND='cv2dnn', CAMERA_DEVICE='synthetic',
            SERVER_BASE_URL='http://127.0.0.1:1', EDGE_DEVICE_KEY='synthetic', CAMERA_BACKEND='stub',
            DETECTOR_MODEL_PATH='unused', RECOGNIZER_MODEL_PATH='unused', EDGE_OUTBOX_PATH='unused', STREAM_HOST='127.0.0.1')
        def decision(*args, **kwargs):
            step('decision.create')
            return SimpleNamespace(current_day=lambda:'2026-10-18')
        def gallery(*args):
            step('gallery.create')
            return SimpleNamespace(entries=[], status=lambda:{}, expire=lambda:None)
        logger = Mock()
        config.validate_runtime=lambda:None
        ns = dict(ExitStack=ExitStack, config=config, validate_backend=lambda _:None,
                  signal=Mock(), _handle_signal=lambda *a:None, AppState=AppState,
                  WorkerStatus=lambda *a,**kw:resource('publisher'), Consensus=lambda:None,
                  Recovery=lambda **kw:SimpleNamespace(call=lambda component, action:action()),WorkerStopping=WorkerStopping,RecoveryExhausted=RecoveryExhausted,
                  notify=lambda _:None,
                  create_camera=lambda *a:resource('camera'), FaceDetector=lambda *a,**kw:step('detector.create'),
                  FaceRecognizer=lambda *a:step('recognizer.create'), ApiClient=lambda *a,**kw:resource('api'),
                  AttendanceDecision=decision, initialize_member_gallery=gallery,
                  StreamServer=lambda *a,**kw:resource('stream'), LEGACY_CONTRACT={}, sqlite3=sqlite3,
                  time=SimpleNamespace(monotonic=lambda:0, time=lambda:0), logger=logger, _running=running)
        # Sync can fail unexpectedly; expected sqlite/OSError behavior remains unchanged.
        original_resource = resource
        def api(*a, **kw):
            obj = original_resource('api')
            obj.sync_attendance_policy.side_effect = lambda d:step('policy.sync')
            return obj
        ns['ApiClient'] = api
        adapter = None
        if cpu:
            # Actual adapter type, dependency-injected behavior: no config import,
            # model weights, HTTP or camera. Exercise main's provider dispatch.
            import json
            from cpu_onnx import descriptor_contract
            from cpu_test_runtime import CPUWorkerAdapter
            adapter = CPUWorkerAdapter.__new__(CPUWorkerAdapter)
            adapter.run = {'purpose': 'isolated-r50-laptop-test'}
            adapter.contract = descriptor_contract(json.loads(
                (ROOT/'AIOT/edge/model/r50-experimental-laptop.json').read_text(encoding='utf-8')))
            adapter.validate = Mock()
            adapter.camera_factory = lambda:resource('camera')
            adapter.initialize_gallery = gallery
            adapter.capture_deadline_seconds, adapter.capture_max_sample_gap_seconds = 180, 60
            adapter.margin = .05
            for name in ('FaceDetector', 'FaceRecognizer', 'RemoteFaceRecognizer',
                         'create_camera', 'initialize_member_gallery'):
                ns[name] = Mock(side_effect=AssertionError('Forbidden legacy fallback: '+name))
        exec(compile(ast.Module(body=functions, type_ignores=[]), 'production-main', 'exec'), ns)
        if failure:
            with self.assertRaisesRegex(RuntimeError, 'injected ' + failure):
                ns['main'](cpu_test=adapter)
        else:
            ns['main'](cpu_test=adapter)
        if cpu:
            adapter.validate.assert_called_once_with(config)
            for name in ('FaceDetector', 'FaceRecognizer', 'RemoteFaceRecognizer',
                         'create_camera', 'initialize_member_gallery'):
                ns[name].assert_not_called()
        for name in objects:
            self.assertEqual(calls.count(name + '.close'), 1, (failure, calls))
        return calls, logger

    def test_partial_startup_failures_close_only_created_objects(self):
        for failure in ('publisher.create', 'publisher.start', 'camera.create', 'camera.open',
                        'detector.create', 'recognizer.create', 'api.create', 'decision.create',
                        'policy.sync', 'api.start', 'gallery.create', 'stream.create', 'stream.start'):
            with self.subTest(failure=failure):
                self.exercise(failure)

    def test_normal_stop_closes_every_resource_in_reverse_order(self):
        calls, _ = self.exercise()
        self.assertEqual([s for s in calls if s.endswith('.close')],
                         ['stream.close', 'api.close', 'camera.close', 'publisher.close'])

    def test_cleanup_failure_does_not_mask_original_or_skip_other_cleanup(self):
        _, logger = self.exercise('gallery.create', cleanup_failure=True)
        logger.exception.assert_called_once()

    def test_unexpected_loop_exception_still_propagates_after_cleanup(self):
        self.exercise('loop.read', running=True)

    def test_r50_adapter_faults_propagate_without_constructing_legacy_providers(self):
        for failure in ('api.create', 'gallery.create'):
            with self.subTest(failure=failure):
                self.exercise(failure, cpu=True)

    def test_real_client_stop_before_and_after_start_preserves_pending(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'outbox.db'
            client = ApiClient('http://127.0.0.1:1', outbox_path=target)
            event = dict(event_id='f51f0181-c998-49cc-8d04-ce8e4405db89', device_id='SYNTH',
                         user_code='TEST001', event_type='check_in', timestamp='2026-10-18T08:00:00+07:00', confidence=90)
            client.send_event_async(event, attendance_key='default-morning:2026-10-18')
            with patch.object(client._session, 'close') as foreground, patch.object(client._send_session, 'close') as sender:
                self.assertTrue(client.stop())
                foreground.assert_called_once(); sender.assert_called_once()
            reopened = DurableOutbox(target)
            self.assertEqual(reopened.get(event['event_id'])['status'], 'pending')
            client = ApiClient('http://127.0.0.1:1', outbox=reopened)
            with patch.object(client, 'run_once', return_value=False):
                client.start()
                self.assertTrue(client.stop())
            self.assertFalse(client._thread.is_alive())
            self.assertEqual(DurableOutbox(target).get(event['event_id'])['event'], event)

    def test_real_publisher_stop_before_and_after_start(self):
        for start in (False, True):
            publisher = WorkerStatus('http://127.0.0.1:1', 'synthetic', {})
            with patch.object(publisher, 'publish', return_value=True), patch.object(publisher.session, 'close') as close:
                if start:
                    publisher.start()
                publisher.stop()
                self.assertFalse(publisher.thread.is_alive())
                close.assert_called_once()

    def test_failed_constructors_close_sessions_not_yet_owned_by_main(self):
        session = Mock()
        with patch('api_client.requests.Session', side_effect=[session, RuntimeError('second session')]):
            with self.assertRaisesRegex(RuntimeError, 'second session'):
                ApiClient('http://127.0.0.1:1', outbox=Mock())
        session.close.assert_called_once()
        session = Mock()
        session.headers = {}
        with patch('worker_status.requests.Session', return_value=session), patch(
                'worker_status.threading.Thread', side_effect=RuntimeError('thread init')):
            with self.assertRaisesRegex(RuntimeError, 'thread init'):
                WorkerStatus('http://127.0.0.1:1', 'synthetic', {})
        session.close.assert_called_once()

    def test_stream_owns_real_loopback_listener_with_synthetic_http_factory(self):
        import requests
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200); self.end_headers(); self.wfile.write(b'synthetic')
            def log_message(self, *args):
                pass
        listener = HTTPServer(('127.0.0.1', 0), Handler)
        stream = StreamServer(None, factory=lambda:listener)
        url = 'http://127.0.0.1:' + str(listener.server_port)
        try:
            stream.start()
            with requests.get(url, timeout=1) as response:
                self.assertEqual(response.content, b'synthetic')
        finally:
            self.assertTrue(stream.stop())
        self.assertFalse(stream.thread.is_alive())
        with self.assertRaises(requests.RequestException):
            requests.get(url, timeout=.2)

    def test_owned_stream_stops_thread_and_closes_listener_even_on_start_failure(self):
        for start_failure in (False, True):
            done = threading.Event()
            server = SimpleNamespace(serve_forever=lambda:done.wait(2), shutdown=done.set, server_close=Mock())
            stream = StreamServer(None, factory=lambda:server)
            if start_failure:
                with patch('stream_server.threading.Thread.start', side_effect=RuntimeError('start failed')):
                    with self.assertRaises(RuntimeError):stream.start()
            else:
                stream.start()
            self.assertTrue(stream.stop())
            server.server_close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
