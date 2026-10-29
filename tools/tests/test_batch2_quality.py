"""Config/package/dependency regressions use temporary fixtures; never load real .env."""
import importlib.util
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools'))
import rpi_release as release


class ConfigTests(unittest.TestCase):
    def read_config(self, text, overrides=None):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder)/'synthetic.env'
            target.write_text(text, encoding='utf-8')
            env = {k:v for k,v in os.environ.items() if k not in {
                'CAMERA_FPS', 'PROCESS_EVERY_N_FRAMES', 'SIMILARITY_THRESHOLD', 'STREAM_HOST',
                'CAMERA_BACKEND', 'SERVER_BASE_URL', 'MODEL_DIR', 'EDGE_ENV_FILE'}}
            env.update(EDGE_ENV_FILE=str(target), PYTHONDONTWRITEBYTECODE='1', **(overrides or {}))
            script = "import sys,json;sys.path.insert(0,sys.argv[1]);import config;print(json.dumps({k:getattr(config,k) for k in ['CAMERA_FPS','PROCESS_EVERY_N_FRAMES','SIMILARITY_THRESHOLD','STREAM_HOST','CAMERA_BACKEND','SERVER_BASE_URL','DETECTOR_MODEL_PATH']}))"
            process = subprocess.run([sys.executable,'-B','-c',script,str(ROOT/'AIOT/edge')],
                                     cwd=folder,env=env,capture_output=True,text=True,timeout=10)
            self.assertEqual(process.returncode,0,process.stderr)
            return json.loads(process.stdout)

    def test_explicit_env_file_quotes_comments_and_process_environment_precedence(self):
        value = self.read_config('# synthetic only\nCAMERA_FPS=7\nSTREAM_HOST="127.0.0.1"\nCAMERA_BACKEND=picamera2\n', {'CAMERA_FPS':'12'})
        self.assertEqual(value['CAMERA_FPS'],12)
        self.assertEqual(value['STREAM_HOST'],'127.0.0.1')
        self.assertEqual(value['CAMERA_BACKEND'],'picamera2')

    def test_existing_numeric_fallback_clamp_and_model_path_contract(self):
        value = self.read_config('CAMERA_FPS=invalid\nPROCESS_EVERY_N_FRAMES=0\nSIMILARITY_THRESHOLD=invalid\nMODEL_DIR=synthetic-models\n')
        self.assertEqual(value['CAMERA_FPS'],10)
        self.assertEqual(value['PROCESS_EVERY_N_FRAMES'],1)
        self.assertEqual(value['SIMILARITY_THRESHOLD'],.60)
        self.assertEqual(Path(value['DETECTOR_MODEL_PATH']),Path('synthetic-models/face_detection_yunet_2023mar.onnx'))


