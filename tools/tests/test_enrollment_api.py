"""Actual FastAPI routes, synthetic images and explicit detector stubs; no real faces."""
import importlib.util
from io import BytesIO
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import cv2
import numpy as np
from fastapi.testclient import TestClient

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'AIOT/server/ai'))
spec=importlib.util.spec_from_file_location('aiot_enrollment_api',ROOT/'AIOT/server/ai/main.py')
api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)


class EnrollmentTests(unittest.TestCase):
    def setUp(self):
        self.client=TestClient(api.app)
        self.png=cv2.imencode('.png',np.zeros((112,112,3),dtype=np.uint8))[1].tobytes()

    def test_multiple_faces_rejected_without_extracting_embedding(self):
        class Detector:
            def setInputSize(self,size):pass
            def detect(self,image):return None,np.ones((2,15))
        with patch.object(api.engine,'detector',Detector()),patch.object(api.engine,'get_face_embedding',side_effect=AssertionError('must not embed')):
            response=self.client.post('/ai/face/validate',files={'face_image':('synthetic.png',self.png,'image/png')})
            self.assertFalse(response.json()['is_valid'])
            self.assertEqual(response.json()['error_code'],'MULTIPLE_FACES')

    def test_invalid_format_and_corrupt_image_have_json_400(self):
        for content,mime in [(b'not image','image/png'),(self.png,'image/webp')]:
            response=self.client.post('/ai/face/validate',files={'face_image':('test',content,mime)})
            self.assertEqual(response.status_code,400)

    def test_aligned_crop_uses_no_second_detection_and_has_contract(self):
        with patch.object(api.engine,'detector',None):
            response=self.client.post('/ai/face/embed-aligned',files={'face_image':('aligned.png',self.png,'image/png')})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['embedding_contract'],api.LEGACY_CONTRACT)
        self.assertAlmostEqual(np.linalg.norm(response.json()['embedding']),1,places=5)
        bad=cv2.imencode('.png',np.zeros((100,100,3),dtype=np.uint8))[1].tobytes()
        self.assertEqual(self.client.post('/ai/face/embed-aligned',files={'face_image':('bad.png',bad,'image/png')}).status_code,400)


if __name__=='__main__':unittest.main()
