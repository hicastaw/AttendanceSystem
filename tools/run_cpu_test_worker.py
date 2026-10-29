"""Run the real worker on hash-verified public-domain images in a temp CPU lab.

No production launch option. Input control selects known/unknown/multiple/blank
or camera-error; inference, enrollment, outbox and HTTP ACK are NOT simulated.
"""
import argparse
import json
import logging
import os
import platform
from pathlib import Path
import sys
import threading
import time

import numpy as np
import cv2

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'AIOT/edge'), str(ROOT / 'tools')]
from cpu_onnx import load_descriptor
from cpu_test_runtime import CPUWorkerAdapter, read_run
from validate_real_pipeline import fixture_images
from windows_cpu_placement import place_isolated_worker


class ImageCamera:
    def __init__(self, images, control):
        self.images, self.control = images, control
        self.is_opened, self.device = False, 'public-domain-image-input'

    def open(self):
        self.is_opened = True
        return True

    reconnect = open

    def release(self):
        self.is_opened = False

    def read(self):
        time.sleep(.12)
        scenario = json.loads(self.control.read_text(encoding='utf-8'))['scenario']
        if scenario == 'camera-error':
            return False, None
        if scenario == 'known':
            image = self.images[0]
        elif scenario == 'known-variant':
            # A different augmented fixture frame, not an independent capture.
            image = cv2.convertScaleAbs(self.images[0],alpha=1.02,beta=-2)
        elif scenario == 'unknown':
            image = self.images[1]
        elif scenario == 'multiple':
            image = np.concatenate([self.images[0], self.images[0]], axis=1)
        elif scenario == 'blank':
            image = np.zeros_like(self.images[0])
        else:
            raise ValueError('Unregistered test scenario')
        return True, image.copy()  # Debug annotation must not mutate the fixture.


class OptInLaptopCamera:
    """A single explicitly selected laptop camera; no device fallback."""
    def __init__(self, index, width=640, height=480, fps=10):
        self.index, self.width, self.height, self.fps = index, width, height, fps
        self.is_opened, self.device, self._capture = False, f'laptop-camera:{index}', None
        self.last_error = None

    def open(self):
        self.release()
        backends = ([('DirectShow',cv2.CAP_DSHOW),('Media Foundation',cv2.CAP_MSMF)]
                    if platform.system() == 'Windows' else [('OpenCV default',cv2.CAP_ANY)])
        failures = []
        for name, backend in backends:
            capture = cv2.VideoCapture(self.index,backend)
            if not capture.isOpened():
                capture.release();failures.append(name);continue
            capture.set(cv2.CAP_PROP_FRAME_WIDTH,self.width)
            capture.set(cv2.CAP_PROP_FRAME_HEIGHT,self.height)
            capture.set(cv2.CAP_PROP_FPS,self.fps)
            ok,frame = capture.read()
            if not ok or frame is None:
                capture.release();failures.append(f'{name} opened but returned no frame');continue
            self._capture,self.is_opened = capture,True
            self.last_error = None
            return True
        self.last_error=(f'Camera index {self.index} unavailable; attempted {", ".join(failures)}. '
            'Check Windows camera privacy permission, close Teams/Zoom/Camera or other apps using the webcam, '
            'then try another explicit --camera index.')
        logging.getLogger(__name__).error('%s',self.last_error)
        return False

    def reconnect(self):
        return self.open()

    def release(self):
        if self._capture is not None:
            self._capture.release()
        self._capture, self.is_opened = None, False

    def read(self):
        if not self.is_opened:
            return False, None
        ok, frame = self._capture.read()
        if not ok or frame is None:
            self.release()
            return False, None
        return True, frame


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', type=Path, required=True)
    parser.add_argument('--descriptor', type=Path, required=True)
    parser.add_argument('--fixtures', type=Path)
    parser.add_argument('--browser-source', help='Explicit authenticated loopback browser frame source')
    parser.add_argument('--camera', type=int, help='Explicit laptop camera index; never auto-selected')
    parser.add_argument('--allow-camera', action='store_true', help='Required together with --camera')
    parser.add_argument('--backend', required=True)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--experimental', action='store_true')
    args = parser.parse_args()
    if not args.experimental:
        parser.error('Explicit --experimental required')
    if sum(value is not None for value in (args.fixtures,args.camera,args.browser_source))!=1:
        parser.error('Provide exactly one of --fixtures, --camera or --browser-source')
    if args.camera is not None and (not args.allow_camera or args.camera < 0 or args.camera > 31):
        parser.error('--camera requires --allow-camera and an index 0..31')
    root, run = read_run(args.run)
    placement = place_isolated_worker(run['purpose'])
    if run['purpose'] == 'isolated-r50-laptop-test':
        print(json.dumps(dict(type='cpu-placement', **placement)), flush=True)
    # Bound OpenCV's host-wide thread pool alongside the explicitly bounded ORT
    # pools. This applies ONLY to this disposable CPU worker, never legacy main.
    cv2.setNumThreads(1)
    pipeline = load_descriptor(args.descriptor, experimental=True, threads=args.threads)
    if args.fixtures is not None:
        images = fixture_images(args.fixtures)  # Existing pinned licenses/hashes, no downloads.
        camera_factory = lambda: ImageCamera(images, root / 'input-control.json')
        camera_device = 'public-domain-image-input'
    elif args.browser_source is not None:
        from browser_camera import BrowserCamera
        camera_factory=lambda:BrowserCamera(args.browser_source,os.environ.get('EDGE_DEVICE_KEY',''))
        camera_device='browser-webcam'
    else:
        camera_factory = lambda: OptInLaptopCamera(args.camera)
        camera_device = f'laptop-camera:{args.camera}'
    adapter = CPUWorkerAdapter(args.run, pipeline, camera_factory, cpu_placement=placement)
    os.environ.update(EDGE_ENV_FILE=str(root / 'absent.env'), STREAM_HOST='127.0.0.1', STREAM_PORT='0',
                      SERVER_BASE_URL=args.backend, AI_SERVICE_URL='http://127.0.0.1:1',
                      EDGE_OUTBOX_PATH=str(root / 'outbox.db'), MEMBER_GALLERY_CACHE_PATH=str(root / 'gallery.json'),
                      SIMILARITY_THRESHOLD=str(adapter.threshold), FACE_DATA_REFRESH_SECONDS='1',
                      PROCESS_EVERY_N_FRAMES='1', EMBEDDING_BACKEND='cv2dnn', DEVICE_ID='CPU_TEST_ONLY',
                      CAMERA_DEVICE=camera_device, OUTBOX_RETRY_BASE_SECONDS='.1', OUTBOX_RETRY_MAX_SECONDS='1')
    # Import config/main only AFTER replacing every persistence/network default.
    import main as worker
    def stop_on_stdin():
        for line in sys.stdin:
            if line.strip() == 'stop':
                worker._running = False
                return
        worker._running = False  # Owning test harness disappeared: stop, don't orphan.
    threading.Thread(target=stop_on_stdin, daemon=True).start()
    worker.main(cpu_test=adapter)


if __name__ == '__main__':
    main()
