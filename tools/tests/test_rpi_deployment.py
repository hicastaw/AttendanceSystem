import importlib.util
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import subprocess
import sys
import json

spec = importlib.util.spec_from_file_location("deployment", Path(__file__).parents[1] / "rpi_deployment.py")
deployment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment)


class BackupTests(unittest.TestCase):
    def test_live_wal_backup_and_refuse_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "live.db"
            destination = Path(directory) / "backup.db"
            with closing(sqlite3.connect(source)) as writer:
                writer.execute("PRAGMA journal_mode=WAL")
                writer.execute("CREATE TABLE events(id TEXT PRIMARY KEY)")
                writer.execute("INSERT INTO events VALUES ('event-1')")
                writer.commit()
                result = deployment.backup_database(source, destination)
                self.assertEqual(result["integrity_check"], "ok")
                with closing(sqlite3.connect(destination)) as backup:
                    self.assertEqual(backup.execute("SELECT id FROM events").fetchone()[0], "event-1")
                with self.assertRaises(FileExistsError):
                    deployment.backup_database(source, destination)
                with self.assertRaises(ValueError):
                    deployment.backup_database(source, source)

    def test_missing_source_does_not_create_database(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(FileNotFoundError):
                deployment.backup_database(Path(directory) / "missing.db", Path(directory) / "backup.db")
            self.assertFalse((Path(directory) / "backup.db").exists())

    def test_restore_roundtrip_keeps_schema_rows_and_source_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            source, snapshot, restored = [Path(directory) / name for name in ('live.db', 'backup.db', 'restored.db')]
            with closing(sqlite3.connect(source)) as db:
                db.executescript("PRAGMA user_version=7; CREATE TABLE events(id TEXT PRIMARY KEY, value TEXT);"
                                 "INSERT INTO events VALUES ('synthetic-1', 'test only');")
            deployment.backup_database(source, snapshot)
            original = snapshot.read_bytes()
            result = deployment.restore_database(snapshot, restored)
            self.assertEqual(result['integrity_check'], 'ok')
            self.assertEqual(snapshot.read_bytes(), original)
            with closing(sqlite3.connect(restored)) as db:
                self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 7)
                self.assertEqual(db.execute('SELECT * FROM events').fetchall(), [('synthetic-1', 'test only')])
            with self.assertRaises(FileExistsError):
                deployment.restore_database(snapshot, restored)
            with self.assertRaises(ValueError):
                deployment.restore_database(snapshot, snapshot)

    def test_corrupt_source_removes_only_new_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory)/'corrupt.db', Path(directory)/'new.db'
            source.write_bytes(b'synthetic non-SQLite input')
            with self.assertRaises(sqlite3.DatabaseError):
                deployment.backup_database(source, target)
            self.assertFalse(target.exists())
            self.assertEqual(source.read_bytes(), b'synthetic non-SQLite input')

    def test_restore_refuses_orphan_sidecars_without_touching_them(self):
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory)/'snapshot.db', Path(directory)/'new.db'
            with closing(sqlite3.connect(source)) as db:
                db.execute('CREATE TABLE synthetic(id INTEGER)')
            for suffix in ('-wal', '-shm', '-journal'):
                sidecar = Path(str(target)+suffix)
                sidecar.write_bytes(b'sentinel')
                with self.assertRaises(FileExistsError):
                    deployment.restore_database(source, target)
                self.assertFalse(target.exists())
                self.assertEqual(sidecar.read_bytes(), b'sentinel')
                sidecar.unlink()

    def test_busy_backup_has_a_deadline_and_cleans_partial_output(self):
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory)/'locked.db', Path(directory)/'new.db'
            with closing(sqlite3.connect(source)) as db:
                db.execute('CREATE TABLE synthetic(id INTEGER)')
                db.commit()
                db.execute('BEGIN EXCLUSIVE')
                result = subprocess.run([sys.executable, '-B', str(Path(deployment.__file__)),
                    'backup', str(source), str(target), '--timeout-seconds', '.15'],
                    capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(json.loads(result.stderr)['error'], 'TimeoutError')
                self.assertFalse(target.exists())
                db.rollback()

    def test_cli_restore_on_synthetic_sqlite_and_non_destructive_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            live, source, target = [Path(directory)/name for name in ('live.db', 'snapshot.db', 'restored.db')]
            with closing(sqlite3.connect(live)) as db:
                db.executescript('CREATE TABLE test(id INTEGER);INSERT INTO test VALUES (1);')
            backup = subprocess.run([sys.executable, '-B', str(Path(deployment.__file__)), 'backup', str(live), str(source)],
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(backup.returncode, 0, backup.stderr)
            self.assertEqual(json.loads(backup.stdout)['integrity_check'], 'ok')
            command = [sys.executable, '-B', str(Path(deployment.__file__)), 'restore', str(source), str(target)]
            result = subprocess.run(command, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)['operation'], 'restore-to-new-file')
            before = target.read_bytes()
            result = subprocess.run(command, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(json.loads(result.stderr)['error'], 'FileExistsError')
            self.assertEqual(target.read_bytes(), before)

    def test_invalid_time_budget_fails_before_creating_any_output(self):
        with tempfile.TemporaryDirectory() as directory:
            for budget in (0, -1, float('nan'), float('inf')):
                with self.assertRaisesRegex(ValueError, 'finite and positive'):
                    deployment.backup_database(Path(directory)/'missing.db', Path(directory)/'new.db', budget)
                self.assertEqual(list(Path(directory).iterdir()), [])


class PreflightTests(unittest.TestCase):
    def test_commands_report_nonzero_missing_and_timeout_without_shell(self):
        with patch.object(deployment.subprocess, 'run', return_value=subprocess.CompletedProcess([], 3, 'out', 'err')) as run:
            self.assertEqual(deployment.run_command(['synthetic']), {'exit_code': 3, 'output': 'outerr'})
            self.assertEqual(run.call_args.kwargs['timeout'], 15)
            self.assertNotIn('shell', run.call_args.kwargs)
        for error in (FileNotFoundError('synthetic'), subprocess.TimeoutExpired(['synthetic'], 15)):
            with patch.object(deployment.subprocess, 'run', side_effect=error):
                self.assertIn('unavailable', deployment.run_command(['synthetic']))

    def test_software_only_never_invokes_hardware_commands(self):
        with patch.object(deployment.platform, 'system', return_value='Linux'), patch.object(deployment, 'run_command') as run:
            result = deployment.preflight(software_only=True)
            run.assert_not_called()
            self.assertIn('storage', result)
            self.assertNotIn('hailo', result)

    def test_software_only_cli_outputs_json_without_ml_or_camera_dependencies(self):
        result = subprocess.run([sys.executable, '-B', str(Path(deployment.__file__)), 'preflight', '--software-only'],
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('storage', json.loads(result.stdout))

    def test_missing_os_release_does_not_abort_remaining_diagnostics(self):
        with patch.object(deployment.platform, 'system', return_value='Linux'), patch.object(Path, 'read_text', side_effect=OSError('synthetic unavailable')), patch.object(deployment, 'run_command', return_value={'exit_code': 1, 'output': 'synthetic'}) as run:
            result = deployment.preflight()
            self.assertIn('unavailable', result['os_release'])
            self.assertEqual(run.call_count, 5)
            self.assertEqual(result['hailo']['exit_code'], 1)


if __name__ == "__main__":
    unittest.main()
