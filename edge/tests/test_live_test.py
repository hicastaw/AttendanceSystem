"""Kiểm thử an toàn bằng dữ liệu tổng hợp; không phải nghiệm thu danh tính thật."""
import io
import unittest
from unittest.mock import MagicMock, patch

import cv2
import numpy as np

import main
from attendance_service import AttendanceDecision
from camera import Camera
from health import AppState
from stream_server import create_app


class LiveTestSafety(unittest.TestCase):
    def setUp(self):
        self.frame = np.zeros((480, 640, 3), np.uint8)
        self.face = np.array([100, 100, 100, 120, 120, 130, 170, 130,
                              145, 150, 125, 180, 165, 180, .95], np.float32)
        self.detector = MagicMock()
        self.detector.detect.return_value = [self.face]
        self.recognizer = MagicMock()
        self.embedding = np.zeros(512, np.float32)
        self.embedding[0] = 1
        self.recognizer.get_embedding.return_value = self.embedding
        self.decision = AttendanceDecision(.6, 60)
        self.api = MagicMock()
        self.entry = {'user_code': 'TEST_ONLY', 'full_name': 'Synthetic test',
                      'embedding': self.embedding.copy()}

    def infer(self, known):
        return main.infer_faces(self.frame, self.detector, self.recognizer,
                                self.decision, known, self.api)

    def test_match_in_test_mode_never_posts_or_toggles(self):
        result = self.infer([self.entry])[0]
        self.assertEqual(result['status'], 'matched')
        self.assertEqual(result['user_code'], 'TEST_ONLY')
        self.assertAlmostEqual(result['similarity'], 100)
        self.assertEqual(self.api.mock_calls, [])
        self.assertEqual(self.decision._last_state, {})
        self.assertEqual(self.decision._last_sent, {})

    def test_unknown_uses_existing_threshold(self):
        self.recognizer.get_embedding.return_value = np.roll(self.embedding, 1)
        result = self.infer([self.entry])[0]
        self.assertEqual(result['label'], 'Unknown')
        self.assertEqual(result['status'], 'no_match')
        self.assertEqual(result['similarity'], 0)
        self.assertEqual(self.api.mock_calls, [])

    def test_no_enrollment_still_runs_embedding_and_score_is_unavailable(self):
        result = self.infer([])[0]
        self.recognizer.get_embedding.assert_called_once()
        self.assertEqual(result['status'], 'no_enrollment')
        self.assertIsNone(result['similarity'])
        self.assertEqual(self.api.mock_calls, [])

    def test_no_faces_still_publishes_video(self):
        self.detector.detect.return_value = []
        annotations = self.infer([])
        self.assertEqual(annotations, [])
        self.recognizer.get_embedding.assert_not_called()
        state = AppState(test_mode=True)
        state.camera_opened = True
        main.draw_and_publish(state, self.frame, annotations, 70)
        decoded = cv2.imdecode(np.frombuffer(state.get_frame(), np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(decoded.shape, self.frame.shape)

    def test_test_mode_overrides_old_5000_config(self):
        with patch.object(main.config, 'STREAM_PORT', 5000):
            args = main.parse_args(['--live-test'])
        self.assertEqual(args.port, 8080)
        self.assertEqual(args.camera_backend, 'rpicam')

    def test_live_main_uses_local_model_and_never_starts_attendance_sender(self):
        server, camera, api = MagicMock(), MagicMock(), MagicMock()
        camera.is_opened = True
        camera.device = 'test-only'
        camera.frames_captured = 1
        api.server_reachable = False
        api.get_face_data.return_value = []
        self.detector.detect.return_value = []

        def read_once():
            main._running = False
            return True, self.frame

        camera.read.side_effect = read_once
        with patch.object(main, 'build_stream_server', return_value=server), \
                patch.object(main, 'Camera', return_value=camera), \
                patch.object(main, 'ApiClient', return_value=api), \
                patch.object(main, 'FaceDetector', return_value=self.detector), \
                patch.object(main, 'FaceRecognizer', return_value=self.recognizer) as local, \
                patch.object(main, 'RemoteFaceRecognizer') as remote, \
                patch.object(main.config, 'EMBEDDING_BACKEND', 'remote'):
            main.main(['--live-test', '--server-enrollment'])
        local.assert_called_once()
        remote.assert_not_called()
        api.get_face_data.assert_called_once()
        api.start.assert_not_called()
        api.get_last_state.assert_not_called()
        api.send_event_async.assert_not_called()
        camera.release.assert_called_once()

    def test_model_failure_releases_resources_without_api_sender(self):
        server, camera, api = MagicMock(), MagicMock(), MagicMock()
        with patch.object(main, 'build_stream_server', return_value=server), \
                patch.object(main, 'Camera', return_value=camera), \
                patch.object(main, 'ApiClient', return_value=api), \
                patch.object(main, 'FaceDetector', side_effect=RuntimeError('model failure')):
            with self.assertRaisesRegex(RuntimeError, 'model failure'):
                main.main(['--live-test'])
        camera.release.assert_called_once()
        server.server_close.assert_called_once()
        api.start.assert_not_called()
        api.get_last_state.assert_not_called()
        api.send_event_async.assert_not_called()

    def test_valid_empty_enrollment_and_invalid_vectors(self):
        self.api.face_data_pipeline = main.pipeline_metadata()
        self.api.get_face_data.return_value = [
            {'user_code': 'bad', 'embedding': [float('nan')] * 512},
            {'user_code': 'bad', 'embedding': [0] * 512},
            {'user_code': 'bad', 'embedding': [1, 2]},
            {'user_code': 'TEST_ONLY', 'embedding': self.embedding.tolist()},
        ]
        entries = main.load_known_embeddings(self.api)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]['user_code'], 'TEST_ONLY')


