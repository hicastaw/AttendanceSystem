"""Actual Flask/Werkzeug CPU runtime, synthetic frames, loopback sockets only."""
from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path
import socket
import sys
import unittest
import requests

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'AIOT/edge'))
from health import AppState
from stream_server import create_app, StreamServer


class FlaskRuntimeTests(unittest.TestCase):
    def test_actual_flask_routes_preserve_existing_health_contract(self):
        state=AppState('synthetic')
        client=create_app(state).test_client()
        self.assertEqual(client.get('/health').get_json(),state.to_health_dict())
        self.assertEqual(client.get('/').status_code,200)

    def test_actual_werkzeug_serves_synthetic_frame_and_releases_listener(self):
        state=AppState('synthetic');state.update_frame(b'synthetic-jpeg-fixture')
        stream=StreamServer(state,'127.0.0.1',0)
        try:
            stream.start()
            url='http://127.0.0.1:'+str(stream.server.server_port)
            with requests.get(url+'/health',timeout=2) as response:
                self.assertEqual(response.status_code,200)
                self.assertEqual(response.json()['camera_device'],'synthetic')
            with requests.get(url+'/video_feed',stream=True,timeout=2) as response:
                self.assertIn(b'synthetic-jpeg-fixture',next(response.iter_content(chunk_size=80)))
        finally:
            self.assertTrue(stream.stop())
        self.assertFalse(stream.thread.is_alive())
        with self.assertRaises(requests.RequestException):requests.get(url+'/health',timeout=.3)

    def test_bind_failure_cleanup_does_not_close_another_listener(self):
        with socket.socket() as occupied:
            occupied.bind(('127.0.0.1',0));occupied.listen()
            port=occupied.getsockname()[1]
            stream=StreamServer(AppState('synthetic'),'127.0.0.1',port)
            try:
                with redirect_stderr(StringIO()),self.assertRaises((SystemExit,OSError)):
                    stream.start()
            finally:
                self.assertTrue(stream.stop())
            self.assertEqual(occupied.getsockname()[1],port)


if __name__=='__main__':unittest.main()
