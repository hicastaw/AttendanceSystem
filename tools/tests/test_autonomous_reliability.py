"""Fault injection only: no camera, .env, real identities or production DB."""
import ast
from contextlib import ExitStack
import logging
from pathlib import Path
from types import SimpleNamespace
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
import uuid
import math
from urllib.parse import urlsplit
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'AIOT/edge'))
from recovery import Recovery, RecoveryExhausted, WorkerStopping
from health import AppState
from capture_session import CaptureSession
from worker_status import WorkerStatus
from api_client import ApiClient
from member_gallery import MemberGallery
from model_contract import LEGACY_CONTRACT
from stream_server import create_app
from camera import Picamera2Camera
from pipeline import Consensus, normalize
from attendance_service import AttendanceDecision
from member_gallery import GalleryFetchResult
import cv2


class RecoveryTests(unittest.TestCase):
    def test_worker_config_validation_is_fail_closed_without_reading_any_env(self):
        tree=ast.parse((ROOT/'AIOT/edge/config.py').read_text(encoding='utf-8'))
        ns=dict(math=math,urlsplit=urlsplit,EDGE_DEVICE_KEY='a'*32,STREAM_HOST='127.0.0.1',CAMERA_WIDTH=640,
                CAMERA_HEIGHT=480,CAMERA_FPS=10,SIMILARITY_THRESHOLD=.6,HTTP_TIMEOUT_SECONDS=3,
                SERVER_BASE_URL='http://127.0.0.1:3001',AI_SERVICE_URL='http://127.0.0.1:8001')
        node=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='validate_runtime')
        exec(compile(ast.Module(body=[node],type_ignores=[]),'config-validator','exec'),ns);ns['validate_runtime']()
        for key,bad in [('EDGE_DEVICE_KEY','change-me'),('STREAM_HOST','0.0.0.0'),('SIMILARITY_THRESHOLD',float('nan')),
                        ('HTTP_TIMEOUT_SECONDS',float('inf')),('SERVER_BASE_URL','http://user:secret@127.0.0.1:3001')]:
            old=ns[key];ns[key]=bad
            with self.assertRaises(ValueError):ns['validate_runtime']()
            ns[key]=old
    def test_actual_main_recovers_detector_fault_resets_consensus_and_cleans_every_owner(self):
        with tempfile.TemporaryDirectory() as folder:
            tree=ast.parse((ROOT/'AIOT/edge/main.py').read_text(encoding='utf-8'))
            functions=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in
                       ('main','_cleanup','_read_camera','_get_embedding','initialize_member_gallery','load_known_embeddings')]
            state=AppState();camera=Mock(is_opened=True,device='synthetic')
            camera.read.return_value=(True,np.zeros((32,32,3),dtype=np.uint8))
            client=SimpleNamespace(base_url='http://127.0.0.1:1',outbox=__import__('outbox').DurableOutbox(Path(folder)/'outbox.db'),
                storage_ok=True,fatal_error=None,server_reachable=True,start=Mock(),stop=Mock(),
                sync_attendance_policy=lambda _:None,get_face_data=lambda:GalleryFetchResult(True,data=[],contract=LEGACY_CONTRACT))
            config=SimpleNamespace(**{name:1 for name in ('CAMERA_WIDTH CAMERA_HEIGHT CAMERA_FPS CAMERA_FOURCC DETECTION_SCORE_THRESHOLD HTTP_TIMEOUT_SECONDS OUTBOX_RETRY_BASE_SECONDS OUTBOX_RETRY_MAX_SECONDS SIMILARITY_THRESHOLD ATTENDANCE_COOLDOWN_SECONDS STREAM_PORT PROCESS_EVERY_N_FRAMES JPEG_QUALITY DETECT_WIDTH').split()},
                FACE_DATA_REFRESH_SECONDS=300,EMBEDDING_BACKEND='cv2dnn',CAMERA_DEVICE='synthetic',CAMERA_BACKEND='stub',
                SERVER_BASE_URL=client.base_url,EDGE_DEVICE_KEY='a'*32,DETECTOR_MODEL_PATH='unused',RECOGNIZER_MODEL_PATH='unused',
                EDGE_OUTBOX_PATH='unused',STREAM_HOST='127.0.0.1',MEMBER_GALLERY_CACHE_PATH=str(Path(folder)/'gallery.json'),
                GALLERY_CACHE_MAX_AGE_SECONDS=30,validate_runtime=lambda:None)
            publisher=Mock();stream=Mock();consensus=Consensus();consensus.observe('OLD')
            ns=dict(ExitStack=ExitStack,config=config,validate_backend=lambda _:None,signal=Mock(),_handle_signal=Mock(),
                AppState=lambda **_:state,WorkerStatus=lambda *a,**k:publisher,Consensus=lambda:consensus,
                create_camera=lambda *a:camera,FaceRecognizer=lambda *a:Mock(),ApiClient=lambda *a,**k:client,
                AttendanceDecision=AttendanceDecision,MemberGallery=MemberGallery,LEGACY_CONTRACT=LEGACY_CONTRACT,
                StreamServer=lambda *a,**k:stream,Recovery=lambda **kw:Recovery(**kw,sleep=lambda _:None),
                WorkerStopping=WorkerStopping,RecoveryExhausted=RecoveryExhausted,time=__import__('time'),sqlite3=sqlite3,
                normalize=normalize,logger=Mock(),notify=Mock(),_running=True)
            attempts=[]
            def detect(*a,**k):
                attempts.append(1)
                if len(attempts)==1:raise cv2.error('synthetic transient inference error')
                ns['_running']=False
                return []
            ns['FaceDetector']=lambda *a,**k:SimpleNamespace(detect=detect)
            exec(compile(ast.Module(body=functions,type_ignores=[]),'actual-main','exec'),ns);ns['main']()
            self.assertEqual(len(attempts),2);self.assertEqual(len(consensus.votes),0)
            self.assertEqual(client.outbox.counts()['pending'],0)
            camera.release.assert_called_once();publisher.stop.assert_called_once();stream.stop.assert_called_once();client.stop.assert_called_once()
            self.assertFalse(state.to_health_dict()['ready'])

    def test_csi_repeated_sensor_timestamp_is_not_a_fresh_frame_and_releases_request(self):
        request=Mock();request.get_metadata.return_value={'SensorTimestamp':100}
        request.make_array.return_value=np.zeros((2,2,3),dtype=np.uint8)
        camera=Mock();camera.capture_request.return_value=request
        provider=Picamera2Camera(factory=lambda:camera)
        self.assertTrue(provider.open());self.assertTrue(provider.read()[0])
        self.assertFalse(provider.read()[0]);self.assertFalse(provider.is_opened)
        self.assertEqual(request.release.call_count,2);camera.close.assert_called_once()
    def test_bounded_transient_recovery_and_programmer_faults(self):
        failures=[];delays=[]
        action=Mock(side_effect=[OSError('secret not logged'),sqlite3.OperationalError('busy'),42])
        recovery=Recovery(failure=failures.append,sleep=delays.append)
        self.assertEqual(recovery.call('model',action),42)
        self.assertEqual(failures,['model','model'])
        self.assertAlmostEqual(sum(delays),.75)
        action=Mock(side_effect=OSError('persistent'))
        with self.assertRaises(RecoveryExhausted):recovery.call('camera',action)
        self.assertEqual(action.call_count,5)
        for fatal in (ValueError('contract'),TypeError('bug'),RuntimeError('unexpected')):
            action=Mock(side_effect=fatal)
            with self.assertRaises(type(fatal)):recovery.call('model',action)
            self.assertEqual(action.call_count,1)

    def test_stop_interrupts_retry_and_does_not_run_more_sdk_calls(self):
        running=[True]
        action=Mock(side_effect=OSError('offline'))
        recovery=Recovery(running=lambda:running[0],sleep=lambda _:running.__setitem__(0,False))
        with self.assertRaises(WorkerStopping):recovery.call('camera',action)
        self.assertEqual(action.call_count,1)

    def test_main_production_camera_helper_reconnects_and_never_returns_invalid_frames(self):
        tree=ast.parse((ROOT/'AIOT/edge/main.py').read_text(encoding='utf-8'))
        ns={};exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_read_camera'],type_ignores=[]),'main-helper','exec'),ns)
        camera=Mock(is_opened=False);camera.reconnect.return_value=False
        with self.assertRaises(OSError):ns['_read_camera'](camera)
        camera.is_opened=True;camera.read.return_value=(False,None)
        with self.assertRaises(OSError):ns['_read_camera'](camera)
        camera.release.assert_called_once()

    def test_health_requires_actual_fresh_pipeline_progress_not_open_flags_or_jpeg(self):
        clock=[0.];state=AppState(clock=lambda:clock[0])
        state.camera_opened=state.model_loaded=True
        state.gallery_status={'origin':'server','member_count':0}
        state.update_frame(b'synthetic')
        self.assertFalse(state.to_health_dict()['ready'])
        state.captured();state.inferred()
        self.assertTrue(state.to_health_dict()['ready'])  # offline local processing allowed
        clock[0]=6
        self.assertFalse(state.to_health_dict()['ready']);self.assertIsNone(state.get_frame())
        state.captured();self.assertFalse(state.to_health_dict()['ready'])
        state.inferred();self.assertTrue(state.to_health_dict()['ready'])
        state.failed('storage');self.assertFalse(state.to_health_dict()['ready'])

    def test_publisher_cannot_keep_reporting_pending_while_main_is_stale(self):
        state=AppState(clock=lambda:10.)
        publisher=WorkerStatus('http://127.0.0.1:1','synthetic',LEGACY_CONTRACT,health=state.to_health_dict)
        try:
            publisher.update('pending',event_id='synthetic-event')
            with patch.object(publisher.session,'post',return_value=Mock(ok=True)) as post:
                publisher.publish()
                body=post.call_args.kwargs['json']
                self.assertFalse(body['pipeline_ready']);self.assertEqual(body['state'],'camera_unavailable')
                self.assertIsNone(body['event_id'])
        finally:publisher.stop()

    def test_outbox_network_budget_blocks_without_dropping_uuid_then_explicit_resume(self):
        with tempfile.TemporaryDirectory() as folder:
            client=ApiClient('http://127.0.0.1:1',outbox_path=Path(folder)/'test.db',max_attempts=2)
            event=dict(event_id=str(uuid.uuid4()),device_id='SYNTH',user_code='TEST001',event_type='check_in',timestamp='2026-10-19T08:00:00+07:00',confidence=90)
            client.send_event_async(event)
            try:
                with patch.object(client._send_session,'post',side_effect=__import__('requests').ConnectionError('offline')):
                    client.run_once()
                    with client.outbox._transaction() as db:db.execute('UPDATE events SET next_retry=0')
                    client.run_once()
                row=client.outbox.get(event['event_id'])
                self.assertEqual(row['status'],'blocked');self.assertEqual(row['event'],event)
                self.assertEqual(row['last_error'],'retry_budget_exhausted')
                self.assertFalse(client.run_once());self.assertIsNone(client.outbox.state('TEST001'))
                self.assertTrue(client.outbox.requeue_blocked(event['event_id']))
                self.assertEqual(client.outbox.get(event['event_id'])['attempts'],0)
            finally:client.stop()

    def test_sender_stops_after_five_storage_faults_and_keeps_pending_payload(self):
        with tempfile.TemporaryDirectory() as folder:
            client=ApiClient('http://127.0.0.1:1',outbox_path=Path(folder)/'test.db')
            event=dict(event_id=str(uuid.uuid4()),device_id='SYNTH',user_code='TEST001',event_type='check_in',timestamp='2026-10-19T08:00:00+07:00',confidence=90)
            client.send_event_async(event)
            try:
                with patch.object(client,'run_once',side_effect=sqlite3.OperationalError('synthetic storage fault')) as action,patch.object(client._wake,'wait'):
                    client._worker()
                self.assertEqual(action.call_count,5);self.assertFalse(client.storage_ok)
                self.assertEqual(client.fatal_error,'storage_retry_exhausted')
                row=client.outbox.get(event['event_id'])
                self.assertEqual(row['status'],'pending');self.assertEqual(row['event'],event)
                self.assertIsNone(client.outbox.state('TEST001'))
            finally:client.stop()

    def test_gallery_expires_between_periodic_refreshes(self):
        with tempfile.TemporaryDirectory() as folder:
            gallery=MemberGallery(Path(folder)/'cache.json',source='synthetic',clock=lambda:100.,max_age_seconds=10)
            gallery.fetched_at=80.;gallery.entries=[dict(user_code='SYNTH')]
            self.assertTrue(gallery.expire());self.assertEqual(gallery.entries,[])