class ReleaseQualityTests(unittest.TestCase):
    def test_service_test_and_mock_share_exact_runtime_pins_and_include_flask(self):
        runtime=release.requirements_profile(ROOT,'AIOT/server/ai/requirements.txt')
        tests=release.requirements_profile(ROOT,'tools/requirements-test.txt')
        mock=release.requirements_profile(ROOT,'tools/requirements-laptop.txt')
        for name,version in runtime['requirements'].items():
            self.assertEqual(tests['requirements'][name],version)
        for name,version in mock['requirements'].items():
            self.assertEqual(runtime['requirements'][name],version)
        self.assertIn('flask',runtime['requirements']);self.assertIn('werkzeug',runtime['requirements'])

    def test_requirement_cycle_escape_and_conflicting_constraint_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            path=root/'requirements.txt';other=root/'other.txt'
            path.write_text('-r other.txt\n',encoding='utf-8');other.write_text('-r requirements.txt\n',encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'cycle'):release.requirements_profile(root,'requirements.txt')
            path.write_text('-r ../outside.txt\n',encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'escapes'):release.requirements_profile(root,'requirements.txt')
            path.write_text('requests==2.34.2\n-c other.txt\n',encoding='utf-8');other.write_text('requests==1.0\n',encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'constraint conflict'):release.requirements_profile(root,'requirements.txt')

    def test_first_party_import_and_requirements_omission_fail_even_for_new_modules(self):
        inventory=release.release_inventory()
        with tempfile.TemporaryDirectory() as folder:
            stage=Path(folder)
            for name in inventory:
                path=stage/name;path.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/name,path)
            path=stage/'AIOT/edge/new_feature.py'
            path.write_text('import missing_local_feature\n',encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'Unresolved first-party Python import'):
                release.release_inventory(stage)
            path.unlink()
            path=stage/'AIOT/server/src/new-feature.js'
            path.write_text("import missing from './not-packaged.js';\n",encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'Unresolved first-party JS import'):
                release.release_inventory(stage)
            path.unlink()
            example=stage/'AIOT/server/.env.example'
            original=example.read_text(encoding='utf-8')
            example.write_text('ADMIN_PASSWORD=synthetic-not-deployable-test-value\n',encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'Non-placeholder credential'):
                release.release_inventory(stage)
            example.write_text(original,encoding='utf-8')
            (stage/'AIOT/constraints-laptop-py311.txt').unlink()
            with self.assertRaisesRegex(ValueError,'Missing required release files'):
                release.release_inventory(stage)

    def test_archive_scoped_test_target_keeps_default_legacy_regression_coverage(self):
        scripts=json.loads((ROOT/'AIOT/server/package.json').read_text())['scripts']
        self.assertIn('test_legacy_auth.mjs',scripts['test'])
        self.assertNotIn('test_legacy_auth.mjs',scripts['test:aiot'])
        self.assertIn('test_release_contracts.mjs',scripts['test'])
        self.assertIn('test_release_contracts.mjs',scripts['test:aiot'])

    def test_operational_regressions_are_registered_and_packaged(self):
        inventory = release.release_inventory()
        scripts = json.loads((ROOT/'AIOT/server/package.json').read_text())['scripts']
        for name in ('test', 'test:aiot'):
            self.assertIn('test_operational_tools.mjs', scripts[name])
            self.assertIn('--test-timeout=45000', scripts[name])
        for name in ('tools/run_mock.mjs', 'tools/rpi_deployment.py', 'tools/test_operational_tools.mjs',
                     'tools/tests/test_rpi_deployment.py', 'docs/SOFTWARE_ENVIRONMENT.md'):
            self.assertIn(name, inventory)

    def test_local_operations_guide_has_valid_links_fences_and_current_entrypoints(self):
        document = ROOT/'docs/SOFTWARE_ENVIRONMENT.md'
        source = document.read_text(encoding='utf-8')
        self.assertEqual(len(re.findall(r'^```', source, re.M)) % 2, 0)
        for target in re.findall(r'\[[^\]\n]+\]\(([^\s)]+)\)', source):
            if not target.startswith(('https://', 'http://')):
                self.assertTrue((document.parent/target).is_file(), target)
        for entry in ('tools/run_mock.mjs', 'tools/simulate_recognition.py', 'tools/rpi_deployment.py',
                      'AIOT/server/src/index.js', 'AIOT/server/ai/main.py'):
            self.assertTrue((ROOT/entry).is_file(), entry)
        for required in ('--software-only', '--timeout-seconds 30', '--manual', 'BLOCKED_HARDWARE',
                         'BLOCKED_MODEL_PROVENANCE', 'A08', 'A09', 'UNVERIFIED'):
            self.assertIn(required, source)

    def test_ci_runs_locked_browser_tool_and_quality_gates_with_job_timeout(self):
        workflow=(ROOT/'.github/workflows/software.yml').read_text(encoding='utf-8')
        for required in ('timeout-minutes:', 'pip check', 'npm ci --prefix AIOT/server',
                         'tools/check_software.py', 'tools/rpi_release.py git-readiness',
                         'working-directory: AIOT/server', 'npx --no-install playwright install'):
            self.assertIn(required,workflow)

    def test_git_readiness_reports_missing_and_dirty_files_without_mutation(self):
        for head,changed,expected in [('AIOT/edge/main.py\n','', 'BLOCKED'),
                                      ('AIOT/edge/main.py\nnew.py\n','new.py\n','BLOCKED'),
                                      ('AIOT/edge/main.py\nnew.py\n','', 'PASS')]:
            with self.subTest(expected=expected),patch.object(release,'release_inventory',return_value={
                    'AIOT/edge/main.py':'synthetic','new.py':'synthetic'}),patch.object(
                    release.subprocess,'check_output',side_effect=[head,changed,'test-head\n']) as command:
                result=release.git_readiness(ROOT)
                self.assertEqual(result['status'],expected)
                verbs=[call.args[0][3] for call in command.call_args_list]
                self.assertEqual(verbs,['ls-tree','diff','rev-parse'])


if __name__=='__main__':unittest.main()
