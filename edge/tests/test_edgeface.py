"""Contract RGB/alignment/embedding và migration dữ liệu khi đổi model."""
import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import cv2
import numpy as np

import config
import main
from enroll_faces import rebuild_enrollments
from face_recognizer import (_ARC_FACE_DST, FaceRecognizer, normalize_embedding,
                             preprocess_face, similarity_transform)
from local_enrollment import load_local_enrollments, pipeline_metadata, sha256_file


class EdgeFaceInputContract(unittest.TestCase):
    def test_preprocess_rgb_channel_order_and_training_range(self):
        bgr = np.empty((112, 112, 3), np.uint8)
        bgr[:] = [0, 127, 255]
        blob = preprocess_face(bgr)
        self.assertEqual(blob.shape, (1, 3, 112, 112))
        self.assertEqual(blob.dtype, np.float32)
        np.testing.assert_allclose(blob[0, :, 0, 0], [1, (127-127.5)/127.5, -1], atol=1e-6)

    def test_similarity_recovers_scale_rotation_translation_for_all_five_landmarks(self):
        angle = .23
        rotation = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
        source = 2.3 * (_ARC_FACE_DST @ rotation.T) + [71, 45]
        transform = similarity_transform(source)
        mapped = source @ transform[:, :2].T + transform[:, 2]
        np.testing.assert_allclose(mapped, _ARC_FACE_DST, atol=1e-5)
        np.testing.assert_allclose(transform[:, :2].T @ transform[:, :2], np.eye(2)/2.3**2, atol=1e-6)

    def test_degenerate_landmarks_are_rejected(self):
        with self.assertRaises(ValueError):
            similarity_transform(np.zeros((5, 2)))

    def test_invalid_embedding_never_enters_cosine_matching(self):
        for output in (np.zeros(512), np.full(512, np.nan), np.ones(256)):
            with self.subTest(shape=output.shape):
                with self.assertRaises(ValueError):
                    normalize_embedding(output)

    def test_actual_model_cpu_forward_is_finite_512d_and_normalized(self):
        recognizer = FaceRecognizer(config.RECOGNIZER_MODEL_PATH, runtime='onnxruntime')
        self.assertEqual(recognizer._session.get_providers(), ['CPUExecutionProvider'])
        embedding = recognizer.get_embedding(np.full((112, 112, 3), 127, np.uint8))
        self.assertEqual(embedding.shape, (512,))
        self.assertTrue(np.isfinite(embedding).all())
        self.assertAlmostEqual(float(np.linalg.norm(embedding)), 1, places=5)

    def test_server_vectors_with_old_or_missing_model_metadata_are_rejected(self):
        api = Mock()
        api.get_face_data.return_value = [{'user_code': 'TEST', 'embedding': np.ones(512).tolist()}]
        for metadata in (None, {'recognizer_sha256': 'old-model'}):
            api.face_data_pipeline = metadata
            with self.assertRaisesRegex(ValueError, 'EdgeFace'):
                main.load_known_embeddings(api)

    def test_pre_migration_store_cannot_be_used_with_new_model(self):
        path = Path(config.BASE_DIR) / 'data' / 'enrollments.before-d574fc0d2b20.json'
        if not path.exists():
            self.skipTest('Không có kho backup của người dùng ở môi trường này')
        with self.assertRaisesRegex(ValueError, 'model/preprocessing'):
            load_local_enrollments(path)


class RebuildEnrollment(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.image = Path(self.folder.name) / 'source.jpg'
        self.image.write_bytes(b'test-only-source-hash')
        self.old = {'version': 1, 'pipeline': {'recognizer_sha256': 'old-model'},
                    'created_at': 'original-date', 'data': [{
                        'user_code': 'Hùng', 'full_name': 'Hùng',
                        'source_image': self.image.name, 'source_sha256': sha256_file(self.image),
                    }]}
        vector = np.zeros(512, np.float32); vector[0] = 1
        self.generated = {'version': 1, 'created_at': 'new-date', 'pipeline': pipeline_metadata(), 'data': [{
            'user_code': '1', 'full_name': 'source', 'embedding': vector.tolist(),
        }]}

    def test_rebuild_preserves_unicode_identity_and_creation_date(self):
        with patch('enroll_faces.build_enrollments', return_value=copy.deepcopy(self.generated)):
            result = rebuild_enrollments(self.old, [self.image], Mock(), Mock())
        self.assertEqual(result['data'][0]['user_code'], 'Hùng')
        self.assertEqual(result['data'][0]['full_name'], 'Hùng')
        self.assertEqual(result['created_at'], 'original-date')
        self.assertEqual(result['previous_pipeline'], self.old['pipeline'])

    def test_changed_source_or_missing_image_aborts_rebuild(self):
        with self.assertRaisesRegex(ValueError, 'ảnh gốc'):
            rebuild_enrollments(self.old, [], Mock(), Mock())
        self.image.write_bytes(b'different-source')
        with self.assertRaisesRegex(ValueError, 'đã thay đổi'):
            rebuild_enrollments(self.old, [self.image], Mock(), Mock())


if __name__ == '__main__':
    unittest.main()
