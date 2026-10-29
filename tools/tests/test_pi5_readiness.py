"""Platform gate tests and synthetic descriptor checks; no hardware access."""
from pathlib import Path
import json
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pi5_readiness_preflight as preflight
import r50_synthetic_check as r50
from cpu_onnx import load_descriptor


class Pi5ReadinessTests(unittest.TestCase):
    def test_platform_requires_arm64_userspace_and_actual_board_evidence(self):
        self.assertEqual(preflight.platform_blockers('Linux', 'aarch64', 64, 'Raspberry Pi 5 Model B', (3, 13)), [])
        for system, machine, bits, model, python, error in (
            ('Windows', 'AMD64', 64, None, (3, 11), 'LINUX_REQUIRED'),
            ('Linux', 'aarch64', 32, 'Raspberry Pi 5', (3, 11), 'ARM64_USERSPACE_REQUIRED'),
            ('Linux', 'aarch64', 64, None, (3, 11), 'PI5_BOARD_NOT_VERIFIED'),
            ('Linux', 'aarch64', 64, 'Raspberry Pi 5', (3, 9), 'PYTHON_3_11_OR_NEWER_REQUIRED'),
        ):
            self.assertIn(error, preflight.platform_blockers(system, machine, bits, model, python))

    def test_missing_proc_memory_and_partial_keys_are_not_invented(self):
        self.assertEqual(preflight.memory_kib(None), {})
        self.assertEqual(preflight.memory_kib('MemTotal: 8000 kB\nMemAvailable: 2000 kB\nOther: 4 kB'),
                         {'MemTotal': 8000, 'MemAvailable': 2000})

    def test_inventory_never_executes_camera_or_hailo_tools(self):
        from types import SimpleNamespace as NS
        # platform.uname may execute Windows `ver` on its first uncached call;
        # keep host inventory deterministic when asserting our command allowlist.
        with patch.multiple(preflight.platform, system=lambda:'Linux', machine=lambda:'aarch64',
                            release=lambda:'test-kernel', libc_ver=lambda:('glibc', '2.41'),
                            python_version=lambda:'3.13.0'), \
                patch.object(preflight, 'read_text', return_value=None), \
                patch.object(preflight.shutil, 'which', side_effect=lambda name:'/tools/'+name), \
                patch.object(preflight.subprocess, 'run', return_value=NS(returncode=0, stdout='v24', stderr='')) as run:
            result = preflight.inventory(Path.cwd())
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.args[0], ['/tools/node', '--version'])
        self.assertFalse(result['camera_opened'])
        self.assertFalse(result['inference_executed'])

    def test_benchmark_rejects_unbounded_work_before_loading_model(self):
        with patch.object(r50, 'load_descriptor') as load:
            for options in ({'iterations': 0}, {'iterations': 101}, {'threads': 0}, {'threads': 17}, {'warmup': 21}):
                with self.assertRaises(ValueError):
                    r50.check('unused', **options)
            load.assert_not_called()

    def test_descriptor_model_load_error_is_propagated_without_fallback(self):
        descriptor = Path(__file__).resolve().parents[2]/'AIOT/edge/model/r50-experimental-laptop.json'
        specs = json.loads(descriptor.read_text(encoding='utf-8'))
        from types import SimpleNamespace as NS
        spec = specs['detector']
        detector_session = NS(
            get_inputs=lambda:[NS(name=spec['input'], type='tensor(float)', shape=spec['shape'])],
            get_outputs=lambda:[NS(name=o['name'], type='tensor(float)', shape=o['shape']) for o in spec['outputs']])
        for responses, calls in (([OSError('detector unavailable')], 1),
                                 ([detector_session, OSError('recognizer unavailable')], 2)):
            with self.subTest(calls=calls), patch('cpu_onnx.model_session', side_effect=responses) as factory:
                with self.assertRaisesRegex(OSError, 'unavailable'):
                    load_descriptor(descriptor, experimental=True)
                self.assertEqual(factory.call_count, calls)


if __name__ == '__main__':
    unittest.main()