class HttpAndCapture(unittest.TestCase):
    def test_health_and_mjpeg_share_one_published_frame(self):
        state = AppState(test_mode=True)
        state.camera_opened = True
        _, jpeg = cv2.imencode('.jpg', np.zeros((48,64,3), np.uint8))
        state.update_frame(jpeg.tobytes())
        with create_app(state).test_client() as client:
            self.assertEqual(client.get('/').status_code, 200)
            health = client.get('/health')
            self.assertEqual(health.headers['Cache-Control'], 'no-store')
            self.assertFalse(health.json['attendance_enabled'])
            self.assertEqual(health.json['identity_status'], 'No enrolled identities')
            self.assertEqual(health.json['camera_status'], 'streaming')
            response = client.get('/video_feed', buffered=False)
            self.assertIn(jpeg.tobytes(), next(iter(response.response)))
            response.close()
        state.stop()
        self.assertEqual(state.to_health_dict()['status'], 'stopped')

    def test_stale_frame_and_faces_are_not_reported_as_live(self):
        state = AppState()
        state.camera_opened = True
        state.update_frame(b'test')
        state.faces = [{'label': 'TEST_ONLY'}]
        state._last_frame_at -= 10
        self.assertEqual(state.to_health_dict()['camera_status'], 'no_recent_frame')
        self.assertEqual(state.to_health_dict()['faces'], [])
        self.assertIsNone(state.wait_frame(-1, timeout=.01)[1])

    def test_capture_reader_keeps_only_latest_jpeg(self):
        camera = Camera('', backend='rpicam')
        # Parser only: these marker-delimited bytes are never displayed or inferred.
        process = MagicMock()
        process.stdout = io.BytesIO(b'noise\xff\xd8first\xff\xd9\xff\xd8second\xff\xd9')
        camera._process = process
        camera._read_jpegs()
        self.assertEqual(camera._jpeg, b'\xff\xd8second\xff\xd9')
        self.assertEqual(camera.frames_captured, 2)
        self.assertTrue(camera._reader_done)


if __name__ == '__main__':
    unittest.main()
