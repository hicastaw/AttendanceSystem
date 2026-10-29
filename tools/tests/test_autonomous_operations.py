"""Temporary SQLite, synthetic tensors and verified existing legacy model only."""
from contextlib import closing
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'tools'),str(ROOT/'AIOT/edge')]
import rpi_deployment as operations
import benchmark_reference
from reference_adapters import decode_scrfd, r50_output
from outbox import DurableOutbox
from service_watchdog import notify


class OperationsTests(unittest.TestCase):
    def test_managed_retention_is_dry_run_and_never_deletes_unowned_or_changed_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=root/'test.db';directory=root/'backups'
            with closing(sqlite3.connect(source)) as db:db.execute('CREATE TABLE sentinel(id INTEGER)')
            for _ in range(3):operations.snapshot_database(source,directory)
            foreign=directory/'unmanaged.db';foreign.write_bytes(b'synthetic sentinel')
            malformed=directory/'malformed.sqlite.aiot-backup.json';malformed.write_text(json.dumps({'file':True}))
            before={path.name:path.read_bytes() for path in directory.iterdir()}
            result=operations.retain_snapshots(directory,keep=1)
            self.assertEqual(result['status'],'DRY_RUN');self.assertEqual(len(result['selected']),2)
            self.assertEqual(before,{path.name:path.read_bytes() for path in directory.iterdir()})
            operations.retain_snapshots(directory,keep=1,apply=True)
            self.assertEqual(len(list(directory.glob('*.sqlite'))),1)
            self.assertEqual(foreign.read_bytes(),b'synthetic sentinel');self.assertTrue(malformed.exists())
            remaining=next(directory.glob('*.sqlite'));remaining.write_bytes(b'changed test snapshot')
            result=operations.retain_snapshots(directory,keep=1,apply=True)
            self.assertEqual(result['selected'],[]);self.assertTrue(remaining.exists())

    def test_retention_rejects_escape_manifest_and_zero_retention(self):
        with tempfile.TemporaryDirectory() as folder:
            directory=Path(folder)/'backups';directory.mkdir();sentinel=Path(folder)/'outside.db';sentinel.write_bytes(b'keep')
            (directory/'bad.sqlite.aiot-backup.json').write_text(json.dumps(dict(schema=1,file='../outside.db',created_at=0,sha256=operations.sha256(sentinel))))
            self.assertEqual(operations.retain_snapshots(directory,1,True)['selected'],[])
            self.assertEqual(sentinel.read_bytes(),b'keep')
            with self.assertRaises(ValueError):operations.retain_snapshots(directory,0,True)

    def test_outbox_inspect_requires_existing_schema_and_does_not_create_a_missing_db(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'outbox.db'
            with self.assertRaises(FileNotFoundError):operations.outbox_admin(path)
            self.assertFalse(path.exists())
            DurableOutbox(path)
            self.assertEqual(operations.outbox_admin(path),{'status':'READ_ONLY','counts':{}})

    def test_watchdog_only_uses_notify_socket_and_does_not_claim_hardware_health(self):
        with patch.dict('os.environ',{},clear=True):self.assertFalse(notify('WATCHDOG=1'))
        connection=Mock();connection.__enter__=Mock(return_value=connection);connection.__exit__=Mock(return_value=False)
        with patch.dict('os.environ',{'NOTIFY_SOCKET':'@synthetic'}),patch('service_watchdog.socket.AF_UNIX',1,create=True),patch('service_watchdog.socket.socket',return_value=connection):
            self.assertTrue(notify('READY=1'));connection.connect.assert_called_once_with('\0synthetic');connection.sendall.assert_called_once_with(b'READY=1')
        unit=(ROOT/'deploy/rpi5/attendance-worker.service').read_text()
        for expected in ('Type=notify','WatchdogSec=60','StartLimitBurst=3','KillMode=control-group','StateDirectoryMode=0700'):
            self.assertIn(expected,unit)

    def test_reference_scrfd_shapes_stride_transform_and_nms(self):
        counts=[32,8,2]
        outputs=[np.zeros((n,1)) for n in counts]+[np.ones((n,4)) for n in counts]+[np.zeros((n,10)) for n in counts]
        outputs[0][10:12]=.9  # two anchors at same cell -> NMS one candidate
        result=decode_scrfd(outputs,size=(32,32),scale=2,padding=(0,0))
        self.assertEqual(len(result),1)
        np.testing.assert_allclose(result[0].bbox_xyxy,[0,0,8,8])
        np.testing.assert_allclose(result[0].landmarks_5,np.full((5,2),4))
        outputs[3]=np.zeros((31,4))
        with self.assertRaises(ValueError):decode_scrfd(outputs,size=(32,32),scale=1)
        with self.assertRaises(ValueError):r50_output(np.zeros((1,512)))
        np.testing.assert_allclose(r50_output(np.ones((1,512))),np.ones(512)/np.sqrt(512))

    def test_reference_benchmark_requires_hash_and_explicit_graph_shape(self):
        model=ROOT/'AIOT/edge/model/w600k_mbf.onnx';digest=operations.sha256(model)
        with self.assertRaises(ValueError):benchmark_reference.benchmark(model,'wrong',[1,3,112,112],1)
        with self.assertRaises(ValueError):benchmark_reference.benchmark(model,digest,[1,3,100,100],1)
        result=benchmark_reference.benchmark(model,digest,[1,3,112,112],1)
        self.assertEqual(result['status'],'PASS_SYNTHETIC_RUNTIME_ONLY');self.assertFalse(result['hardware_verified'])


if __name__=='__main__':unittest.main()
