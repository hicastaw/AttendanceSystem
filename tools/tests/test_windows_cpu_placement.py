"""Portable isolated-worker placement policy; no native affinity changes in tests."""
import struct
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import windows_cpu_placement as placement


def topology():
    return [dict(group=0, logical=0, core=0, efficiency=1, flags=0),
            dict(group=0, logical=1, core=0, efficiency=1, flags=0),
            dict(group=0, logical=2, core=2, efficiency=1, flags=0),
            dict(group=0, logical=3, core=3, efficiency=0, flags=0)]


class FakeWindowsApi:
    def __init__(self, rows=None, mask=15):
        self.rows = topology() if rows is None else rows
        self.mask = mask
        self.sets = []

    def cpu_sets(self):
        return self.rows

    def affinity(self):
        return self.mask

    def set_affinity(self, mask):
        self.sets.append(mask)
        self.mask = mask


class WindowsPlacementTests(unittest.TestCase):
    def test_selects_fastest_allowed_physical_cores_without_smt_or_expansion(self):
        self.assertEqual(placement.select_performance_cpus(topology(), 15), [0, 2])
        self.assertEqual(placement.select_performance_cpus(topology(), 10), [1])
        self.assertEqual(placement.select_performance_cpus(topology(), 8), [])
        rows = topology()
        rows[2]['flags'] = 2  # Allocated to another process, not this one.
        self.assertEqual(placement.select_performance_cpus(rows, 15), [0])

    def test_scope_and_non_windows_are_noops_before_native_api(self):
        factory = Mock(side_effect=AssertionError('must not access native API'))
        for purpose, system in [('production', 'Windows'), ('isolated-cpu-test', 'Windows'),
                                ('isolated-r50-laptop-test', 'Linux')]:
            result = placement.place_isolated_worker(purpose, system=system, api_factory=factory)
            self.assertEqual(result['status'], 'not_applicable')
        factory.assert_not_called()

    def test_homogeneous_and_restricted_cpu_sets_keep_existing_affinity(self):
        for rows, mask in [([dict(group=0, logical=0, core=0, efficiency=0, flags=0)], 1),
                           (topology(), 8)]:
            api = FakeWindowsApi(rows, mask)
            result = placement.place_isolated_worker('isolated-r50-laptop-test', system='Windows', api_factory=lambda: api)
            self.assertEqual(result['status'], 'unchanged')
            self.assertEqual(api.mask, mask)
            self.assertEqual(api.sets, [])

    def test_policy_applies_to_current_process_and_verifies_effective_mask(self):
        api = FakeWindowsApi()
        result = placement.place_isolated_worker('isolated-r50-laptop-test', system='Windows', api_factory=lambda: api)
        self.assertEqual(result['status'], 'applied')
        self.assertEqual(result['logical_processors'], [0, 2])
        self.assertGreater(result['process_id'], 0)
        self.assertEqual(api.mask, 5)

    def test_missing_api_and_set_failure_fall_back_without_expanding_affinity(self):
        result = placement.place_isolated_worker('isolated-r50-laptop-test', system='Windows',
                                                api_factory=Mock(side_effect=OSError('unavailable')))
        self.assertEqual(result['status'], 'fallback')
        api = FakeWindowsApi()
        api.set_affinity = Mock(side_effect=OSError('denied'))
        result = placement.place_isolated_worker('isolated-r50-laptop-test', system='Windows', api_factory=lambda: api)
        self.assertEqual(result['status'], 'fallback')
        self.assertEqual(api.mask, 15)

    def test_failed_verification_restores_original_mask(self):
        api = FakeWindowsApi()
        def set_mask(mask):
            api.sets.append(mask)
            api.mask = 1 if mask == 5 else mask
        api.set_affinity = set_mask
        result = placement.place_isolated_worker('isolated-r50-laptop-test', system='Windows', api_factory=lambda: api)
        self.assertEqual(result['status'], 'fallback')
        self.assertEqual(api.mask, 15)
        self.assertEqual(api.sets, [5, 15])

    def test_multiple_groups_fall_back_without_mutating_affinity(self):
        api = FakeWindowsApi([dict(group=1, logical=0, core=0, efficiency=1, flags=0)])
        result = placement.place_isolated_worker('isolated-r50-laptop-test', system='Windows', api_factory=lambda: api)
        self.assertEqual(result['status'], 'fallback')
        self.assertEqual(api.sets, [])

    def test_variable_size_native_records_and_malformed_buffers(self):
        record = bytearray(40)
        struct.pack_into('<II', record, 0, 40, 0)
        struct.pack_into('<H', record, 12, 0)
        record[14:20] = bytes([6, 4, 0, 0, 2, 0])
        rows = placement.parse_cpu_sets(bytes(record))
        self.assertEqual(rows[0], dict(group=0, logical=6, core=4, efficiency=2, flags=0))
        for malformed in (b'', b'123', struct.pack('<II', 0, 0), bytes(record[:20])):
            with self.subTest(size=len(malformed)), self.assertRaises(ValueError):
                placement.parse_cpu_sets(malformed)


if __name__ == '__main__':
    unittest.main()
