"""Analytical tensors, generated ONNX graphs and temp SQLite only; no face dataset."""
from contextlib import closing
import copy
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock,patch
import uuid
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'AIOT/edge'),str(ROOT/'tools')]
from experimental_cpu import (ExperimentalPipeline, ScrfdDetector, R50Recognizer, DETECTOR_OUTPUTS,
                              detector_tensor,rgb_tensor,model_session,validate_io)
from experimental_hailo import architecture_from_cli,inspect_hef,HailoTransport
from pipeline import Detection,TARGET,align_five_points
from reference_adapters import decode_scrfd
from outbox import DurableOutbox
from health import AppState
from stream_server import StreamServer
from model_cpu_lab import audit,lab_path,write_new,measure
import pipeline_diagnostics as diagnostics
import benchmark_reference


def metadata(name,shape):return NS(name=name,shape=shape,type='tensor(float)')


def heads(size=640):
    counts=[(size//s)**2*2 for s in (8,16,32)]
    return [np.zeros((n,d),np.float32) for d in (1,4,10) for n in counts]


def geometry_detector(count=1):
    return NS(detect=lambda image:[Detection((0,0,112,112),TARGET.copy(),1.) for _ in range(count)])


class TensorGeometryTests(unittest.TestCase):
    def test_rgb_nchw_golden_values_and_contiguous(self):
        pixel=np.broadcast_to(np.array([0,127,255],np.uint8),(112,112,3)).copy()
        value=rgb_tensor(pixel,127.5)
        self.assertEqual(value.shape,(1,3,112,112));self.assertEqual(value.dtype,np.float32);self.assertTrue(value.flags.c_contiguous)
        np.testing.assert_allclose(value[0,:,0,0],[1,-.5/127.5,-1],atol=1e-7)

    def test_top_left_padding_golden_and_rounded_axis_scales(self):
        tensor,scale=detector_tensor(np.full((101,333,3),255,np.uint8))
        self.assertEqual(scale,(640/333,194/101))
        np.testing.assert_allclose(tensor[0,:,193,0],127.5/128)
        np.testing.assert_allclose(tensor[0,:,194,0],-127.5/128)
        output=heads(32);output[0][10,0]=.9;output[3][10]=1
        result=decode_scrfd(output,size=(32,32),scale=(2,4),padding=(2,4))[0]
        np.testing.assert_allclose(result.bbox_xyxy,[-1,-1,7,3]);np.testing.assert_allclose(result.landmarks_5,np.tile([3,1],(5,1)))

    def test_nms_inclusive_pixel_boundary_regression(self):
        output=heads(32);output[0][0:2]=.9
        output[0][1]=0;output[0][2]=.9
        # Use boxes [0,0,8,8], [0,0,16,8], IoU inclusive 9/17 vs continuous .5.
        output[3][0]=[0,0,1,1];output[3][2]=[1,0,1,1];output[3][1]=0
        self.assertEqual(len(decode_scrfd(output,size=(32,32),scale=1,nms_threshold=.51)),1)

    def test_negative_background_regression_is_not_a_contract_failure(self):
        output=heads(32);output[3][:]=-1
        self.assertEqual(decode_scrfd(output,size=(32,32),scale=1),[])
        output[0][0]=.99;output[3][0]=[-1,0,2,1]
        np.testing.assert_allclose(decode_scrfd(output,size=(32,32),scale=1)[0].bbox_xyxy,[8,0,16,8])

    def test_alignment_identity_and_translated_image_golden(self):
        image=np.indices((112,112)).sum(axis=0).astype(np.uint8);image=np.repeat(image[:,:,None],3,axis=2)
        np.testing.assert_array_equal(align_five_points(image,TARGET),image)
        canvas=np.zeros((160,160,3),np.uint8);canvas[20:132,10:122]=image
        np.testing.assert_array_equal(align_five_points(canvas,TARGET+[10,20]),image)

    def test_input_rejection_and_bounded_candidate_budget(self):
        for image in (np.zeros((1,1,3),np.uint8),np.zeros((3,3,3)),np.zeros((3,3,4),np.uint8)):
            with self.assertRaises(ValueError):detector_tensor(image)
        for scale in ((1,0),(1,np.nan),(1,2,3)):
            with self.assertRaises(ValueError):decode_scrfd(heads(32),size=(32,32),scale=scale)
        output=heads();output[0][:]=.9;output[3][:]=1
        with self.assertRaisesRegex(ValueError,'budget'):decode_scrfd(output,size=(640,640),scale=1)

    def test_io_no_shape_or_binding_inference(self):
        session=NS(get_inputs=lambda:[metadata('input',[1,3,112,112])],get_outputs=lambda:[metadata('embedding',[1,512])])
        R50Recognizer(session)
        for bad in (metadata('wrong',[1,512]),metadata('embedding',[512]),metadata('embedding',[1,256])):
            session.get_outputs=lambda:[bad]
            with self.assertRaises(ValueError):R50Recognizer(session)
        session.get_outputs=lambda:[metadata('embedding',[1,512])]
        session.get_inputs=lambda:[metadata('input',[1,3,128,112])]
        with self.assertRaises(ValueError):R50Recognizer(session)


class ExperimentalFlowTests(unittest.TestCase):
    def setUp(self):
        self.image=np.full((112,112,3),123,np.uint8)
        self.recognizer=NS(get_embedding=lambda image:np.eye(1,512)[0])
        self.pipeline=ExperimentalPipeline(geometry_detector(),self.recognizer)

    def test_enrollment_matching_same_contract_and_no_attendance_write(self):
        gallery=self.pipeline.enroll([self.image]*3,'SYNTHETIC')
        result=self.pipeline.match(self.image,gallery,threshold=.999,minimum_margin=.1)
        self.assertEqual(result['state'],'MATCH');self.assertFalse(result['calibrated']);self.assertFalse(result['attendance_written'])
        self.assertEqual(self.pipeline.diagnostics()['state'],'EMBEDDING_OK')
        contract=self.pipeline.contract;contract['preprocess_id']='tamper';self.assertNotEqual(contract,self.pipeline.contract)

    def test_multi_identity_enrollment_is_copy_on_write_never_implicit_replace(self):
        original=self.pipeline.enroll([self.image]*3,'A');before=copy.deepcopy(original)
        self.recognizer.get_embedding=lambda image:np.eye(1,512,1)[0]
        expanded=self.pipeline.enroll([self.image]*3,'B',gallery=original)
        self.assertEqual(original,before);self.assertEqual(len(expanded['entries']),2)
        self.assertEqual(self.pipeline.match(self.image,expanded,threshold=.99,minimum_margin=.1)['code'],'B')
        with self.assertRaises(ValueError):self.pipeline.enroll([self.image]*3,'A',gallery=original)

    def test_mbf_sha_alignment_and_numeric_mode_mismatch_rejected_before_inference(self):
        gallery=self.pipeline.enroll([self.image]*3,'SYNTHETIC')
        for key in ('recognizer_sha256','preprocess_id','alignment_id','numeric_mode','contract_id'):
            changed=copy.deepcopy(gallery);changed['contract'][key]='different'
            with self.assertRaisesRegex(ValueError,'CONTRACT_MISMATCH'):self.pipeline.match(self.image,changed,threshold=.5,minimum_margin=.1)
        with self.assertRaises(ValueError):self.pipeline.match(self.image,{'contract':{'model_id':'w600k_mbf_legacy'},'entries':[]},threshold=.5,minimum_margin=.1)

    def test_unknown_ambiguity_duplicate_invalid_threshold_and_corrupt_vector(self):
        gallery=self.pipeline.enroll([self.image]*3,'A')
        gallery['entries'].append(dict(code='B',embedding=gallery['entries'][0]['embedding']))
        self.assertEqual(self.pipeline.match(self.image,gallery,threshold=.9,minimum_margin=.01)['state'],'UNKNOWN')
        with self.assertRaises(ValueError):self.pipeline.match(self.image,gallery,threshold=float('nan'),minimum_margin=.01)
        gallery['entries'][1]['code']='A'
        with self.assertRaises(ValueError):self.pipeline.match(self.image,gallery,threshold=.9,minimum_margin=.01)
        gallery['entries'].pop();gallery['entries'][0]['embedding']=[0]*512
        with self.assertRaises(ValueError):self.pipeline.match(self.image,gallery,threshold=.9,minimum_margin=.01)

    def test_no_multiple_face_and_failure_clear_diagnostics_without_sensitive_error(self):
        for count,state in ((0,'NO_FACE'),(2,'AMBIGUOUS_FACE_COUNT')):
            self.pipeline.detector=geometry_detector(count)
            self.assertIsNone(self.pipeline.embed(self.image));self.assertEqual(self.pipeline.diagnostics()['state'],state)
            with self.assertRaises(ValueError):self.pipeline.enroll([self.image]*3,'A')
        self.pipeline.detector=geometry_detector()
        self.recognizer.get_embedding=Mock(side_effect=ValueError('private embedding/path sentinel'))
        with self.assertRaises(ValueError):self.pipeline.embed(self.image)
        status=self.pipeline.diagnostics();self.assertEqual(status['last_error'],'ValueError');self.assertNotIn('sentinel',json.dumps(status))

    def test_hash_opt_in_and_isolated_exclusive_gallery_write(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'bad.onnx';path.write_bytes(b'not a model')
            with self.assertRaisesRegex(ValueError,'SHA'):model_session(path,'wrong',1,False)
            with self.assertRaises(ValueError):ExperimentalPipeline.load(folder)
            target=Path(folder)/'gallery.json';write_new(target,{'synthetic':True})
            with self.assertRaises(FileExistsError):write_new(target,{})
        with self.assertRaises(ValueError):lab_path(ROOT/'AIOT/server/data/gallery.json')

    def test_packaging_preserves_experimental_software_not_candidate_weights(self):
        import rpi_release
        inventory=rpi_release.release_inventory()
        for name in ('AIOT/edge/experimental_cpu.py','AIOT/edge/experimental_hailo.py','tools/model_cpu_lab.py','tools/pipeline_diagnostics.py'):
            self.assertIn(name,inventory)
        for name in ('AIOT/edge/model/det_10g.onnx','AIOT/edge/model/vnceleb_ms1mv3_r50_selected.onnx'):
            self.assertNotIn(name,inventory)
        self.assertFalse(any(name.endswith('.hef') for name in inventory))

    def test_benchmark_rejects_unbounded_or_ambiguous_configuration_before_loading(self):
        for options in ({'threads':0},{'threads':33},{'warmup':21},{'sample_kind':'face'}):
            with self.assertRaises(ValueError):benchmark_reference.benchmark('unused','unused',[1,3,112,112],1,**options)

    def test_measurement_timeout_is_reported_not_silently_passed(self):
        from contextlib import redirect_stdout
        import io
        with tempfile.TemporaryDirectory() as folder:
            args=NS(output_dir=Path(folder)/'measurements',models=Path(folder),iterations=1,timeout=10,profile=False)
            with patch('model_cpu_lab.subprocess.run',side_effect=subprocess.TimeoutExpired('synthetic child',10)),redirect_stdout(io.StringIO()):
                result=measure(args)
            self.assertEqual(result['status'],'MEASURED_WITH_BLOCKERS');self.assertEqual(result['exit_code'],2)
            records=json.loads((args.output_dir/'summary.json').read_text())
            self.assertEqual(len(records),7);self.assertTrue(all(record['status']=='BLOCKED_TIMEOUT' for record in records))

    def test_audit_reports_graph_not_filename_or_training_identity(self):
        import onnx
        from onnx import helper as h,TensorProto as T
        graph=h.make_graph([h.make_node('Identity',['input'],['output'])],'synthetic',[h.make_tensor_value_info('input',T.FLOAT,[1,3,2,2])],[h.make_tensor_value_info('output',T.FLOAT,[1,3,2,2])])
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'r50_trained_on_everything.onnx'
            onnx.save(h.make_model(graph,opset_imports=[h.make_opsetid('',13)],ir_version=8),str(path))
            result=audit(path);self.assertEqual(result['operators'],{'Identity':1});self.assertEqual(result['training_checkpoint'],'UNVERIFIED')

    def test_actual_ort_synthetic_graph_pipeline_e2e(self):
        import onnx
        import onnxruntime as ort
        from onnx import helper as h,numpy_helper as nh,TensorProto as T
        outputs=heads();outputs[0][0]=.99;outputs[3][0]=[0,0,14,14];outputs[6][0]=TARGET.reshape(-1)/8
        nodes=[h.make_node('Constant',[],[name],value=nh.from_array(array)) for name,array in zip(DETECTOR_OUTPUTS,outputs)]
        graph=h.make_graph(nodes,'synthetic_detector',[h.make_tensor_value_info('input.1',T.FLOAT,[1,3,640,640])],
                           [h.make_tensor_value_info(name,T.FLOAT,list(array.shape)) for name,array in zip(DETECTOR_OUTPUTS,outputs)])
        model=h.make_model(graph,opset_imports=[h.make_opsetid('',13)],ir_version=8)
        detector=ScrfdDetector(ort.InferenceSession(model.SerializeToString(),providers=['CPUExecutionProvider']))
        weights=np.random.default_rng(7).normal(size=(3,512)).astype(np.float32)
        graph=h.make_graph([h.make_node('ReduceMean',['input'],['pooled'],axes=[2,3],keepdims=0),h.make_node('MatMul',['pooled','weights'],['embedding'])],
                           'synthetic_recognizer',[h.make_tensor_value_info('input',T.FLOAT,[1,3,112,112])],
                           [h.make_tensor_value_info('embedding',T.FLOAT,[1,512])],[nh.from_array(weights,'weights')])
        model=h.make_model(graph,opset_imports=[h.make_opsetid('',13)],ir_version=8)
        recognizer=R50Recognizer(ort.InferenceSession(model.SerializeToString(),providers=['CPUExecutionProvider']))
        pipeline=ExperimentalPipeline(detector,recognizer)
        image=np.full((640,640,3),200,np.uint8)
        gallery=pipeline.enroll([image]*3,'GENERATED_ONNX')
        self.assertEqual(pipeline.match(image,gallery,threshold=.99,minimum_margin=.1)['state'],'MATCH')

    @unittest.skipUnless(os.environ.get('AIOT_TEST_CPU_MODELS')=='1','Candidate weights deliberately excluded from production release')
    def test_real_candidates_synthetic_cli_in_fresh_process(self):
        result=subprocess.run([sys.executable,'-B',str(ROOT/'tools/model_cpu_lab.py'),'synthetic','--experimental','--ftz','--threads','4'],capture_output=True,text=True,timeout=60,check=True)
        body=json.loads(result.stdout);self.assertEqual(body['status'],'PASS_SYNTHETIC_RUNTIME_ONLY')
        self.assertEqual(body['real_scrfd_blank'],'NO_FACE');self.assertFalse(body['contract']['production_approved'])


class MonitoringTests(unittest.TestCase):
    def test_blocked_outbox_warning_read_only_and_no_sensitive_fields(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'outbox.db';DurableOutbox(path)
            with closing(sqlite3.connect(path)) as db:
                db.execute("INSERT INTO events(event_id,user_code,payload,status,attempts,next_retry,created_at,last_error) VALUES (?,?,?,'blocked',32,0,10,?)",(str(uuid.uuid4()),'PRIVATE_USER','private payload','private error'));db.commit()
            before=path.read_bytes();result=diagnostics.outbox_diagnostics(path,now=1000,max_pending_age=300)
            self.assertEqual(len(result['warnings']),2);self.assertEqual(result['max_undelivered_attempts'],32)
            self.assertNotIn('private',json.dumps(result).lower());self.assertEqual(before,path.read_bytes())
            child=subprocess.run([sys.executable,'-B',str(ROOT/'tools/pipeline_diagnostics.py'),'--outbox',str(path)],capture_output=True,text=True,timeout=10)
            self.assertEqual(child.returncode,2)
        with self.assertRaises(FileNotFoundError):diagnostics.outbox_diagnostics(Path(tempfile.gettempdir())/str(uuid.uuid4()))

    def test_actual_worker_health_keys_and_model_failure_alert(self):
        state=AppState();state.camera_opened=True;state.model_loaded=True;state.gallery_status={'origin':'cache'};state.captured();state.inferred()
        server=StreamServer(state,port=0);server.start()
        try:
            url=f'http://127.0.0.1:{server.server.server_port}/health'
            self.assertEqual(diagnostics.pipeline_diagnostics(url)['warnings'],[])
            state.failed('model');result=diagnostics.pipeline_diagnostics(url)
            self.assertIn('MODEL_LOADED_FALSE',result['warnings']);self.assertIn('READY_FALSE',result['warnings'])
        finally:server.stop()
        for url in ('https://127.0.0.1/health','http://example.com/health','http://key:secret@localhost/health','http://localhost/health?key=secret'):
            with self.assertRaises(ValueError):diagnostics.pipeline_diagnostics(url)


class HailoPreparationTests(unittest.TestCase):
    def test_no_reinterpretation_of_fcr_memory_layout(self):
        meta=dict(inputs=[{'format_order':'FormatOrder.FCR'}],outputs=[])
        with patch('experimental_hailo.inspect_hef',return_value=meta):
            with self.assertRaisesRegex(ValueError,'BLOCKED_FORMAT_MAPPING'):
                HailoTransport('unused',meta,experimental=True,runtime=NS())

    def test_architecture_requires_actual_parse_not_filename(self):
        self.assertEqual(architecture_from_cli('Architecture HEF was compiled for: HAILO10H'),'HAILO10H')
        for text in ('filename=hailo10h.hef','Architecture HEF was compiled for: HAILO8',''):
            with self.assertRaises(ValueError):architecture_from_cli(text)

    def test_parsed_metadata_preserves_names_shapes_formats_and_quantization(self):
        info=NS(name='ACTUAL_NAME_FROM_SYNTHETIC_API_STUB',shape=(112,112,3),format=NS(type='UINT8',order='NHWC'),quant_info=NS(qp_zp=2,qp_scale=.25))
        hef=NS(get_network_group_names=lambda:['synthetic_group'],get_input_vstream_infos=lambda name:[info],get_output_vstream_infos=lambda name:[info])
        runtime=NS(HEF=lambda path:hef)
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'synthetic.hef';path.write_bytes(b'SYNTHETIC, NOT REAL HEF')
            result=inspect_hef(path,runtime=runtime,cli_output='Architecture HEF was compiled for: HAILO10H')
            self.assertEqual(result['inputs'][0]['name'],info.name);self.assertEqual(result['inputs'][0]['quantization']['scale'],.25)
            self.assertEqual(result['tensor_semantics'],'UNVERIFIED');self.assertFalse(result['production_approved'])
            with self.assertRaisesRegex(ValueError,'METADATA_MISMATCH'):HailoTransport(path,{},runtime=runtime,cli_output='Architecture HEF was compiled for: HAILO10H',experimental=True)
            info.format.order='HAILO_NMS'
            with self.assertRaises(ValueError):inspect_hef(path,runtime=runtime,cli_output='Architecture HEF was compiled for: HAILO10H')

    def test_transport_buffers_timeout_and_closed_state_without_device_claim(self):
        transport=HailoTransport.__new__(HailoTransport);transport._closed=False
        transport.metadata={'inputs':[{'name':'from_metadata','shape':[2,3]}],'outputs':[{'name':'also_metadata','shape':[1,512]}]}
        configured=Mock()
        def bindings(output_buffers):
            for value in output_buffers.values():value[:]=1
            return Mock()
        configured.create_bindings.side_effect=bindings;transport.configured=configured
        outputs=transport.infer({'from_metadata':np.zeros((2,3),np.float32)},timeout_ms=123)
        self.assertEqual(outputs['also_metadata'].shape,(1,512));self.assertEqual(configured.run.call_args.args[1],123)
        for bad in ({'guess':np.zeros((2,3),np.float32)},{'from_metadata':np.zeros((2,3),np.float64)}):
            with self.assertRaises(ValueError):transport.infer(bad)
        transport._closed=True
        with self.assertRaises(RuntimeError):transport.infer({})

    def test_transport_owns_resources_and_releases_device_after_startup_failure(self):
        from contextlib import contextmanager
        import hashlib
        for fail in (False,True):
            closed=[]
            @contextmanager
            def owned(name,value):
                try:yield value
                finally:closed.append(name)
            stream=NS(shape=[2,3],set_format_type=Mock(),set_format_order=Mock())
            model=NS(input_names=['from_hef'],output_names=['from_hef'],input=lambda name:stream,output=lambda name:stream)
            configured=Mock();model.configure=lambda:owned('configured',configured)
            if fail:model.output_names=['guessed_name']
            device=NS(create_infer_model=Mock(return_value=model))
            runtime=NS(VDevice=lambda:owned('device',device),FormatType=NS(FLOAT32='FLOAT32'),FormatOrder=NS(NHWC='NHWC'))
            with tempfile.TemporaryDirectory() as folder:
                path=Path(folder)/'synthetic.hef';path.write_bytes(b'API STUB ONLY')
                meta=dict(sha256=hashlib.sha256(path.read_bytes()).hexdigest(),network_group='actual_group',inputs=[{'name':'from_hef','shape':[2,3],'format_order':'NHWC'}],outputs=[{'name':'from_hef','shape':[2,3],'format_order':'NHWC'}])
                with patch('experimental_hailo.inspect_hef',return_value=meta):
                    if fail:
                        with self.assertRaises(ValueError):HailoTransport(path,meta,experimental=True,runtime=runtime)
                        self.assertEqual(closed,['device'])
                    else:
                        with HailoTransport(path,meta,experimental=True,runtime=runtime) as transport:
                            self.assertFalse(transport._closed)
                        self.assertEqual(closed,['configured','device'])
                        self.assertTrue(transport._closed)
                    device.create_infer_model.assert_called_once_with(b'API STUB ONLY','actual_group')


if __name__=='__main__':unittest.main()
