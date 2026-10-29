"""Disposable synthetic images/vectors; no camera or biometric records."""
import io
import struct
import sys
import unittest
import zlib
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'AIOT/edge'))
from capture_session import CaptureSession, SampleRejected
from enrollment_image import (ImageRejected, decode_upload, embed_face, process_uploaded,
                              preview_jpeg, MAX_IMAGE_BYTES)
from stream_server import create_app


def image_bytes(fmt='PNG', size=(160, 120), **kwargs):
    output = io.BytesIO()
    Image.new('RGB', size, (180, 70, 20)).save(output, format=fmt, **kwargs)
    return output.getvalue()


def textured():
    grid = (np.indices((112, 112)).sum(axis=0) % 2 * 255).astype(np.uint8)
    return np.repeat(grid[:, :, None], 3, axis=2)


FACE = np.array([0, 0, 112, 112, 30, 35, 80, 35, 55, 60, 35, 85, 75, 85, .99])
VECTOR = np.eye(1, 512)[0]


class ImageValidationTests(unittest.TestCase):
    def test_jpeg_png_and_exif_orientation(self):
        for fmt, mime in [('JPEG', 'image/jpeg'), ('PNG', 'image/png')]:
            value = decode_upload(image_bytes(fmt), mime)
            self.assertEqual(value.shape, (120, 160, 3))
            self.assertEqual(value.dtype, np.uint8)
        exif = Image.Exif(); exif[274] = 6
        value = decode_upload(image_bytes('JPEG', exif=exif), 'image/jpeg')
        self.assertEqual(value.shape, (160, 120, 3))

    def test_invalid_unsupported_mismatched_and_oversized_files(self):
        for data, mime, code, status in [
            (b'not an image', 'image/jpeg', 'invalid_image', 400),
            (image_bytes('GIF'), 'image/jpeg', 'unsupported_format', 415),
            (image_bytes('PNG'), 'image/jpeg', 'unsupported_format', 415),
            (b'x' * (MAX_IMAGE_BYTES + 1), 'image/jpeg', 'image_too_large', 413),
            (image_bytes('JPEG')[:100], 'image/jpeg', 'invalid_image', 400),
        ]:
            with self.subTest(code=code), self.assertRaises(ImageRejected) as raised:
                decode_upload(data, mime)
            self.assertEqual((raised.exception.code, raised.exception.status), (code, status))

    def test_dimensions_are_rejected_before_pixel_decode(self):
        def chunk(kind, value):
            return struct.pack('>I', len(value)) + kind + value + struct.pack('>I', zlib.crc32(kind + value) & 0xffffffff)
        for width, height in [(4097, 1), (4000, 4000), (100000, 100000)]:
            data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b'')) + chunk(b'IEND', b'')
            with self.assertRaises(ImageRejected) as raised:
                decode_upload(data, 'image/png')
            self.assertEqual(raised.exception.status, 413)

    def test_quality_geometry_embedding_and_freshness_fail_closed(self):
        self.assertEqual(embed_face(textured(), FACE, lambda *_: textured(), lambda _: VECTOR).shape, (512,))
        cases = [
            (FACE, lambda *_: np.zeros((112, 112, 3), np.uint8), lambda _: VECTOR, None, 'image_blurry'),
            (np.full(15, np.nan), lambda *_: textured(), lambda _: VECTOR, None, 'invalid_landmarks'),
            (FACE, lambda *_: textured(), lambda _: np.full(512, np.nan), None, 'embedding_failed'),
            (FACE, lambda *_: textured(), lambda _: VECTOR, lambda: False, 'stale_frame'),
        ]
        for face, align, embedding, fresh, reason in cases:
            with self.subTest(reason=reason), self.assertRaises(SampleRejected) as raised:
                embed_face(textured(), face, align, embedding, fresh=fresh)
            self.assertEqual(raised.exception.reason, reason)


