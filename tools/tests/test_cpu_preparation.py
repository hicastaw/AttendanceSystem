"""Isolated R50 adapter/descriptor regressions; tiny generated ONNX, no faces."""
import copy
import ast
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock, patch
import uuid

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'AIOT/edge'), str(ROOT / 'tools')]
from cpu_onnx import (descriptor_contract, validate_descriptor, tensor, checked_session,
                       DescriptorRecognizer, DescriptorDetector, load_descriptor)
from cpu_model_tool import baseline_descriptor, inspect_artifact
from cpu_test_runtime import CPUWorkerAdapter, read_run
from capture_session import CaptureSession
from member_gallery import MemberGallery, GalleryFetchResult
from model_contract import LEGACY_CONTRACT
from pipeline import Detection, TARGET


class CPUPreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='aiot-software-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.descriptor = baseline_descriptor(self.root)
        self.contract = descriptor_contract(self.descriptor)

    def marker(self):
        value = dict(schema=1, purpose='isolated-cpu-test', run_id=str(uuid.uuid4()),
                     contracts=[self.contract], active_contract_id=self.contract['contract_id'],
                     test_matching=dict(threshold=.6, minimum_margin=.05),
                     test_capture=dict(deadline_seconds=180,max_sample_gap_seconds=60))
        path = self.root / 'cpu-test-run.json'
        path.write_text(json.dumps(value), encoding='utf-8')
        return path, value

    def test_explicit_descriptor_rejects_unsafe_or_unknown_inputs(self):
        for field, value in [('production_approved', True), ('ftz', 'false'), ('alignment_id', 'legacy'), ('license', ''), ('detection_threshold', float('nan'))]:
            candidate = copy.deepcopy(self.descriptor); candidate[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):validate_descriptor(candidate)
        for field, value in [('color', 'auto'), ('sha256', 'filename'), ('std', [0]*3), ('shape', [1,112,112,3])]:
            candidate = copy.deepcopy(self.descriptor); candidate['recognizer'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):validate_descriptor(candidate)

    def test_golden_configurable_tensor_and_output_binding(self):
        spec = self.descriptor['recognizer']
        image = np.broadcast_to(np.array([0,127,255],np.uint8),(112,112,3)).copy()
        np.testing.assert_allclose(tensor(image,spec)[0,:,0,0],[1,-.5/127.5,-1],atol=1e-7)
        spec.update(color='BGR',mean=[0,0,0],std=[1,2,5])
        np.testing.assert_allclose(tensor(image,spec)[0,:,0,0],[0,63.5,51])
        session = Mock(); session.run.return_value = [np.ones((1,512),np.float32)]
        self.assertEqual(DescriptorRecognizer(session,spec).get_embedding(image).shape,(512,))
        self.assertEqual(session.run.call_args.args[0],['642'])
        session.run.return_value=[np.full((1,512),np.nan)]
        with self.assertRaises(ValueError):DescriptorRecognizer(session,spec).get_embedding(image)

    def test_contract_version_numeric_preprocessing_and_bindings_are_distinct(self):
        for mutate in (lambda d:d.update(ftz=True), lambda d:d.update(model_version='next'),
                       lambda d:d['recognizer'].update(mean=[0,0,0]), lambda d:d['recognizer'].update(input='other')):
            candidate = copy.deepcopy(self.descriptor); mutate(candidate)
            self.assertNotEqual(descriptor_contract(candidate)['contract_id'],self.contract['contract_id'])
        moved = copy.deepcopy(self.descriptor); moved['recognizer']['path']='elsewhere.onnx'
        self.assertEqual(descriptor_contract(moved),self.contract)
        self.assertEqual(self.contract['numeric_mode'],'ort-f32-default-v1')
        self.assertIs(type(self.contract['tensor_bindings']['detector']['std'][0]),int)

    def test_main_rejects_an_unscoped_adapter_before_resources(self):
        tree=ast.parse((ROOT/'AIOT/edge/main.py').read_text(encoding='utf-8'))
        function=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='main')
        config=NS(validate_runtime=Mock(),EMBEDDING_BACKEND='cv2dnn')
        namespace=dict(config=config,validate_backend=Mock())
        exec(compile(ast.Module(body=[function],type_ignores=[]),'main-guard','exec'),namespace)
        with self.assertRaisesRegex(ValueError,'isolated CPU adapter'):namespace['main'](cpu_test=object())
        config.validate_runtime.assert_called_once()

    def test_cpu_diagnostics_is_authenticated_and_absent_from_legacy(self):
        from health import AppState
        from stream_server import create_app
        state=AppState();key='test-only-device-key-with-24-characters'
        client=create_app(state,device_key=key).test_client()
        self.assertEqual(client.get('/cpu-test-diagnostics').status_code,401)
        self.assertEqual(client.get('/cpu-test-diagnostics',headers={'X-Device-Key':key}).status_code,404)
        path,_=self.marker();adapter=CPUWorkerAdapter(path,NS(contract=self.contract),Mock())
        state.cpu_test_diagnostics=adapter.diagnostics
        response=client.get('/cpu-test-diagnostics',headers={'X-Device-Key':key})
        self.assertEqual(response.status_code,200);self.assertEqual(response.headers['Cache-Control'],'no-store')
        self.assertEqual(response.json['scope'],'isolated-cpu-test');self.assertNotIn('embedding',response.json)

    def test_real_ort_tiny_onnx_hash_io_and_checkpoint_no_pickle(self):
        import hashlib
        import onnx
        from onnx import helper, TensorProto, numpy_helper
        spec = copy.deepcopy(self.descriptor['recognizer'])
        graph = helper.make_graph([helper.make_node('Constant',[],['embedding'],value=numpy_helper.from_array(np.ones((1,512),np.float32)))],
                                  'synthetic-not-r50',[helper.make_tensor_value_info('input',TensorProto.FLOAT,['batch',3,112,112])],
                                  [helper.make_tensor_value_info('embedding',TensorProto.FLOAT,[1,512])])
        model = helper.make_model(graph,opset_imports=[helper.make_opsetid('',13)]);model.ir_version=10
        path = self.root/'synthetic.onnx';onnx.save(model,path)
        spec.update(path=str(path),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),input='input',outputs=[dict(name='embedding',shape=[1,512])])
        session = checked_session(spec,self.root,1,False)
        self.assertEqual(DescriptorRecognizer(session,spec).get_embedding(np.zeros((112,112,3),np.uint8)).shape,(512,))
        self.assertEqual(inspect_artifact(path)['status'],'GRAPH_VALID_NOT_LINEAGE_VERIFIED')
        spec['input']='wrong'
        with self.assertRaisesRegex(ValueError,'INPUT'):checked_session(spec,self.root,1,False)
        spec['sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'SHA'):checked_session(spec,self.root,1,False)
        checkpoint=self.root/'unknown.pth';checkpoint.write_bytes(b'not trusted pickle')
        result=inspect_artifact(checkpoint)
        self.assertFalse(result['checkpoint_deserialized']);self.assertEqual(result['status'],'BLOCKED_EXPORT_FACTORY_REQUIRED')

    def test_gallery_restart_mismatch_and_mbf_separation(self):
        vector=np.eye(1,512)[0].tolist(); data=[dict(user_code='TEST',full_name='Synthetic',embedding=vector)]
        api=NS(get_face_data=lambda:GalleryFetchResult(True,data=data,contract=self.contract))
        path=self.root/'candidate-gallery.json'
        gallery=MemberGallery(path,source='http://127.0.0.1:1',contract=self.contract)
        self.assertFalse(gallery.allow_legacy);self.assertTrue(gallery.refresh(api))
        restored=MemberGallery(path,source=gallery.source,contract=self.contract);self.assertTrue(restored.restore())
        self.assertEqual(restored.version,gallery.version)
        mbf=MemberGallery(path,source=gallery.source);self.assertFalse(mbf.restore())
        changed=copy.deepcopy(self.descriptor);changed['ftz']=True
        other=MemberGallery(path,source=gallery.source,contract=descriptor_contract(changed));self.assertFalse(other.restore())
        self.assertFalse(other.refresh(api));self.assertEqual(other.entries,[])
        api.get_face_data=lambda:GalleryFetchResult(True,data=data,contract=None)
        empty=MemberGallery(self.root/'empty.json',source=gallery.source,contract=self.contract)
        self.assertFalse(empty.refresh(api))

    def test_enrollment_same_contract_three_to_eight_and_result_copy(self):
        clock=[0.];capture=CaptureSession(contract=self.contract,clock=lambda:clock[0])
        for n in (2,9,True):
            with self.assertRaises(ValueError):capture.start('TEST',self.contract,n)
        with self.assertRaises(ValueError):capture.start('TEST',LEGACY_CONTRACT,3)
        for n in (3,8):
            session=capture.start('TEST',self.contract,n)
            for _ in range(n):
                capture.observe([1],lambda _:np.eye(1,512)[0]);clock[0]+=.25
            value=capture.status(session['session_id'],result=True)
            self.assertEqual(value['state'],'ready');self.assertEqual(len(value['embedding']),512)
            value['embedding_contract']['tensor_bindings']['recognizer']['color']='WRONG'
            self.assertEqual(capture.contract,self.contract)
            self.assertEqual(capture.status(session['session_id'])['embedding_contract'],self.contract)
            capture.cancel(session['session_id'])

    def test_r50_test_capture_policy_accepts_slow_samples_without_changing_default(self):
        clock=[0.]
        legacy=CaptureSession(contract=self.contract,clock=lambda:clock[0])
        session=legacy.start('TEST',self.contract,3)
        legacy.observe([1],lambda _:np.eye(1,512)[0]);clock[0]+=2
        legacy.observe([1],lambda _:np.eye(1,512)[0])
        self.assertEqual(legacy.status(session['session_id'])['samples'],1)
        candidate=CaptureSession(contract=self.contract,clock=lambda:clock[0],deadline_seconds=90,max_sample_gap_seconds=10)
        session=candidate.start('TEST',self.contract,3)
        for _ in range(3):
            candidate.observe([1],lambda _:np.eye(1,512)[0]);clock[0]+=3
        self.assertEqual(candidate.status(session['session_id'])['state'],'ready')
        with self.assertRaises(ValueError):CaptureSession(contract=self.contract,deadline_seconds=301)

    def test_adapter_geometry_and_enrollment_share_alignment(self):
        path,_=self.marker()
        detector=NS(detect=lambda image:[Detection((1,2,100,110),TARGET.copy(),.9)])
        pipeline=NS(contract=self.contract,detector=detector)
        adapter=CPUWorkerAdapter(path,pipeline,Mock())
        image=np.zeros((112,112,3),np.uint8);row=adapter.detect(image,detect_width=320)[0]
        np.testing.assert_allclose(row[:4],[1,2,99,108]);np.testing.assert_allclose(row[4:14].reshape(5,2),TARGET)
        self.assertEqual(adapter.align(image,row).shape,(112,112,3))

    def test_runtime_rejects_production_paths_remote_backend_and_wrong_handshake(self):
        path,value=self.marker();adapter=CPUWorkerAdapter(path,NS(contract=self.contract),Mock())
        config=NS(EDGE_OUTBOX_PATH=self.root/'outbox.db',MEMBER_GALLERY_CACHE_PATH=self.root/'gallery.json',
                  SERVER_BASE_URL='http://127.0.0.1:1',EDGE_DEVICE_KEY='test-only-key',SIMILARITY_THRESHOLD=.6)
        response=Mock();response.json.return_value=dict(run_id=value['run_id'],embedding_contract=self.contract,scope='isolated-cpu-test')
        with patch('cpu_test_runtime.requests.get',return_value=response) as get:
            adapter.validate(config);self.assertEqual(get.call_args.kwargs['allow_redirects'],False)
            response.json.return_value={}
            with self.assertRaisesRegex(ValueError,'attest'):adapter.validate(config)
            config.SERVER_BASE_URL='https://example.invalid'
            with self.assertRaisesRegex(ValueError,'loopback'):adapter.validate(config)
            config.EDGE_OUTBOX_PATH=ROOT/'production.db'
            with self.assertRaisesRegex(ValueError,'persistence'):adapter.validate(config)
            config.EDGE_OUTBOX_PATH=self.root/'outbox.db';config.MEMBER_GALLERY_CACHE_PATH=self.root/'test.db'
            with self.assertRaisesRegex(ValueError,'persistence'):adapter.validate(config)
        with self.assertRaises(ValueError):read_run(ROOT/'cpu-test-run.json')

    def test_detector_does_not_guess_changed_output_shapes(self):
        spec=self.descriptor['detector'];session=Mock()
        session.run.return_value=[np.zeros(x['shape'],np.float32) for x in spec['outputs']]
        detector=DescriptorDetector(session,spec,.5,.4)
        self.assertEqual(detector.detect(np.zeros((101,203,3),np.uint8)),[])
        session.run.return_value[0]=np.zeros((12800,1),np.float32)
        with self.assertRaisesRegex(ValueError,'OUTPUT'):detector.detect(np.zeros((112,112,3),np.uint8))

    def test_dynamic_batch_is_supported_but_dynamic_features_are_not_guessed(self):
        spec=self.descriptor['recognizer']
        session=NS(get_inputs=lambda:[NS(name=spec['input'],shape=['N',3,112,112],type='tensor(float)')],
                   get_outputs=lambda:[NS(name='642',shape=['N',512],type='tensor(float)')])
        with patch('cpu_onnx.model_session',return_value=session) as factory:
            self.assertIs(checked_session(spec,self.root,4,False),session)
            self.assertIs(factory.call_args.kwargs['allow_spinning'],False)
            session.get_outputs=lambda:[NS(name='642',shape=[1,'features'],type='tensor(float)')]
            with self.assertRaisesRegex(ValueError,'OUTPUT'):checked_session(spec,self.root,4,False)

    def test_explicit_integer_operating_point_keeps_cross_language_contract_id(self):
        from experimental_cpu import ExperimentalPipeline
        descriptor=copy.deepcopy(self.descriptor);descriptor['detection_threshold']=1.0
        contract=descriptor_contract(descriptor)
        pipeline=ExperimentalPipeline(NS(score_threshold=1.,nms_threshold=.4),NS(),artifacts_verified=True,reference_contract=contract)
        self.assertEqual(pipeline.contract,contract)


if __name__=='__main__':unittest.main()
