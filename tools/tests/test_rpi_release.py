"""Pi5 archive/URL contract tests. No systemd, shell launcher, SSH or hardware."""
import importlib.util
import io
from pathlib import Path
import re
import shutil
import tarfile
import tempfile
import unittest
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('rpi_release', ROOT/'tools/rpi_release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class PiReleaseTests(unittest.TestCase):
    def test_unit_launcher_and_existing_kiosk_page_agree(self):
        unit = (ROOT/'deploy/rpi5/attendance-kiosk.service').read_text(encoding='utf-8')
        launcher = (ROOT/'deploy/rpi5/kiosk_launcher.sh').read_text(encoding='utf-8')
        configured = re.search(r'^Environment=KIOSK_URL=(\S+)$', unit, re.M).group(1)
        default = re.search(r'KIOSK_URL="\$\{KIOSK_URL:-(.*?)\}"', launcher).group(1)
        self.assertEqual(configured, default)
        self.assertEqual(urlsplit(configured).path, '/kiosk.html')
        self.assertIn('deploy/rpi5/kiosk_launcher.sh', unit)
        self.assertIn('"$KIOSK_URL"', launcher)
        page = ROOT/'AIOT/server/public'/urlsplit(configured).path.lstrip('/')
        self.assertTrue(page.is_file())
        self.assertIn('kiosk.js', page.read_text(encoding='utf-8'))

    def test_build_and_verify_current_first_party_inventory_excludes_runtime_data(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'release.tar.gz'
            result = release.build_release(target)
            self.assertEqual(result['status'], 'PASS')
            self.assertFalse(result['hardware_verified'])
            with tarfile.open(target) as package:
                names = package.getnames()
            self.assertIn('AIOT/embedding-contract.json', names)
            self.assertIn('AIOT/edge/stream_server.py', names)
            for name in names:
                self.assertTrue(release.allowed(name), name)
            with self.assertRaises(FileExistsError):release.build_release(target)
            for name in ('AIOT/server/.env', 'AIOT/server/data/test.db', 'AIOT/server/uploads/face.jpg',
                         'tools/runtime.json', 'AIOT/.venv/a.py', '../AIOT/edge/main.py',
                         '/AIOT/edge/main.py', 'AIOT\\edge\\main.py'):
                self.assertFalse(release.allowed(name), name)

    def test_missing_manifest_or_first_party_module_rejected_in_staging(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)/'stage'
            inventory = release.release_inventory()
            for name in inventory:
                target = stage/name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT/name, target)
            for name in ('AIOT/embedding-contract.json', 'AIOT/edge/outbox.py', 'AIOT/server/src/routes/kiosk.js'):
                target = stage/name
                data = target.read_bytes()
                target.unlink()  # Only this test's staging fixture.
                with self.assertRaisesRegex(ValueError, 'Missing required release files'):
                    release.release_inventory(stage)
                target.write_bytes(data)

    def test_archive_missing_imported_module_tamper_or_link_rejected(self):
        inventory = release.release_inventory()
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'bad.tar.gz'
            with tarfile.open(target, 'w:gz') as package:
                for name in inventory:
                    if name != 'AIOT/edge/attendance_service.py':
                        package.add(ROOT/name, arcname=name, recursive=False)
            with self.assertRaisesRegex(ValueError, 'Missing release files'):
                release.verify_release(target)
            with tarfile.open(target, 'w:gz') as package:
                for name in inventory:
                    if name == 'AIOT/embedding-contract.json':
                        data = (ROOT/name).read_bytes()
                        data = bytes([data[0] ^ 1]) + data[1:]
                        member = tarfile.TarInfo(name); member.size = len(data)
                        package.addfile(member, io.BytesIO(data))
                    else:
                        package.add(ROOT/name, arcname=name, recursive=False)
            with self.assertRaisesRegex(ValueError, 'digest mismatch'):
                release.verify_release(target)
            with tarfile.open(target, 'w:gz') as package:
                member = tarfile.TarInfo('AIOT/edge/main.py')
                member.type = tarfile.SYMTYPE; member.linkname = '/etc/passwd'
                package.addfile(member)
            with self.assertRaisesRegex(ValueError, 'unsafe archive member'):
                release.verify_release(target)


if __name__ == '__main__':
    unittest.main()
