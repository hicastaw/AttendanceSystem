"""Release gate, migration rehearsal, verified public assets and offline CPU tests."""
from contextlib import redirect_stdout
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch,Mock
import zipfile
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'AIOT/edge'),str(ROOT/'tools')]
from integration_gate import (mode,guard_legacy_entrypoint,readiness,REQUIRED_GATES,
                              candidate_contract_id,validate_candidate_contract)
from experimental_cpu import ExperimentalPipeline,ScrfdDetector,BASE_CONTRACT,DETECTOR_SHA
from model_contract import LEGACY_CONTRACT,validate_backend
from member_gallery import content_version
from pipeline import Detection,TARGET
from official_hailo_cpu import OfficialScrfd,OfficialR50,OUTPUT_NAMES,OUTPUT_SHAPES,load_official_reference
import gallery_transition as transition
import prepare_official_reference as prepare_assets
import validate_real_pipeline as real
from check_model_readiness import check


def candidate():
    detector=NS(detect=lambda image:[Detection((0,0,112,112),TARGET.copy(),1.)])
    recognizer=NS(get_embedding=lambda image:np.ones(512))
    return ExperimentalPipeline(detector,recognizer)


def metadata(name,shape):return NS(name=name,shape=shape,type='tensor(float)')


class FeatureGateTests(unittest.TestCase):
    def test_default_disabled_live_entrypoint_and_invalid_flag_fail_closed(self):
        self.assertEqual(mode({}),'disabled');guard_legacy_entrypoint({})
        for value in ('shadow','production','true','1','DISABLED',' disabled '):
            with self.assertRaises(ValueError):guard_legacy_entrypoint({'AIOT_R50_MODE':value})
        for value in ('shadow','production'):
            with patch.dict(os.environ,{'AIOT_R50_MODE':value}):
                with self.assertRaisesRegex(ValueError,'production worker'):validate_backend('cv2dnn')
        with patch.dict(os.environ,{},clear=True):self.assertEqual(validate_backend('cv2dnn'),'cv2dnn')

    def test_digest_and_schema_changes_reject_relabeling(self):
        original=candidate().contract;validate_candidate_contract(original)
        for key,value in (('alignment_id','different'),('schema',3),('schema',True),('production_approved',True),('recognizer_sha256','bad')):
            changed=copy.deepcopy(original);changed[key]=value
            with self.assertRaises(ValueError):validate_candidate_contract(changed)
        changed=copy.deepcopy(original);changed['schema']=2;changed['contract_id']=candidate_contract_id(changed)
        validate_candidate_contract(changed);self.assertNotEqual(changed['contract_id'],original['contract_id'])

    def test_even_claimed_complete_gates_cannot_activate_production(self):
        contract=candidate().contract
        result=readiness(contract,{name:'true' for name in REQUIRED_GATES})
        self.assertEqual(len(result['blocked_gates']),len(REQUIRED_GATES))
        result=readiness(contract,{name:True for name in REQUIRED_GATES})
        self.assertFalse(result['production_activation_available']);self.assertFalse(result['production_activated'])
        with self.assertRaises(ValueError):readiness(contract,{'unrecognized_gate':True})

    def test_readiness_report_returns_blockers_and_explicit_mode(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'smoke.json';path.write_text(json.dumps(dict(status='PASS_REAL_IMAGE_SMOKE_ONLY',contract=candidate().contract)))
            result=check(path,{'AIOT_R50_MODE':'shadow'})
            self.assertEqual(result['requested_mode'],'shadow');self.assertIn('weights_license_approved',result['blocked_gates'])
            self.assertNotIn('real_image_smoke',result['blocked_gates'])

    def test_published_mean_std_url_does_not_clear_complete_preprocessing_gate(self):
        from official_hailo_cpu import DETECTOR_SHA,RECOGNIZER_SHA
        contract=candidate().contract
        contract.update(detector_sha256=DETECTOR_SHA,recognizer_sha256=RECOGNIZER_SHA,preprocess_evidence='https://example.invalid/mean-std-only.yaml')
        contract['contract_id']=candidate_contract_id(contract)
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'smoke.json';path.write_text(json.dumps(dict(status='PASS_REAL_IMAGE_SMOKE_ONLY',contract=contract)))
            result=check(path,{})
            self.assertIn('preprocessing_verified',result['blocked_gates'])
            self.assertIn('weights_license_approved',result['blocked_gates'])


class ContractHardeningTests(unittest.TestCase):
    def test_existing_default_contract_id_remains_compatible(self):
        pipeline=candidate()
        reference=ExperimentalPipeline(pipeline.detector,pipeline.recognizer,denormal_as_zero=True,artifacts_verified=True)
        self.assertEqual(reference.contract['contract_id'],'d0b20413897acb723591091e5f8a19633ff34c7fcfe830e5736c1fcde2303c77')

    def test_detector_operating_point_changes_contract_not_legacy_defaults(self):
        pipeline=candidate();original=pipeline.contract
        pipeline.detector.score_threshold=.5;pipeline.detector.nms_threshold=.4
        alternate=ExperimentalPipeline(pipeline.detector,pipeline.recognizer)
        self.assertNotEqual(original['contract_id'],alternate.contract['contract_id'])
        self.assertEqual(alternate.contract['detector_operating_point'],[.5,.4])
        self.assertNotIn('detector_operating_point',original)
        changed=copy.deepcopy(BASE_CONTRACT);changed['production_approved']=True
        with self.assertRaises(ValueError):ExperimentalPipeline(pipeline.detector,pipeline.recognizer,reference_contract=changed)

    def test_vectors_reject_json_strings_booleans_and_cosine_is_bounded(self):
        pipeline=candidate();image=np.zeros((112,112,3),np.uint8);gallery=pipeline.enroll([image]*3,'A')
        result=pipeline.match(image,gallery,threshold=1.,minimum_margin=.05)
        self.assertLessEqual(result['score'],1.);self.assertGreaterEqual(result['score'],-1.)
        for value in (True,'1',None):
            broken=copy.deepcopy(gallery);broken['entries'][0]['embedding'][0]=value
            with self.assertRaises(ValueError):pipeline.match(image,broken,threshold=.6,minimum_margin=.05)

    def test_official_onnx_bindings_and_batch_axis_are_exact_not_heuristic(self):
        values=[np.zeros(shape,np.float32) for shape in OUTPUT_SHAPES]
        session=NS(get_inputs=lambda:[metadata('input.1',[1,3,640,640])],
                   get_outputs=lambda:[metadata(n,s) for n,s in zip(OUTPUT_NAMES,OUTPUT_SHAPES)],run=Mock(return_value=values))
        detector=OfficialScrfd(session)
        self.assertEqual(detector.detect(np.zeros((112,112,3),np.uint8)),[])
        self.assertEqual(session.run.call_args.args[0],OUTPUT_NAMES)
        values[0]=np.zeros((12800,1),np.float32)
        with self.assertRaises(ValueError):detector.detect(np.zeros((112,112,3),np.uint8))
        for invalid in (-1,float('nan'),True):
            with self.assertRaises(ValueError):OfficialScrfd(session,invalid)

    def test_official_r50_preprocess_golden_and_distinct_output_name(self):
        session=NS(get_inputs=lambda:[metadata('data',['None',3,112,112])],
                   get_outputs=lambda:[metadata('642',[1,512])],run=Mock(return_value=[np.ones((1,512),np.float32)]))
        recognizer=OfficialR50(session);image=np.broadcast_to(np.array([0,127,255],np.uint8),(112,112,3)).copy()
        recognizer.get_embedding(image)
        names,inputs=session.run.call_args.args
        self.assertEqual(names,['642']);np.testing.assert_allclose(inputs['data'][0,:,0,0],[1,-.5/127.5,-1],atol=1e-7)
        session.get_outputs=lambda:[metadata('embedding',[1,512])]
        with self.assertRaises(ValueError):OfficialR50(session)


class MigrationRehearsalTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.addCleanup(self.temporary.cleanup);self.root=Path(self.temporary.name)
        data=[dict(user_code='A',full_name='Synthetic',embedding=np.eye(1,512)[0].tolist())]
        self.legacy=dict(cache_schema_version=1,source='http://synthetic.invalid',contract=LEGACY_CONTRACT,
                         gallery_version=content_version(data,LEGACY_CONTRACT),fetched_at=0,data=data)
        pipeline=candidate();self.gallery=pipeline.enroll([np.zeros((112,112,3),np.uint8)]*3,'A')
        self.old,self.new=self.root/'legacy.json',self.root/'candidate.json'
        self.old.write_text(json.dumps(self.legacy));self.new.write_text(json.dumps(self.gallery));self.directory=self.root/'rehearsal'

    def test_side_by_side_reenrollment_switch_rollback_never_modify_originals(self):
        before=[self.old.read_bytes(),self.new.read_bytes()]
        transition.prepare(self.old,self.new,self.directory)
        self.assertEqual(transition.select(self.directory,'candidate',0)['revision'],1)
        self.assertEqual(transition.select(self.directory,'legacy',1)['revision'],2)
        self.assertEqual(before,[self.old.read_bytes(),self.new.read_bytes()])
        self.assertFalse(transition.select(self.directory,'candidate',2)['production_activated'])

    def test_missing_extra_duplicate_and_wrong_contract_refuse_before_creating_directory(self):
        for entries in ([],self.gallery['entries']*2,self.gallery['entries']+[dict(code='EXTRA',embedding=np.ones(512).tolist())]):
            body=copy.deepcopy(self.gallery);body['entries']=entries;self.new.write_text(json.dumps(body))
            with self.assertRaises(ValueError):transition.prepare(self.old,self.new,self.directory)
            self.assertFalse(self.directory.exists())
        body=copy.deepcopy(self.gallery);body['contract']=LEGACY_CONTRACT;self.new.write_text(json.dumps(body))
        with self.assertRaises(ValueError):transition.prepare(self.old,self.new,self.directory)

    def test_reject_mbf_weights_relabeling_wrong_legacy_revision_and_output_outside_lab(self):
        body=copy.deepcopy(self.gallery)
        from model_contract import MANIFEST
        body['contract']['recognizer_sha256']=MANIFEST['sha256']['w600k_mbf.onnx'];body['contract']['contract_id']=candidate_contract_id(body['contract'])
        self.new.write_text(json.dumps(body))
        with self.assertRaises(ValueError):transition.prepare(self.old,self.new,self.directory)
        self.new.write_text(json.dumps(self.gallery));self.legacy['gallery_version']='wrong';self.old.write_text(json.dumps(self.legacy))
        with self.assertRaises(ValueError):transition.prepare(self.old,self.new,self.directory)

    def test_stale_revision_and_lock_refuse_without_mutating_pointer(self):
        transition.prepare(self.old,self.new,self.directory);before=(self.directory/'pointer.json').read_bytes()
        with self.assertRaises(ValueError):transition.select(self.directory,'candidate',7)
        (self.directory/'transition.lock').write_text('synthetic owner')
        with self.assertRaises(FileExistsError):transition.select(self.directory,'candidate',0)
        self.assertEqual(before,(self.directory/'pointer.json').read_bytes())

    def test_corrupt_candidate_blocks_forward_selection_but_not_verified_legacy_rollback(self):
        transition.prepare(self.old,self.new,self.directory);transition.select(self.directory,'candidate',0)
        manifest=json.loads((self.directory/'transition.json').read_text())
        path=self.directory/manifest['snapshots']['candidate']['file'];path.write_bytes(b'CORRUPT SYNTHETIC CANDIDATE')
        with self.assertRaises((ValueError,json.JSONDecodeError)):transition.select(self.directory,'candidate',1)
        self.assertEqual(transition.select(self.directory,'legacy',1)['active'],'legacy')

    def test_snapshot_path_escape_refused_and_unknown_schema_not_accepted(self):
        transition.prepare(self.old,self.new,self.directory)
        path=self.directory/'transition.json';body=json.loads(path.read_text())
        body['snapshots']['legacy']=dict(file='legacy-../../outside.json',sha256='../../outside')
        path.write_text(json.dumps(body))
        with self.assertRaises(ValueError):transition.select(self.directory,'candidate',0)

    def test_production_output_location_and_corrupt_legacy_rollback_are_refused(self):
        with self.assertRaises(ValueError):transition.prepare(self.old,self.new,ROOT/'AIOT/server/data/rehearsal')
        transition.prepare(self.old,self.new,self.directory)
        manifest=json.loads((self.directory/'transition.json').read_text())
        legacy=self.directory/manifest['snapshots']['legacy']['file'];legacy.write_bytes(b'CORRUPT SYNTHETIC LEGACY')
        before=(self.directory/'pointer.json').read_bytes()
        with self.assertRaises(ValueError):transition.select(self.directory,'legacy',0)
        self.assertEqual(before,(self.directory/'pointer.json').read_bytes())

    def test_migration_cli_runs_prepare_select_and_rollback_only_inside_temp(self):
        for arguments in (['prepare','--legacy',str(self.old),'--candidate',str(self.new),'--directory',str(self.directory)],
                          ['select-candidate','--directory',str(self.directory),'--expected-revision','0'],
                          ['rollback','--directory',str(self.directory),'--expected-revision','1']):
            child=subprocess.run([sys.executable,'-B',str(ROOT/'tools/gallery_transition.py'),*arguments],capture_output=True,text=True,timeout=15)
            self.assertEqual(child.returncode,0,child.stderr)
            self.assertFalse(json.loads(child.stdout)['production_activated'])
        self.assertEqual(json.loads((self.directory/'pointer.json').read_text())['active'],'legacy')


class AssetReproducibilityTests(unittest.TestCase):
    def test_temp_staging_repository_cannot_bypass_production_path_guard(self):
        import model_cpu_lab
        with tempfile.TemporaryDirectory() as folder:
            staged_root=Path(folder)/'staged-source';staged_root.mkdir()
            with patch.object(model_cpu_lab,'ROOT',staged_root):
                with self.assertRaises(ValueError):model_cpu_lab.lab_path(staged_root/'AIOT/server/data/profiles.json')
                self.assertEqual(model_cpu_lab.lab_path(staged_root/'.model-validation/gallery.json'),staged_root/'.model-validation/gallery.json')

    def test_exclusive_hash_checked_zip_extraction_and_no_traversal(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);data=b'synthetic ONNX bytes, never executed';archive=root/'test.zip'
            with zipfile.ZipFile(archive,'w') as stream:stream.writestr('test.onnx',data)
            spec={'test.zip':dict(model='test.onnx',archive_sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),sha256=hashlib.sha256(data).hexdigest(),bytes=len(data),url='https://synthetic.invalid')}
            with patch.object(prepare_assets,'ARTIFACTS',spec):
                prepare_assets.prepare(root,root/'verified')
                self.assertEqual((root/'verified/test.onnx').read_bytes(),data)
                with self.assertRaises(FileExistsError):prepare_assets.prepare(root,root/'verified')
                archive.write_bytes(b'partial download')
                with self.assertRaises(ValueError):prepare_assets.prepare(root,root/'bad')
                self.assertFalse((root/'bad').exists())

    def test_public_fixture_hash_rejection_is_offline_and_credits_are_recorded(self):
        self.assertEqual(len(real.FIXTURES),2)
        self.assertTrue(all(item['license'].startswith('public-domain') and item['license_source'].startswith('https://') for item in real.FIXTURES.values()))
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder)/'astronaut.png').write_bytes(b'synthetic wrong hash')
            with self.assertRaisesRegex(ValueError,'checksum'):real.fixture_images(folder)

    def test_packaging_keeps_new_tools_and_excludes_models_images_and_lab_state(self):
        import rpi_release
        inventory=rpi_release.release_inventory()
        for name in ('AIOT/edge/integration_gate.py','AIOT/edge/official_hailo_cpu.py','tools/gallery_transition.py','tools/validate_real_pipeline.py','tools/prepare_official_reference.py','tools/check_model_readiness.py'):
            self.assertIn(name,inventory)
        self.assertFalse(any('.model-validation' in name or name.endswith(('.png','.jpg','.hef')) for name in inventory))

    @unittest.skipUnless(os.environ.get('AIOT_TEST_REAL_FIXTURES')=='1','Explicit offline public-domain model validation opt-in')
    def test_current_models_real_images_in_fresh_process(self):
        result=subprocess.run([sys.executable,'-B',str(ROOT/'tools/validate_real_pipeline.py'),'--fixtures',str(ROOT/'.model-validation/public-domain-fixtures-20261020'),'--experimental','--ftz'],capture_output=True,text=True,check=True,timeout=90)
        body=json.loads(result.stdout);self.assertEqual(body['status'],'PASS_REAL_IMAGE_SMOKE_ONLY')
        self.assertEqual(body['unknown']['state'],'UNKNOWN');self.assertIn('score',body['unknown'])

    @unittest.skipUnless(os.environ.get('AIOT_TEST_HAILO_REFERENCE')=='1','Official ONNX weights intentionally not packaged')
    def test_official_models_real_images_and_distinct_contract_in_fresh_process(self):
        result=subprocess.run([sys.executable,'-B',str(ROOT/'tools/validate_real_pipeline.py'),'--fixtures',str(ROOT/'.model-validation/public-domain-fixtures-20261020'),'--models',str(ROOT/'.model-validation/official-reference-20261020/verified-onnx'),'--profile','hailo-official','--experimental'],capture_output=True,text=True,check=True,timeout=90)
        body=json.loads(result.stdout);self.assertEqual(body['status'],'PASS_REAL_IMAGE_SMOKE_ONLY')
        self.assertEqual(body['contract']['schema'],2);self.assertNotEqual(body['contract']['detector_sha256'],DETECTOR_SHA)
        self.assertFalse(body['contract']['production_approved'])


if __name__=='__main__':unittest.main()
