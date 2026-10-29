"""Synthetic-only tooling regressions. Never open a camera or use real biometrics."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock,patch
import zipfile

import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'tools'),str(ROOT/'AIOT/edge')]
from cpu_model_tool import baseline_descriptor
from cpu_onnx import descriptor_contract,tensor
from experimental_cpu import ExperimentalPipeline
from pipeline import TARGET,Detection
from cpu_live_validate import validate_options,process_frame,supervise
from face_evaluation import evaluate
from model_ingestion import ingest,parity,compare_tensors,digest
import source_preservation as preservation


def stalled_child(options,channel):
    time.sleep(30)  # Owned test process MUST be terminated by the supervisor.


class FinalCPUToolsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='aiot-final-cpu-');self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.contract=descriptor_contract(baseline_descriptor(self.root))

    def vector(self,index):return np.eye(1,512,k=index)[0].tolist()

    def dataset(self):
        def sample(identity,index,suffix,condition='indoor'):
            return dict(subject=identity,sample_id=suffix,condition=condition,contract_id=self.contract['contract_id'],embedding=self.vector(index))
        return dict(schema=1,synthetic=True,contract=self.contract,
                    enrollment=[sample(code,index,code+str(i)) for code,index in [('A',0),('B',1)] for i in range(3)],
                    probes=[sample('A',0,'probeA'),sample('C',2,'probeC','low-light')])

    def options(self):
        return dict(kind='camera',source=0,allow_camera=True,allow_test_media=True,experimental=True,
                    seconds=1,threshold=.6,margin=.05,frames=10,threads=1)

    def test_camera_requires_two_opt_ins_before_any_capture(self):
        for key in ('allow_camera','allow_test_media','experimental'):
            options=self.options();options[key]=False
            with patch('cv2.VideoCapture') as camera:
                with self.assertRaises(ValueError):supervise(options)
                camera.assert_not_called()
        for field,value in [('source','0'),('source',16),('seconds',float('nan')),('frames',True),('threshold',2)]:
            options=self.options();options[field]=value
            with self.assertRaises(ValueError):validate_options(options)

    def test_media_source_requires_permission_and_local_file(self):
        path=self.root/'synthetic.png';path.write_bytes(b'not an actual image')
        options=self.options();options.update(kind='image',source=str(path),allow_camera=False)
        self.assertIs(validate_options(options),options)
        options['allow_test_media']=False
        with self.assertRaises(ValueError):validate_options(options)
        options.update(allow_test_media=True,source='rtsp://example.invalid/private')
        with self.assertRaises(ValueError):validate_options(options)

    def test_stalled_process_is_bounded_and_reaped(self):
        messages=[];started=time.monotonic()
        self.assertEqual(supervise(self.options(),target=stalled_child,emit=messages.append),2)
        self.assertLess(time.monotonic()-started,6)
        self.assertEqual(messages[-1]['state'],'DEADLINE_EXCEEDED')

    def test_terminal_status_survives_diagnostic_queue_backpressure(self):
        import queue
        from cpu_live_validate import _emit
        channel=queue.Queue(maxsize=1);channel.put(dict(type='progress'))
        _emit(channel,dict(type='done'))
        self.assertEqual(channel.get_nowait()['type'],'done')

    def fake_pipeline(self,faces=1):
        detector=NS(detect=Mock(return_value=[Detection((0,0,112,112),TARGET,.9)]*faces))
        recognizer=NS(get_embedding=Mock(return_value=np.array(self.vector(0))))
        return ExperimentalPipeline(detector,recognizer,reference_contract=self.contract)

    def test_live_matching_runs_detection_once_and_outputs_no_biometrics(self):
        pipeline=self.fake_pipeline();image=np.zeros((112,112,3),np.uint8)
        gallery=dict(contract=pipeline.contract,entries=[dict(code='SYNTH',embedding=self.vector(0))])
        value=process_frame(pipeline,image,gallery,threshold=.6,margin=.05)
        self.assertEqual(value['state'],'MATCH');pipeline.detector.detect.assert_called_once()
        pipeline.recognizer.get_embedding.assert_called_once()
        self.assertFalse(set(value)&{'embedding','image','code','score','identity'})

    def test_no_face_multiple_unknown_and_model_failure(self):
        for faces,expected in [(0,'NO_FACE'),(2,'MULTIPLE_FACES'),(1,'UNKNOWN')]:
            pipeline=self.fake_pipeline(faces);gallery=dict(contract=pipeline.contract,entries=[])
            result=process_frame(pipeline,np.zeros((112,112,3),np.uint8),gallery,threshold=.6,margin=.05)
            self.assertEqual(result['state'],expected)
            if faces!=1:pipeline.recognizer.get_embedding.assert_not_called()
        pipeline=self.fake_pipeline();pipeline.recognizer.get_embedding.side_effect=OSError('synthetic provider failure')
        with self.assertRaises(OSError):process_frame(pipeline,np.zeros((112,112,3),np.uint8),dict(contract=pipeline.contract,entries=[]),threshold=.6,margin=.05)

    def test_live_contract_mismatch_rejected_before_inference(self):
        pipeline=self.fake_pipeline()
        with self.assertRaisesRegex(ValueError,'CONTRACT'):
            process_frame(pipeline,np.zeros((112,112,3),np.uint8),dict(contract={},entries=[]),threshold=.6,margin=.05)
        pipeline.detector.detect.assert_not_called()

    def test_verification_denominators_and_condition_sweep(self):
        result=evaluate(self.dataset(),[0,.5,1],minimum_margin=.05)
        low,normal,boundary=result['groups']['all']
        self.assertEqual((normal['genuine'],normal['impostor'],normal['known'],normal['unknown']),(1,3,1,1))
        self.assertEqual((normal['FAR'],normal['FRR'],normal['FPIR'],normal['FNIR']),(0,0,0,0))
        self.assertEqual(low['FAR'],1);self.assertEqual(low['FPIR'],0)  # ambiguity margin rejects tied unknown
        self.assertEqual(boundary['FRR'],0)  # >= threshold, including exact 1
        self.assertIsNone(result['groups']['low-light'][1]['FRR'])
        self.assertIsNone(result['groups']['indoor'][1]['FPIR'])
        self.assertFalse(result['accuracy_claim']);self.assertIsNone(result['threshold_recommendation'])

    def test_wrong_identity_is_not_counted_as_correct_accept(self):
        data=self.dataset();data['probes'][0]['embedding']=self.vector(1)
        value=evaluate(data,[.5],minimum_margin=.05)['groups']['all'][0]
        self.assertEqual(value['wrong_known'],1);self.assertEqual(value['FNIR'],1);self.assertEqual(value['FRR'],1)

    def test_evaluation_rejects_contract_overlap_and_bad_vectors(self):
        for mutate in (lambda d:d['probes'][0].update(contract_id='wrong'),lambda d:d['probes'][0].update(sample_id='A0'),
                       lambda d:d['probes'][0].update(embedding=[True]*512),lambda d:d['probes'][0].update(embedding=[0]*512),
                       lambda d:d.update(schema=True)):
            data=self.dataset();mutate(data)
            with self.assertRaises(ValueError):evaluate(data,[.5],minimum_margin=.05)
        with self.assertRaises(ValueError):evaluate(self.dataset(),[float('nan')],minimum_margin=.05)
        with self.assertRaises(ValueError):evaluate(self.dataset(),[.5],minimum_margin=-1)

    def tiny_onnx(self):
        import onnx
        from onnx import helper,TensorProto,numpy_helper
        path=self.root/'tiny.onnx'
        graph=helper.make_graph([helper.make_node('Constant',[],['embedding'],value=numpy_helper.from_array(np.ones((1,512),np.float32)))],
                 'synthetic-not-r50',[helper.make_tensor_value_info('input',TensorProto.FLOAT,[1,3,112,112])],
                 [helper.make_tensor_value_info('embedding',TensorProto.FLOAT,[1,512])])
        model=helper.make_model(graph,opset_imports=[helper.make_opsetid('',13)]);model.ir_version=10;onnx.save(model,path)
        descriptor=baseline_descriptor(self.root)
        descriptor['recognizer'].update(path=str(path),sha256=digest(path),input='input',outputs=[dict(name='embedding',shape=[1,512])])
        config=self.root/'descriptor.json';config.write_text(json.dumps(descriptor),encoding='utf-8')
        return path,config,descriptor

    def test_ingestion_checkpoint_never_unpickles_or_executes_factory(self):
        checkpoint=self.root/'state.pth';checkpoint.write_bytes(b'untrusted pickle is NOT executed')
        evidence={k:'UNVERIFIED' for k in ('source','checkpoint','training','export','preprocessing','license')}
        result=ingest(checkpoint,digest(checkpoint),evidence,None,self.root/'quarantine')
        self.assertEqual(result['status'],'BLOCKED_TRUSTED_EXPORT_REQUIRED');self.assertFalse(result['checkpoint_deserialized'])
        self.assertFalse(result['production_approved'])
        with self.assertRaises(ValueError):ingest(checkpoint,'0'*64,evidence,None,self.root/'wrong')
        self.assertFalse((self.root/'wrong').exists())

    def test_onnx_ingestion_preserves_original_and_never_approves_assertions(self):
        artifact,config,_=self.tiny_onnx();before=artifact.read_bytes()
        evidence={k:'OWNER_SAYS_APPROVED' for k in ('source','checkpoint','training','export','preprocessing','license')}
        destination=self.root/'quarantine';result=ingest(artifact,digest(artifact),evidence,config,destination)
        self.assertEqual(artifact.read_bytes(),before);self.assertFalse(result['production_approved'])
        generated=json.loads((destination/'candidate-descriptor.json').read_text())
        self.assertEqual(generated['license'],'UNVERIFIED_OWNER_ASSERTIONS')
        with self.assertRaises(FileExistsError):ingest(artifact,digest(artifact),evidence,config,destination)

    def test_actual_ort_parity_and_preprocessing_golden(self):
        _,config,descriptor=self.tiny_onnx()
        crops=np.full((2,112,112,3),127,np.uint8)
        inputs=np.concatenate([tensor(crop,descriptor['recognizer']) for crop in crops])
        reference=self.root/'reference.npz';np.savez(reference,inputs=inputs,outputs=np.ones((2,512),np.float32),crops=crops)
        result=parity(config,reference,digest(reference),atol=1e-6,rtol=1e-6,min_cosine=.999,threads=1)
        self.assertEqual(result['status'],'PASS_TENSOR_PARITY_ONLY');self.assertEqual(result['preprocessing'],'PASS_SUPPLIED_CROP_TO_TENSOR_ONLY')
        self.assertFalse(result['provenance_approved']);self.assertEqual(result['alignment_parity'],'UNVERIFIED')
        bad=self.root/'bad.npz';np.savez(bad,inputs=inputs+1,outputs=np.ones((2,512),np.float32),crops=crops)
        with self.assertRaisesRegex(ValueError,'PREPROCESSING'):parity(config,bad,digest(bad),atol=1e-6,rtol=1e-6,min_cosine=.999)
        with self.assertRaisesRegex(ValueError,'SHA'):parity(config,reference,'0'*64,atol=1e-6,rtol=1e-6,min_cosine=.999)

    def test_supervised_image_cli_with_generated_onnx_no_camera_or_faces(self):
        import cv2
        import onnx
        from onnx import helper,TensorProto,numpy_helper
        _,config,descriptor=self.tiny_onnx()
        heads=[np.zeros(x['shape'],np.float32) for x in descriptor['detector']['outputs']]
        # Deliberately injected geometry, not real face detection/accuracy evidence.
        index=(40*80+40)*2
        heads[0][0,index,0]=.9;heads[3][0,index]=[20]*4
        heads[6][0,index]=((TARGET*(640/112)-320)/8).reshape(-1)
        nodes=[helper.make_node('Constant',[],[spec['name']],value=numpy_helper.from_array(value))
               for spec,value in zip(descriptor['detector']['outputs'],heads)]
        graph=helper.make_graph(nodes,'synthetic-geometry-only',
                [helper.make_tensor_value_info('input.1',TensorProto.FLOAT,[1,3,640,640])],
                [helper.make_tensor_value_info(s['name'],TensorProto.FLOAT,s['shape']) for s in descriptor['detector']['outputs']])
        model=helper.make_model(graph,opset_imports=[helper.make_opsetid('',13)]);model.ir_version=10
        detector=self.root/'detector.onnx';onnx.save(model,detector)
        descriptor.update(family_assertion='SYNTHETIC_CONSTANT_GRAPH_NOT_R50',model_version='synthetic-test')
        descriptor['detector'].update(path=str(detector),sha256=digest(detector))
        config.write_text(json.dumps(descriptor),encoding='utf-8')
        image=self.root/'checker.png';cv2.imwrite(str(image),np.zeros((112,112,3),np.uint8))
        command=[sys.executable,'-B',str(ROOT/'tools/cpu_live_validate.py'),'--descriptor',str(config),
                 '--image',str(image),'--allow-test-media','--experimental','--threshold','.6','--margin','.05','--max-seconds','10']
        child=subprocess.run(command,capture_output=True,text=True,timeout=15)
        self.assertEqual(child.returncode,0,child.stderr)
        messages=[json.loads(line) for line in child.stdout.splitlines()]
        self.assertEqual(messages[0]['state'],'UNKNOWN');self.assertEqual(messages[0]['faces'],1)
        self.assertEqual(messages[-1]['type'],'done')

    def test_video_read_failure_releases_owned_capture(self):
        from cpu_live_validate import media_worker
        import queue
        video=self.root/'fake.avi';video.write_bytes(b'synthetic fixture')
        options=self.options();options.update(kind='video',source=str(video),descriptor='not-loaded-in-this-test',gallery=None)
        capture=Mock();capture.isOpened.return_value=True;capture.read.return_value=(False,None)
        pipeline=self.fake_pipeline();channel=queue.Queue()
        with patch('cpu_onnx.load_descriptor',return_value=pipeline),patch('cv2.VideoCapture',return_value=capture):
            media_worker(options,channel)
        self.assertEqual(channel.get()['type'],'error');capture.release.assert_called_once()

    def test_numeric_parity_catches_sign_scale_nan_and_zero(self):
        vector=np.ones((1,512),np.float32)
        for other in (-vector,vector*2):
            self.assertEqual(compare_tensors(vector,other,atol=1e-6,rtol=1e-6,min_cosine=.999)['status'],'FAIL_TENSOR_PARITY')
        for other in (vector*0,vector*np.nan):
            with self.assertRaises(ValueError):compare_tensors(vector,other,atol=0,rtol=0,min_cosine=.999)
        with self.assertRaisesRegex(ValueError,'overflowing'):
            compare_tensors(np.full((1,512),1e300),vector,atol=0,rtol=0,min_cosine=.999)

    def test_source_snapshot_is_deterministic_excludes_private_data_and_verifies_hashes(self):
        source=self.root/'source';source.mkdir()
        for name,body in [('app.py','print(1)'),('.env','DO_NOT_READ'),('weights.onnx','DO_NOT_READ'),('untracked.md','source notes')]:
            (source/name).write_text(body)
        def git(_source,*args):
            if args[0]=='ls-files':return b'app.py\0.env\0weights.onnx\0gone.py\0' if '--others' not in args else b'untracked.md\0'
            if args==('rev-parse','--show-toplevel'):return str(source).encode()
            if args[0]=='rev-parse':return b'12345\n'
            return b' M app.py\0?? untracked.md\0'
        with patch.object(preservation,'_git',side_effect=git):
            before=preservation.inventory(source)
            self.assertEqual(set(before['files']),{'app.py','untracked.md'});self.assertEqual(before['deleted_tracked'],['gone.py'])
            a,b=self.root/'a.zip',self.root/'b.zip'
            self.assertEqual(preservation.snapshot(a,source)['files'],2);preservation.snapshot(b,source)
            self.assertEqual(a.read_bytes(),b.read_bytes())
            with self.assertRaises(FileExistsError):preservation.snapshot(a,source)
        with zipfile.ZipFile(a,'a') as archive:archive.writestr('intruder.py','bad')
        with self.assertRaises(ValueError):preservation.verify(a)

    def test_preservation_refuses_secrets_dependencies_and_path_escape(self):
        for name in ('../app.py','/app.py','AIOT/server/.env','node_modules/app.js','.venv/app.py','AIOT/server/data/faces.py','x/../y.py','AIOT/edge/model/model.onnx'):
            self.assertFalse(preservation.allowed(name),name)
        self.assertTrue(preservation.allowed('AIOT/.env.example'))
        with self.assertRaises(ValueError):preservation.output_path(ROOT/'overwrite.zip')

    def test_all_new_cli_entrypoints_help_without_camera_or_model(self):
        for filename in ('cpu_live_validate.py','face_evaluation.py','model_ingestion.py','source_preservation.py'):
            child=subprocess.run([sys.executable,'-B',str(ROOT/'tools'/filename),'--help'],capture_output=True,text=True,timeout=10)
            self.assertEqual(child.returncode,0,child.stderr)


if __name__=='__main__':unittest.main()