class CaptureTests(unittest.TestCase):
    def test_single_owner_multiframe_centroid_busy_and_expiry(self):
        clock=[0.];capture=CaptureSession(clock=lambda:clock[0])
        session=capture.start('TEST001',LEGACY_CONTRACT,3)
        with self.assertRaises(FileExistsError):capture.start('TEST002',LEGACY_CONTRACT)
        sample=np.eye(1,512)[0]
        for i in range(3):
            clock[0]=i*.3;self.assertTrue(capture.observe([object()],lambda _:sample))
        result=capture.status(session['session_id'],result=True)
        self.assertEqual(result['state'],'ready');np.testing.assert_allclose(result['embedding'],sample)
        self.assertTrue(capture.observe([],lambda _:self.fail('SDK must not run after ready')))
        clock[0]=31.
        with self.assertRaises(FileNotFoundError):capture.status(session['session_id'])
        self.assertEqual(capture.samples,[])

    def test_ambiguous_track_resets_samples_and_cancel_erases_vectors(self):
        clock=[0.];capture=CaptureSession(clock=lambda:clock[0]);session=capture.start('TEST001',LEGACY_CONTRACT)
        capture.observe([1],lambda _:np.eye(1,512)[0]);capture.observe([1,2],lambda _:self.fail('ambiguous'))
        self.assertEqual(capture.samples,[])
        capture.cancel(session['session_id']);self.assertIsNone(capture.value)
        for code,contract,frames in [('bad/code',LEGACY_CONTRACT,5),('TEST001',{},5),('TEST001',LEGACY_CONTRACT,True)]:
            with self.assertRaises(ValueError):capture.start(code,contract,frames)

    def test_worker_capture_api_is_private_and_does_not_own_a_second_camera(self):
        state=AppState();key='a'*32;client=create_app(state,device_key=key).test_client()
        self.assertEqual(client.get('/preview.jpg').status_code,401)
        self.assertEqual(client.post('/capture-sessions',json={}).status_code,401)
        headers={'X-Device-Key':key}
        response=client.post('/capture-sessions',json={'user_code':'TEST001','embedding_contract':LEGACY_CONTRACT},headers=headers)
        self.assertEqual(response.status_code,201)
        self.assertEqual(client.get('/preview.jpg',headers=headers).status_code,503)
        self.assertEqual(client.get('/health').status_code,200)
        self.assertEqual(response.headers['Cache-Control'],'no-store')


if __name__=='__main__':unittest.main()
