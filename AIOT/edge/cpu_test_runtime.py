"""Explicit test-only bridge into main's existing camera-owner/attendance loop.

Requires a new named temporary run, loopback backend handshake and separate DBs.
An R50 environment flag alone can never enable this adapter.
"""
import json
import os
import logging
import time
from pathlib import Path
import tempfile
from urllib.parse import urlsplit
import uuid

import numpy as np
import requests
from integration_gate import validate_candidate_contract
from pipeline import align_five_points


def read_run(path):
    path = Path(path).resolve()
    root = path.parent
    if root.parent != Path(tempfile.gettempdir()).resolve() or not root.name.startswith('aiot-software-test-') or path.name != 'cpu-test-run.json':
        raise ValueError('CPU runtime requires a named isolated temporary run')
    if path.stat().st_size > 128 * 1024:
        raise ValueError('CPU run marker too large')
    value = json.loads(path.read_text(encoding='utf-8'))
    if type(value.get('schema')) is not int or value['schema'] != 1 or value.get('purpose') not in ('isolated-cpu-test','isolated-r50-laptop-test') or str(uuid.UUID(value['run_id'])) != value['run_id']:
        raise ValueError('Invalid CPU test run marker')
    contracts = value.get('contracts')
    if not isinstance(contracts, list) or not 1 <= len(contracts) <= 16:
        raise ValueError('Explicit candidate contract registry required')
    for contract in contracts:
        validate_candidate_contract(contract)
    if len({c['contract_id'] for c in contracts}) != len(contracts):
        raise ValueError('Duplicate contract registry entry')
    if value.get('active_contract_id') not in {c['contract_id'] for c in contracts}:
        raise ValueError('Active contract must be registered')
    return root, value


class CPUWorkerAdapter:
    def __init__(self, run_path, pipeline, camera_factory, *, cpu_placement=None):
        self.run_path = Path(run_path).resolve()
        self.root, self.run = read_run(self.run_path)
        self.pipeline, self.camera_factory = pipeline, camera_factory
        self.cpu_placement = cpu_placement
        if pipeline.contract not in self.run['contracts'] or pipeline.contract['contract_id'] != self.run['active_contract_id']:
            raise ValueError('Configured model differs from isolated backend contract')
        self.contract = pipeline.contract
        policy = self.run.get('test_matching', {})
        threshold, margin = policy.get('threshold'), policy.get('minimum_margin')
        if type(threshold) not in (float, int) or not np.isfinite(threshold) or not -1 <= threshold <= 1:
            raise ValueError('Explicit uncalibrated TEST matching threshold required')
        if type(margin) not in (float, int) or not np.isfinite(margin) or not 0 <= margin <= 2:
            raise ValueError('Explicit uncalibrated TEST matching margin required')
        self.threshold, self.margin = threshold, margin
        capture = self.run.get('test_capture')
        if not isinstance(capture,dict):
            raise ValueError('Explicit isolated capture timing policy required')
        deadline, gap = capture.get('deadline_seconds'), capture.get('max_sample_gap_seconds')
        if (type(deadline) not in (int,float) or not np.isfinite(deadline) or not 30 <= deadline <= 240 or
                type(gap) not in (int,float) or not np.isfinite(gap) or not .2 <= gap <= 60):
            raise ValueError('Invalid isolated capture timing policy')
        self.capture_deadline_seconds, self.capture_max_sample_gap_seconds = deadline, gap
        self.timings = {}
        self.detected_faces = None
        self.frames = 0
        self._last_log = 0

    def validate(self, config):
        root, run = read_run(self.run_path)
        if run != self.run:
            raise ValueError('Test run marker changed')
        if (Path(config.EDGE_OUTBOX_PATH).resolve() != root/'outbox.db' or
                Path(config.MEMBER_GALLERY_CACHE_PATH).resolve() != root/'gallery.json'):
            raise ValueError('CPU worker persistence must use separate named files in the isolated run')
        url = urlsplit(config.SERVER_BASE_URL)
        if url.scheme != 'http' or url.hostname not in ('127.0.0.1', '::1') or url.path not in ('', '/') or url.query or url.fragment or url.username or url.password:
            raise ValueError('CPU test backend must be loopback')
        if config.SIMILARITY_THRESHOLD != self.threshold:
            raise ValueError('Worker threshold differs from explicit test policy')
        response = requests.get(config.SERVER_BASE_URL.rstrip('/') + '/api/cpu-test/scope',
                                headers={'X-Device-Key': config.EDGE_DEVICE_KEY}, timeout=3, allow_redirects=False)
        response.raise_for_status()
        if response.json() != dict(run_id=run['run_id'], embedding_contract=self.contract, scope='isolated-cpu-test'):
            raise ValueError('Backend did not attest the matching isolated run')

    def detect(self, image, **_kwargs):
        started = time.perf_counter()
        faces = self.pipeline.detector.detect(image)
        self.timings['detector_ms'] = round((time.perf_counter()-started)*1000, 2)
        self.detected_faces = len(faces)
        self.frames += 1
        rows = []
        for face in faces:
            x1, y1, x2, y2 = face.bbox_xyxy
            rows.append([x1, y1, x2-x1, y2-y1, *face.landmarks_5.reshape(-1), face.score])
        return np.asarray(rows, dtype=np.float64).reshape(-1, 15)

    def align(self, image, face):
        started = time.perf_counter()
        value = align_five_points(image, face[4:14].reshape(5, 2))
        self.timings['alignment_ms'] = round((time.perf_counter()-started)*1000, 2)
        return value

    def diagnostics(self):
        return dict(scope='isolated-r50-laptop-test' if self.run['purpose']=='isolated-r50-laptop-test' else 'isolated-cpu-test',contract_id=self.contract['contract_id'],
                    numeric_mode=self.contract['numeric_mode'],detected_faces=self.detected_faces,
                    capture_policy=dict(deadline_seconds=self.capture_deadline_seconds,max_sample_gap_seconds=self.capture_max_sample_gap_seconds),
                    detection_frames=self.frames,timings_ms=dict(self.timings),
                    cpu_placement=self.cpu_placement,production_activated=False)

    def get_embedding(self, aligned):
        started = time.perf_counter()
        value = self.pipeline.recognizer.get_embedding(aligned)
        self.timings['recognition_ms'] = round((time.perf_counter()-started)*1000, 2)
        if time.monotonic()-self._last_log >= 5:
            logging.getLogger(__name__).info('Experimental CPU stage latency_ms=%s', self.timings)
            self._last_log = time.monotonic()
        return value

    def initialize_gallery(self, api, config):
        from member_gallery import MemberGallery
        api.face_data_path = '/api/cpu-test/contracts/' + self.contract['contract_id'] + '/gallery'
        gallery = MemberGallery(config.MEMBER_GALLERY_CACHE_PATH, source=api.base_url, contract=self.contract,
                                allow_legacy=False, max_age_seconds=config.GALLERY_CACHE_MAX_AGE_SECONDS)
        gallery.restore()
        gallery.refresh(api)
        return gallery

    def publish_port(self, port):
        path = self.root / 'cpu-worker-port.json'
        temporary = self.root / 'cpu-worker-port.tmp'
        with temporary.open('w', encoding='utf-8') as stream:
            json.dump(dict(run_id=self.run['run_id'], port=port), stream)
        os.replace(temporary, path)
