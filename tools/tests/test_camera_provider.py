from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'AIOT/edge'))
from camera import Camera, Picamera2Camera, create_camera


class CameraTests(unittest.TestCase):
    def test_explicit_backend_preserves_legacy_interface_and_rejects_typo(self):
        camera=create_camera('v4l2','/synthetic',640,480,10)
        self.assertIsInstance(camera,Camera);self.assertFalse(camera.is_opened)
        self.assertEqual(camera.read(),(False,None));camera.release()
        with self.assertRaises(ValueError):create_camera('mock','none',640,480,10)

    def test_csi_request_is_copied_released_and_camera_closed(self):
        raw=np.zeros((2,2,3),dtype=np.uint8);released=[];closed=[]
        class Request:
            def make_array(self,name):return raw
            def release(self):released.append(True);raw[:]=255
        class Device:
            def create_video_configuration(self,**kwargs):return kwargs
            def configure(self,value):self.config=value
            def start(self):pass
            def capture_request(self):return Request()
            def stop(self):closed.append('stop')
            def close(self):closed.append('close')
        device=Device();camera=Picamera2Camera(factory=lambda:device)
        self.assertTrue(camera.open());ok,frame=camera.read()
        self.assertTrue(ok);self.assertEqual(released,[True]);self.assertEqual(int(frame.max()),0)
        self.assertEqual(device.config['buffer_count'],2)
        camera.release();self.assertEqual(closed,['stop','close']);self.assertFalse(camera.is_opened)

    def test_csi_failure_releases_request_without_implicit_fallback(self):
        released=[]
        class Request:
            def make_array(self,name):raise RuntimeError('synthetic capture failure')
            def release(self):released.append(True)
        camera=Picamera2Camera(factory=lambda:None)
        camera._camera=type('Device',(),{'capture_request':lambda self:Request(),'stop':lambda self:None,'close':lambda self:None})()
        with self.assertLogs('camera',level='ERROR'):
            self.assertEqual(camera.read(),(False,None))
        self.assertEqual(released,[True])
        self.assertFalse(camera.is_opened)


if __name__=='__main__':unittest.main()
