"""TEST FIXTURE ONLY. Synthetic vectors/frames; never a camera/model fallback."""
import argparse
import json
from pathlib import Path
import signal
import sys
import tempfile
import time
import numpy as np
import cv2

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'AIOT/edge'))
from health import AppState
from stream_server import StreamServer


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--runtime',type=Path,required=True)
    args=parser.parse_args();path=args.runtime.resolve();directory=path.parent
    if directory.parent!=Path(tempfile.gettempdir()).resolve() or not directory.name.startswith('aiot-software-test-'):
        raise ValueError('Synthetic fixture requires an owned test directory')
    runtime=json.loads(path.read_text(encoding='utf-8'))
    if runtime.get('mode')!='synthetic-capture-test':raise ValueError('Not a synthetic test runtime')
    state=AppState();server=StreamServer(state,'127.0.0.1',0,device_key=runtime['key'])
    running=[True]
    signal.signal(signal.SIGTERM,lambda *_:running.__setitem__(0,False));signal.signal(signal.SIGINT,lambda *_:running.__setitem__(0,False))
    try:
        server.start();print(json.dumps({'port':server.server.server_port}),flush=True)
        while running[0]:
            state.update_frame(cv2.imencode('.jpg',np.zeros((112,112,3),dtype=np.uint8))[1].tobytes())
            state.capture.observe([object()],lambda _:np.eye(1,512)[0])
            time.sleep(.21)
    finally:server.stop()


if __name__=='__main__':main()
