"""Kiểm tra tính toàn vẹn kho local và bảo đảm không gọi backend trong live test."""
from contextlib import redirect_stderr
import copy
import io
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import numpy as np

import local_enrollment
import main
from enroll_faces import build_enrollments
from local_enrollment import load_local_enrollments, save_local_enrollments


class LocalEnrollmentStore(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / 'data' / 'identities.json'
        self.metadata = {'fixture': 'test-only-no-real-biometric-data'}
        self.metadata_patch = patch.object(local_enrollment, 'pipeline_metadata', return_value=self.metadata)
        self.metadata_patch.start()
        self.addCleanup(self.metadata_patch.stop)
        vector = np.zeros(512, np.float32)
        vector[0] = 1
        self.document = {'version': 1, 'pipeline': self.metadata,
                         'data': [{'user_code': '1', 'full_name': 'Test fixture', 'embedding': vector.tolist()}]}

    def test_atomic_save_roundtrip_and_file_permissions(self):
        save_local_enrollments(self.document, self.path)
        entries = load_local_enrollments(self.path)
        self.assertEqual(entries[0]['user_code'], '1')
        self.assertAlmostEqual(float(np.linalg.norm(entries[0]['embedding'])), 1)
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)
        self.assertFalse(list(self.path.parent.glob('*.tmp')))

    def test_existing_store_is_not_overwritten_without_replace(self):
        save_local_enrollments(self.document, self.path)
        original = self.path.read_bytes()
        different = copy.deepcopy(self.document)
        different['data'][0]['user_code'] = '2'
        with self.assertRaises(FileExistsError):
            save_local_enrollments(different, self.path)
        self.assertEqual(self.path.read_bytes(), original)

    def test_pipeline_mismatch_is_rejected(self):
        save_local_enrollments(self.document, self.path)
        document = json.loads(self.path.read_text())
        document['pipeline'] = {'wrong-model': True}
        self.path.write_text(json.dumps(document))
        with self.assertRaisesRegex(ValueError, 'model/preprocessing'):
            load_local_enrollments(self.path)

    def test_invalid_vector_or_duplicate_identity_does_not_create_store(self):
        for mutation in ('nan', 'zero', 'short', 'duplicate'):
            with self.subTest(mutation=mutation):
                invalid = copy.deepcopy(self.document)
                if mutation == 'duplicate':
                    invalid['data'].append(copy.deepcopy(invalid['data'][0]))
                else:
                    invalid['data'][0]['embedding'] = {
                        'nan': [float('nan')] * 512, 'zero': [0] * 512, 'short': [1, 2],
                    }[mutation]
                with self.assertRaises(ValueError):
                    save_local_enrollments(invalid, self.path)
                self.assertFalse(self.path.exists())

    def test_local_main_does_not_read_or_write_backend(self):
        save_local_enrollments(self.document, self.path)
        camera, detector, api, server = (MagicMock() for _ in range(4))
        camera.is_opened = True
        camera.device = 'test-only'
        camera.frames_captured = 1
        detector.detect.return_value = []
        def read_once():
            main._running = False
            return True, np.zeros((48, 64, 3), np.uint8)
        camera.read.side_effect = read_once
        with patch.object(main, 'DEFAULT_ENROLLMENT_FILE', self.path), \
                patch.object(main, 'Camera', return_value=camera), \
                patch.object(main, 'FaceDetector', return_value=detector), \
                patch.object(main, 'FaceRecognizer'), \
                patch.object(main, 'ApiClient', return_value=api), \
                patch.object(main, 'build_stream_server', return_value=server):
            main.main(['--live-test'])
        self.assertEqual(api.mock_calls, [])
        camera.release.assert_called_once()
        server.server_close.assert_called_once()

    def test_local_file_cannot_be_used_in_attendance_mode(self):
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as result:
                main.parse_args(['--enrollment-file', str(self.path)])
        self.assertEqual(result.exception.code, 2)

    def test_multiple_faces_require_explicit_selection(self):
        detector = MagicMock()
        detector.detect.return_value = [np.zeros(15), np.ones(15)]
        recognizer = MagicMock()
        with patch('enroll_faces.cv2.imread', return_value=np.zeros((48, 64, 3), np.uint8)):
            with self.assertRaisesRegex(ValueError, '2 mặt'):
                build_enrollments([Path('test-only.jpg')], detector, recognizer)
        recognizer.get_embedding.assert_not_called()


if __name__ == '__main__':
    unittest.main()
