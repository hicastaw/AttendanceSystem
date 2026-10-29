"""Build/verify the Pi5 Phase16 source archive locally; never SSH, install or deploy.

An allowlisted inventory includes untracked first-party source, but excludes
runtime data, credentials and environments. Verification compares against the
reviewed source tree, including every selected file's digest, without extraction.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
ROOTS = ('AIOT', 'docs', 'tools', 'deploy', '.github')
SKIP_DIRS = {'node_modules', '.venv', '__pycache__', 'data', 'uploads', 'faces',
             'logs', '.git', '.deployment-audit'}
TEXT_SUFFIXES = {'.py', '.js', '.mjs', '.html', '.css', '.sql', '.sh', '.service', '.md'}
JSON_NAMES = {'embedding-contract.json', 'package.json', 'package-lock.json'}
MODELS = {f'AIOT/{folder}/model/{name}' for folder in ('edge', 'server/ai')
          for name in ('face_detection_yunet_2023mar.onnx', 'w600k_mbf.onnx')}
REQUIRED = {
    'AIOT/embedding-contract.json', 'AIOT/edge/main.py', 'AIOT/edge/model_contract.py',
    'AIOT/edge/outbox.py', 'AIOT/edge/member_gallery.py', 'AIOT/edge/pipeline.py',
    'AIOT/edge/worker_status.py', 'AIOT/server/package.json', 'AIOT/server/package-lock.json',
    'AIOT/server/src/index.js', 'AIOT/server/src/db.js', 'AIOT/server/src/runtime.js',
    'AIOT/server/src/schema.sql', 'AIOT/server/src/routes/kiosk.js',
    'AIOT/server/public/kiosk.html', 'AIOT/server/public/kiosk.js', 'AIOT/server/public/kiosk.css',
    'AIOT/server/ai/main.py', 'AIOT/server/ai/core/face_engine.py',
    'AIOT/server/ai/requirements.txt', 'AIOT/server/.env.example', 'AIOT/.env.example',
    'deploy/rpi5/attendance-backend.service', 'deploy/rpi5/attendance-enrollment-cpu.service',
    'deploy/rpi5/attendance-kiosk.service', 'deploy/rpi5/kiosk_launcher.sh',
    'tools/rpi_release.py',
    'AIOT/requirements-base.txt', 'AIOT/requirements-cpu.txt',
    'AIOT/constraints-laptop-py311.txt', 'tools/requirements-test.txt',
    '.github/workflows/software.yml',
} | MODELS
REQUIRED |= {'AIOT/edge/'+name+'.py' for name in (
    'api_client', 'attendance_service', 'attendance_schedule', 'camera', 'config',
    'face_detector', 'face_recognizer', 'health', 'stream_server')}
REQUIRED |= {'AIOT/server/src/'+name+'.js' for name in (
    'attendance-schedule', 'upload', 'middleware/auth', 'routes/auth', 'routes/users',
    'routes/access-events', 'routes/scheduled-events')}
REQUIRED |= {'AIOT/server/public/'+name for name in ('app.js', 'index.html', 'style.css')}
REQUIRED |= {'AIOT/edge/'+name+'.py' for name in ('recovery','capture_session','reference_adapters','service_watchdog')}
REQUIRED |= {'AIOT/server/public/'+name for name in ('capture.html','capture.js','capture.css')}
REQUIRED |= {'AIOT/server/src/routes/capture.js','deploy/rpi5/attendance-worker.service',
             'deploy/rpi5/worker.env.example','tools/benchmark_reference.py','tools/test_autonomous_integration.mjs',
             'tools/synthetic_capture_worker.py'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def allowed(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name or not path.parts or path.parts[0] not in ROOTS:
        return False
    if name == '.github/workflows/software.yml':
        return True  # First-party CI contract used by source-package regression tests.
    if any(part in SKIP_DIRS or (part.startswith('.') and part != '.env.example') for part in path.parts):
        return False
    if path.name == '.env.example' or path.name.endswith('.env.example'):
        return True
    if path.suffix == '.onnx':
        return name in MODELS
    return (path.suffix in TEXT_SUFFIXES or path.name in JSON_NAMES or
            (path.suffix == '.txt' and path.name.startswith(('requirements', 'constraints-'))))


def requirements_profile(source, entry):
    """Resolve local -r/-c closure; keep install requirements distinct from constraints."""
    source = Path(source).resolve()
    result = {'files': set(), 'requirements': {}, 'constraints': {}}
    def visit(relative, constraint=False, stack=()):
        target = (source/relative).resolve()
        if not target.is_relative_to(source) or target.is_symlink():
            raise ValueError('Requirements path escapes source: ' + str(relative))
        relative = target.relative_to(source).as_posix()
        if relative in stack:
            raise ValueError('Requirements include cycle: ' + relative)
        if not target.is_file():
            raise ValueError('Missing requirements file: ' + relative)
        result['files'].add(relative)
        for raw in target.read_text(encoding='utf-8').splitlines():
            line = raw.split('#', 1)[0].strip()
            if not line:
                continue
            if line.startswith(('-r ', '-c ')):
                child = (target.parent/line[3:].strip()).relative_to(source).as_posix()
                visit(child, constraint or line.startswith('-c '), stack+(relative,))
                continue
            matched = re.fullmatch(r'([A-Za-z0-9_.-]+)==([^\s;]+)', line)
            if not matched:
                raise ValueError('Expected exact requirement pin in ' + relative)
            name, version = matched.groups()
            name = re.sub(r'[-_.]+', '-', name).lower()
            pins = result['constraints' if constraint else 'requirements']
            if name in pins and pins[name] != version:
                raise ValueError('Conflicting requirement pin: ' + name)
            pins[name] = version
    visit(entry)
    for name, version in result['requirements'].items():
        if name in result['constraints'] and result['constraints'][name] != version:
            raise ValueError('Requirement/constraint conflict: ' + name)
    return result


def validate_runtime_sources(source, inventory):
    """Check first-party import/asset/requirements closure, without importing apps."""
    source = Path(source).resolve()
    profile = requirements_profile(source, 'AIOT/server/ai/requirements.txt')
    tests = requirements_profile(source, 'tools/requirements-test.txt')
    mock = requirements_profile(source, 'tools/requirements-laptop.txt')
    for selected in (profile, tests, mock):
        missing = selected['files']-inventory.keys()
        if missing:
            raise ValueError('Requirements excluded from package: ' + ', '.join(sorted(missing)))
    for name, version in profile['requirements'].items():
        if tests['requirements'].get(name) != version:
            raise ValueError('Service/test dependency drift: ' + name)
    for name, version in mock['requirements'].items():
        if profile['requirements'].get(name) != version:
            raise ValueError('Mock/service dependency drift: ' + name)
    external = {'cv2': 'opencv-python-headless', 'numpy': 'numpy', 'requests': 'requests',
                'onnxruntime': 'onnxruntime', 'fastapi': 'fastapi', 'flask': 'flask',
                'werkzeug': 'werkzeug', 'PIL': 'pillow'}
    hardware = {'picamera2', 'libcamera'}
    checked = 0
    for name in inventory:
        if not name.endswith('.py') or not name.startswith(('AIOT/edge/', 'AIOT/server/ai/')):
            continue
        path = source/name
        tree = ast.parse(path.read_text(encoding='utf-8-sig'), filename=name)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                modules = [node.module] if node.module else []
            else:
                continue
            for module in modules:
                top = module.split('.')[0]
                if top in sys.stdlib_module_names or top in hardware:
                    continue
                # Optional, lazy import confined to the experimental Hailo transport.
                # Do not require/install a vendor driver in the CPU release profile.
                if top=='hailo_platform' and name=='AIOT/edge/experimental_hailo.py':
                    continue
                if top in external:
                    if external[top] not in profile['requirements']:
                        raise ValueError('Undeclared runtime dependency: ' + top)
                    continue
                bases = [path.parent, source/'AIOT/edge', source/'AIOT/server/ai']
                candidates = [(base/module.replace('.', '/')).with_suffix('.py') for base in bases]
                if not any(p.is_relative_to(source) and p.relative_to(source).as_posix() in inventory for p in candidates):
                    raise ValueError('Unresolved first-party Python import: ' + name + ': ' + module)
        checked += 1
    manifest = json.loads((source/'AIOT/server/package.json').read_text(encoding='utf-8'))
    lock = json.loads((source/'AIOT/server/package-lock.json').read_text(encoding='utf-8'))
    for field in ('dependencies', 'devDependencies'):
        if manifest.get(field, {}) != lock['packages'][''].get(field, {}):
            raise ValueError('npm package/lock drift: ' + field)
    for name in inventory:
        if name.startswith('AIOT/server/src/') and name.endswith('.js'):
            for target in re.findall(r'(?:from\s*|import\s*)[\'"]([^\'"]+)[\'"]', (source/name).read_text(encoding='utf-8')):
                if target.startswith('.'):
                    resolved = (source/name).parent.joinpath(target).resolve()
                    if not resolved.is_relative_to(source) or resolved.relative_to(source).as_posix() not in inventory:
                        raise ValueError('Unresolved first-party JS import: ' + name + ': ' + target)
                elif not target.startswith('node:') and target not in {'fs', 'path', 'url', 'crypto'}:
                    if target.split('/')[0] not in manifest['dependencies']:
                        raise ValueError('Undeclared Node dependency: ' + target)
        if name.startswith('AIOT/server/public/') and name.endswith('.html'):
            for target in re.findall(r'(?:src|href)=[\'"]([^\'"]+)[\'"]', (source/name).read_text(encoding='utf-8')):
                if target.startswith(('http:', 'https:', 'data:', '#')) or target == '/':
                    continue
                resolved = (source/'AIOT/server/public'/target.lstrip('/'))
                if resolved.relative_to(source).as_posix() not in inventory:
                    raise ValueError('Missing page asset: ' + target)
    return {'python_modules': checked, 'hardware_modules_not_verified': sorted(hardware)}


def git_readiness(source=ROOT):
    """Read-only HEAD comparison; does not stage or rewrite the working tree."""
    source = Path(source).resolve()
    inventory = release_inventory(source)
    def git(*args):
        return subprocess.check_output(['git', '-C', str(source), *args], text=True).strip()
    head = set(git('ls-tree', '-r', '--name-only', 'HEAD').splitlines())
    changed = set(git('diff', '--name-only', 'HEAD', '--').splitlines())
    absent = sorted(inventory.keys()-head)
    dirty = sorted(inventory.keys() & changed)
    return {'status': 'BLOCKED' if absent or dirty else 'PASS', 'head': git('rev-parse', '--short', 'HEAD'),
            'missing_from_head': absent, 'changed_from_head': dirty,
            'note': 'Local package validity does not imply clean Git reproducibility.'}


def release_inventory(source=ROOT):
    source = Path(source).resolve()
    inventory = {}
    def walk(directory):
        for path in sorted(directory.iterdir()):
            relative = path.relative_to(source).as_posix()
            if path.name in SKIP_DIRS or (path.name.startswith('.') and path.name != '.env.example'):
                continue
            if path.is_symlink():
                raise ValueError('Release symlink refused: ' + relative)
            if path.is_dir():
                walk(path)
            elif path.is_file() and allowed(relative):
                inventory[relative] = digest(path.read_bytes())
    for folder in ROOTS:
        target = source/folder
        if target.is_symlink():
            raise ValueError('Release root symlink refused: ' + folder)
        if target.is_dir():
            walk(target)
    missing = REQUIRED - inventory.keys()
    if missing:
        raise ValueError('Missing required release files: ' + ', '.join(sorted(missing)))
    manifest = json.loads((source/'AIOT/embedding-contract.json').read_text(encoding='utf-8'))
    for name in MODELS:
        if inventory[name] != manifest['sha256'][PurePosixPath(name).name]:
            raise ValueError('Model digest mismatch: ' + name)
    for name in inventory:
        if name.endswith('.env.example'):
            for line in (source/name).read_text(encoding='utf-8').splitlines():
                key,separator,value=line.strip().partition('=')
                if separator and key in {'ADMIN_PASSWORD','EDGE_DEVICE_KEY','JWT_SECRET','API_KEY'}:
                    value=value.strip().strip('\"\'')
                    if value and not value.startswith(('change-me','REPLACE_','${')):
                        raise ValueError('Non-placeholder credential in release example: '+name+':'+key)
    validate_runtime_sources(source, inventory)
    return inventory


def verify_release(archive, source=ROOT):
    expected = release_inventory(source)
    actual = {}
    with tarfile.open(archive, 'r:gz') as package:
        for member in package:
            if not member.isfile() or not allowed(member.name) or member.name in actual:
                raise ValueError('Unexpected/unsafe archive member: ' + member.name)
            if member.name not in expected:
                raise ValueError('Unexpected archive file: ' + member.name)
            # Bound reads before decompressing file contents.
            if member.size != (Path(source)/member.name).stat().st_size:
                raise ValueError('File size mismatch: ' + member.name)
            with package.extractfile(member) as stream:
                actual[member.name] = digest(stream.read())
    missing = expected.keys() - actual.keys()
    if missing:
        raise ValueError('Missing release files: ' + ', '.join(sorted(missing)))
    changed = [name for name in actual if actual[name] != expected[name]]
    if changed:
        raise ValueError('Release digest mismatch: ' + ', '.join(changed))
    return {'status': 'PASS', 'files': len(actual), 'manifest': 'AIOT/embedding-contract.json',
            'hardware_verified': False}


def build_release(destination, source=ROOT):
    source = Path(source).resolve()
    files = release_inventory(source)
    # Exclusive creation preserves any existing archive. No network or extraction.
    with Path(destination).open('xb') as output:
        with tarfile.open(fileobj=output, mode='w:gz') as package:
            for name in sorted(files):
                package.add(source/name, arcname=name, recursive=False)
    return verify_release(destination, source)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('inventory', 'build', 'verify', 'git-readiness'))
    parser.add_argument('archive', nargs='?', type=Path)
    args = parser.parse_args()
    if args.command in ('build', 'verify') and args.archive is None:
        parser.error('build/verify require an archive path')
    if args.command == 'git-readiness':
        result = git_readiness()
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 1 if result['status'] != 'PASS' else 0
    result = release_inventory() if args.command == 'inventory' else (
        build_release(args.archive) if args.command == 'build' else verify_release(args.archive))
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