class SingleImageSessionTests(unittest.TestCase):
    def capture(self, **kwargs):
        return CaptureSession(allow_single_image=True, deadline_seconds=180, **kwargs)

    def test_one_camera_sample_is_opt_in_and_legacy_stays_three(self):
        legacy = CaptureSession()
        with self.assertRaises(ValueError): legacy.start('SYNTHETIC', legacy.contract, 1)
        capture = self.capture()
        sid = capture.start('SYNTHETIC', capture.contract, 1)['session_id']
        capture.observe([FACE], lambda _: VECTOR, preview=preview_jpeg(textured()))
        value = capture.status(sid, result=True)
        self.assertEqual((value['source'], value['state'], value['samples'], value['required']), ('camera', 'ready', 1, 1))
        self.assertEqual(len(value['embedding']), 512)
        self.assertTrue(capture.preview(sid).startswith(b'\xff\xd8'))
        capture.cancel(sid)
        with self.assertRaises(FileNotFoundError): capture.preview(sid)

    def test_upload_uses_same_profile_but_never_consumes_camera_observations(self):
        capture = self.capture()
        sid = capture.start_upload('SYNTHETIC', capture.contract, textured())['session_id']
        capture.observe([FACE], lambda _: VECTOR)
        self.assertEqual(capture.status(sid)['samples'], 0)
        adapter = SimpleNamespace(detect=lambda _: [FACE], align=lambda *_: textured(), get_embedding=lambda _: VECTOR)
        self.assertTrue(process_uploaded(capture, adapter))
        value = capture.status(sid, result=True)
        self.assertEqual((value['source'], value['state'], value['required'], value['samples']), ('upload', 'ready', 1, 1))
        self.assertEqual(value['embedding'], VECTOR.tolist())
        self.assertIsNone(capture.take_upload())

    def test_one_camera_sample_retries_rejections_and_cannot_use_pre_start_frame(self):
        capture = self.capture(); sid = capture.start('SYNTHETIC', capture.contract, 1)['session_id']
        capture.observe([FACE], lambda _: VECTOR, session_id=None)
        self.assertEqual(capture.status(sid)['samples'], 0)
        for faces, reason in [([], 'no_face'), ([FACE, FACE], 'multiple_faces')]:
            capture.observe(faces, lambda _: VECTOR, session_id=sid)
            self.assertEqual((capture.status(sid)['samples'], capture.status(sid)['reason']), (0, reason))
        def rejected(_):raise SampleRejected('stale_frame')
        capture.observe([FACE], rejected, session_id=sid)
        self.assertEqual(capture.status(sid)['reason'], 'stale_frame')
        capture.observe([FACE], lambda _: VECTOR, session_id=sid)
        self.assertEqual((capture.status(sid)['state'], capture.status(sid)['samples']), ('ready', 1))

    def test_upload_embedding_error_is_rejected_without_worker_crash(self):
        capture = self.capture(); sid = capture.start_upload('SYNTHETIC', capture.contract, textured())['session_id']
        def failed(_):raise RuntimeError('synthetic inference failure')
        self.assertTrue(process_uploaded(capture, SimpleNamespace(detect=lambda _: [FACE], align=lambda *_: textured(), get_embedding=failed)))
        self.assertEqual((capture.status(sid)['state'], capture.status(sid)['reason']), ('rejected', 'embedding_failed'))
        self.assertNotIn('embedding', capture.status(sid, result=True))

    def test_live_stale_frame_cannot_change_static_upload_state(self):
        capture = self.capture(); sid = capture.start_upload('SYNTHETIC', capture.contract, textured())['session_id']
        capture.reject_stale_frame(sid)
        self.assertEqual(capture.status(sid)['state'], 'queued')
        self.assertNotIn('reason', capture.status(sid))
        process_uploaded(capture, SimpleNamespace(detect=lambda _: [], align=None, get_embedding=None))
        capture.reject_stale_frame(sid)
        self.assertEqual((capture.status(sid)['state'], capture.status(sid)['reason']), ('rejected','no_face'))

    def test_upload_rejections_and_inflight_cancel_cannot_resurrect(self):
        for faces, reason in [([], 'no_face'), ([FACE, FACE], 'multiple_faces')]:
            capture = self.capture(); sid = capture.start_upload('SYNTHETIC', capture.contract, textured())['session_id']
            adapter = SimpleNamespace(detect=lambda _: faces, align=lambda *_: textured(), get_embedding=lambda _: VECTOR)
            process_uploaded(capture, adapter)
            self.assertEqual((capture.status(sid)['state'], capture.status(sid)['reason']), ('rejected', reason))
            self.assertNotIn('embedding', capture.status(sid, result=True))
        capture = self.capture(); old = capture.start_upload('SYNTHETIC', capture.contract, textured())['session_id']
        def embedding(_):
            capture.cancel(old)
            capture.start('OTHER', capture.contract, 1)
            return VECTOR
        process_uploaded(capture, SimpleNamespace(detect=lambda _: [FACE], align=lambda *_: textured(), get_embedding=embedding))
        self.assertEqual(capture.value['user_code'], 'OTHER')
        self.assertEqual(capture.samples, [])

    def test_lazy_expiry_removes_all_session_image_buffers(self):
        now = [0.]
        capture = self.capture(clock=lambda: now[0]); sid = capture.start_upload('SYNTHETIC', capture.contract, textured())['session_id']
        now[0] = 180
        with self.assertRaises(FileNotFoundError): capture.status(sid)
        self.assertIsNone(capture.take_upload())

    def test_worker_upload_auth_decode_and_ram_only_stream(self):
        import json
        capture = self.capture(); app = create_app(SimpleNamespace(capture=capture), device_key='x'*32)
        client = app.test_client()
        def data(raw=None):
            return {'user_code': 'SYNTHETIC', 'embedding_contract': json.dumps(capture.contract),
                    'face_image': (io.BytesIO(raw or image_bytes()), '../../untrusted.png')}
        self.assertEqual(client.post('/capture-sessions', data=data()).status_code, 401)
        response = client.post('/capture-sessions', data=data(), headers={'X-Device-Key': 'x'*32})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json['source'], 'upload')
        capture.cancel(response.json['session_id'])
        bad = client.post('/capture-sessions', data=data(b'invalid'), headers={'X-Device-Key': 'x'*32})
        self.assertEqual(bad.status_code, 400)
        self.assertIsNone(capture.value)
        self.assertIsInstance(app.request_class({})._get_file_stream(100, 'image/png', 'ignored.png', 100), io.BytesIO)


if __name__ == '__main__': unittest.main()
