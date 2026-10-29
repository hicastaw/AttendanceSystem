from pathlib import Path
import ast
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import patch
import cv2
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from browser_camera import BrowserCamera,jpeg_dimensions


class Response:
    status_code=200
    headers={'Content-Type':'image/jpeg','X-Frame-Sequence':'1','X-Frame-Age-Ms':'20','X-Camera-Session':'a'*36}
    def __enter__(self):return self
    def __exit__(self,*_):pass
    def raise_for_status(self):pass
    def close(self):pass
    def iter_content(self,_):yield self.data


class BrowserCameraTests(unittest.TestCase):
    def test_decodes_new_synthetic_frame_and_does_not_treat_idle_as_driver_failure(self):
        ok,data=cv2.imencode('.jpg',np.zeros((48,64,3),dtype=np.uint8));self.assertTrue(ok)
        response=Response();response.data=data.tobytes()
        self.assertEqual(jpeg_dimensions(response.data),(64,48))
        camera=BrowserCamera('http://127.0.0.1:3080/__browser-camera/next','synthetic-key',wait_seconds=0);camera.open()
        with patch.object(camera.session,'get',return_value=response):
            ok,frame=camera.read();self.assertTrue(ok);self.assertEqual(frame.shape,(48,64,3))
            with self.assertRaisesRegex(ValueError,'repeated'):camera.read()
        response.status_code=204
        with patch.object(camera.session,'get',return_value=response):
            self.assertEqual(camera.read(),(False,None));self.assertTrue(camera.waiting_for_frame)

    def test_rejects_remote_source_and_oversized_jpeg_before_decode(self):
        with self.assertRaisesRegex(ValueError,'loopback'):BrowserCamera('http://example.com/frame','key')
        ok,data=cv2.imencode('.jpg',np.zeros((721,64,3),dtype=np.uint8));self.assertTrue(ok)
        with self.assertRaisesRegex(ValueError,'1280x720'):jpeg_dimensions(data.tobytes())
        with self.assertRaises(ValueError):jpeg_dimensions(b'not an image')

    def test_short_interframe_wait_preserves_continuity(self):
        _,data=cv2.imencode('.jpg',np.zeros((48,64,3),dtype=np.uint8))
        idle=Response();idle.status_code=204
        fresh=Response();fresh.data=data.tobytes()
        camera=BrowserCamera('http://127.0.0.1:3080/__browser-camera/next','synthetic-key')
        with patch.object(camera.session,'get',side_effect=[idle,fresh]),patch('browser_camera.time.sleep'):
            ok,_=camera.read();self.assertTrue(ok);self.assertFalse(camera.waiting_for_frame)

    def test_camera_owner_change_marks_identity_continuity_for_reset(self):
        _,data=cv2.imencode('.jpg',np.zeros((48,64,3),dtype=np.uint8))
        first=Response();first.data=data.tobytes();first.headers=dict(Response.headers)
        second=Response();second.data=data.tobytes();second.headers={**Response.headers,'X-Frame-Sequence':'2','X-Camera-Session':'b'*36}
        camera=BrowserCamera('http://127.0.0.1:3080/__browser-camera/next','synthetic-key')
        with patch.object(camera.session,'get',side_effect=[first,second]):
            self.assertTrue(camera.read()[0]);self.assertFalse(camera.source_changed)
            self.assertTrue(camera.read()[0]);self.assertTrue(camera.source_changed)

    def test_worker_distinguishes_waiting_browser_from_failed_legacy_camera(self):
        tree=ast.parse((Path(__file__).resolve().parents[2]/'AIOT/edge/main.py').read_text(encoding='utf-8'))
        function=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='_read_camera')
        namespace={};exec(compile(ast.Module(body=[function],type_ignores=[]),'main-read-camera','exec'),namespace)
        camera=SimpleNamespace(is_opened=True,browser_source=True,waiting_for_frame=True,read=lambda:(False,None))
        self.assertIsNone(namespace['_read_camera'](camera))
        camera.browser_source=False;camera.release=lambda:None
        with self.assertRaises(OSError):namespace['_read_camera'](camera)


if __name__=='__main__':unittest.main()
