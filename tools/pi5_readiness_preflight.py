"""Read-only Pi inventory; stdlib only, no camera, network, DB or NPU access.

JSON goes to stdout. Exit 0 means the platform inventory meets basic checks,
not that model inference, camera capture or production deployment is approved.
"""
import argparse
from datetime import datetime, timezone
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import platform
import shutil
import struct
import subprocess
import sys


def read_text(path):
    try:
        return Path(path).read_text(encoding='utf-8').strip()
    except OSError:
        return None


def memory_kib(text):
    result = {}
    for line in (text or '').splitlines():
        key, _, value = line.partition(':')
        if key in ('MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree'):
            result[key] = int(value.split()[0])
    return result


def platform_blockers(system, machine, bits, model, python):
    blockers = []
    if system != 'Linux':
        blockers.append('LINUX_REQUIRED')
    if machine.lower() not in ('aarch64', 'arm64') or bits != 64:
        blockers.append('ARM64_USERSPACE_REQUIRED')
    if not model or 'Raspberry Pi 5' not in model:
        blockers.append('PI5_BOARD_NOT_VERIFIED')
    if python < (3, 11):
        blockers.append('PYTHON_3_11_OR_NEWER_REQUIRED')
    return blockers


def version(command):
    executable = shutil.which(command)
    if not executable:
        return None
    try:
        child = subprocess.run([executable, '--version'], capture_output=True,
                               text=True, timeout=5, check=False)
        return dict(exit_code=child.returncode, output=(child.stdout + child.stderr).strip()[:500])
    except (OSError, subprocess.TimeoutExpired) as exc:
        return dict(error=type(exc).__name__)


def inventory(disk_path):
    linux = platform.system() == 'Linux'
    model = read_text('/proc/device-tree/model') if linux else None
    model = model.rstrip('\x00') if model else None
    bits = struct.calcsize('P') * 8
    blockers = platform_blockers(platform.system(), platform.machine(), bits, model, sys.version_info[:2])
    disk = shutil.disk_usage(disk_path)
    memory = memory_kib(read_text('/proc/meminfo')) if linux else {}
    warnings = []
    if disk.free < 4 * 1024**3:
        warnings.append('LESS_THAN_4_GIB_DISK_FREE')
    if memory.get('MemAvailable', 2 * 1024**2) < 1024**2:
        warnings.append('LESS_THAN_1_GIB_AVAILABLE_RAM')
    packages = {}
    for name in ('numpy', 'onnxruntime', 'onnx', 'opencv-python', 'opencv-python-headless',
                 'requests', 'Flask', 'Werkzeug', 'picamera2'):
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            packages[name] = None
    if packages['opencv-python'] and packages['opencv-python-headless']:
        warnings.append('MULTIPLE_PIP_OPENCV_DISTRIBUTIONS')
    modules = {name: importlib.util.find_spec(name) is not None
               for name in ('cv2', 'numpy', 'onnxruntime', 'picamera2', 'libcamera')}
    tools = {name: shutil.which(name) is not None
             for name in ('rpicam-hello', 'libcamera-hello', 'v4l2-ctl', 'node', 'npm', 'cc', 'make', 'pkg-config')}
    if not tools['rpicam-hello'] and not tools['libcamera-hello']:
        warnings.append('CAMERA_CLI_NOT_FOUND')
    return dict(schema=1, status='BLOCKED_PLATFORM' if blockers else 'INVENTORY_COMPLETE',
                recorded_at_utc=datetime.now(timezone.utc).isoformat(),
                system=platform.system(), machine=platform.machine(), userspace_bits=bits,
                board_model=model, os_release=read_text('/etc/os-release') if linux else None,
                kernel=platform.release(), libc=platform.libc_ver(), python=platform.python_version(),
                python_executable=sys.executable, in_venv=sys.prefix != sys.base_prefix,
                disk_bytes=dict(total=disk.total, used=disk.used, free=disk.free),
                memory_kib=memory, cpu_count=os.cpu_count(), package_metadata=packages,
                module_discoverable=modules, tools_found=tools, node=version('node'),
                blockers=blockers, warnings=warnings, camera_opened=False,
                inference_executed=False, hardware_verified=False,
                note='Module discovery/metadata does not establish native import or runtime compatibility.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--disk-path', type=Path, default=Path.cwd(), help='Existing directory to inspect')
    args = parser.parse_args()
    result = inventory(args.disk_path)
    print(json.dumps(result, indent=2))
    return 2 if result['blockers'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
