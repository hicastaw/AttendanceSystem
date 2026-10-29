from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools'))
import run_cpu_test_worker as worker


class LaptopCameraTests(unittest.TestCase):
    def test_windows_tries_directshow_then_media_foundation_for_selected_index(self):
        attempts=[]
        class Capture:
            def __init__(self,index,backend):self.index=index;self.backend=backend;self.opened=backend==worker.cv2.CAP_MSMF;self.released=False
            def isOpened(self):return self.opened
            def set(self,*_):return True
            def read(self):return True,np.zeros((2,2,3),dtype=np.uint8)
            def release(self):self.released=True
        def create(index,backend):
            attempts.append((index,backend));return Capture(index,backend)
        with patch.object(worker.platform,'system',return_value='Windows'),patch.object(worker.cv2,'VideoCapture',side_effect=create):
            camera=worker.OptInLaptopCamera(3)
            self.assertTrue(camera.open())
        self.assertEqual(attempts,[(3,worker.cv2.CAP_DSHOW),(3,worker.cv2.CAP_MSMF)])
        self.assertTrue(camera.is_opened);self.assertEqual(camera.device,'laptop-camera:3')
        camera.release();self.assertFalse(camera.is_opened)

    def test_camera_open_failure_has_actionable_message_without_index_fallback(self):
        attempts=[]
        class Capture:
            def isOpened(self):return False
            def release(self):pass
        def create(index,backend):attempts.append((index,backend));return Capture()
        with patch.object(worker.platform,'system',return_value='Windows'),patch.object(worker.cv2,'VideoCapture',side_effect=create):
            camera=worker.OptInLaptopCamera(2)
            with self.assertLogs('run_cpu_test_worker',level='ERROR') as logs:
                self.assertFalse(camera.open())
        self.assertEqual(attempts,[(2,worker.cv2.CAP_DSHOW),(2,worker.cv2.CAP_MSMF)])
        self.assertIn('Camera index 2 unavailable',camera.last_error)
        self.assertIn('close Teams/Zoom/Camera',camera.last_error)
        self.assertIn('another explicit --camera index',camera.last_error)
        self.assertIn('Camera index 2 unavailable',logs.output[0])


if __name__=='__main__':unittest.main()
