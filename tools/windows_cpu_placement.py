"""Best-effort CPU placement for the named disposable Windows R50 laptop worker.

No imports from production config and no system-wide or parent-process changes.
The actual Python worker calls this before constructing ONNX thread pools.
"""
import ctypes
from ctypes import wintypes
import os
import platform
import struct


def parse_cpu_sets(data):
    rows, offset = [], 0
    while offset < len(data):
        if len(data) - offset < 8:
            raise ValueError('Truncated CPU-set header')
        size, kind = struct.unpack_from('<II', data, offset)
        if size < 8 or offset + size > len(data):
            raise ValueError('Invalid CPU-set record size')
        if kind == 0:
            if size < 32:
                raise ValueError('Truncated CPU-set record')
            rows.append(dict(group=struct.unpack_from('<H', data, offset + 12)[0],
                             logical=data[offset + 14], core=data[offset + 15],
                             efficiency=data[offset + 18], flags=data[offset + 19]))
        offset += size
    if not rows:
        raise ValueError('CPU-set topology unavailable')
    return rows


def select_performance_cpus(rows, allowed_mask):
    """Select one allowed hardware thread per fastest physical core, never expand."""
    if not rows or allowed_mask <= 0 or any(row['group'] != 0 for row in rows):
        raise ValueError('Unsupported CPU topology')
    classes = {row['efficiency'] for row in rows}
    if len(classes) < 2:
        return []  # Homogeneous CPUs keep their existing scheduler policy.
    fastest = max(classes)
    selected = {}
    for row in sorted(rows, key=lambda item: (item['flags'] & 1, item['logical'])):
        logical = row['logical']
        if logical >= ctypes.sizeof(ctypes.c_size_t) * 8:
            raise ValueError('CPU index exceeds process affinity width')
        # CPU-set flags: Allocated without AllocatedToTargetProcess means reserved elsewhere.
        reserved = row['flags'] & 2 and not row['flags'] & 4
        if row['efficiency'] == fastest and allowed_mask & (1 << logical) and not reserved:
            selected.setdefault(row['core'], logical)
    return sorted(selected.values())


class WindowsCpuApi:
    def __init__(self):
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        k = self.kernel
        k.GetCurrentProcess.restype = wintypes.HANDLE
        k.GetActiveProcessorGroupCount.restype = wintypes.WORD
        k.GetSystemCpuSetInformation.argtypes = [ctypes.c_void_p, wintypes.ULONG,
                                                ctypes.POINTER(wintypes.ULONG), wintypes.HANDLE, wintypes.ULONG]
        k.GetProcessAffinityMask.argtypes = [wintypes.HANDLE, ctypes.POINTER(ctypes.c_size_t),
                                            ctypes.POINTER(ctypes.c_size_t)]
        k.SetProcessAffinityMask.argtypes = [wintypes.HANDLE, ctypes.c_size_t]
        self.process = k.GetCurrentProcess()

    def cpu_sets(self):
        if self.kernel.GetActiveProcessorGroupCount() != 1:
            raise ValueError('Multiple processor groups require a different policy')
        length = wintypes.ULONG()
        self.kernel.GetSystemCpuSetInformation(None, 0, ctypes.byref(length), self.process, 0)
        if not 32 <= length.value <= 1024 * 1024:
            raise OSError('CPU-set buffer unavailable')
        buffer = ctypes.create_string_buffer(length.value)
        if not self.kernel.GetSystemCpuSetInformation(buffer, len(buffer), ctypes.byref(length), self.process, 0):
            raise ctypes.WinError(ctypes.get_last_error())
        return parse_cpu_sets(buffer.raw[:length.value])

    def affinity(self):
        process, system = ctypes.c_size_t(), ctypes.c_size_t()
        if not self.kernel.GetProcessAffinityMask(self.process, ctypes.byref(process), ctypes.byref(system)):
            raise ctypes.WinError(ctypes.get_last_error())
        return process.value

    def set_affinity(self, mask):
        if not self.kernel.SetProcessAffinityMask(self.process, mask):
            raise ctypes.WinError(ctypes.get_last_error())


def place_isolated_worker(purpose, *, system=None, api_factory=None):
    result = dict(process_id=os.getpid())
    if purpose != 'isolated-r50-laptop-test' or (system or platform.system()) != 'Windows':
        return dict(result, status='not_applicable')
    try:
        api = (api_factory or WindowsCpuApi)()
        rows, original = api.cpu_sets(), api.affinity()
        cpus = select_performance_cpus(rows, original)
    except (OSError, ValueError, AttributeError):
        return dict(result, status='fallback', reason='topology_unavailable_or_unsupported')
    if not cpus:
        return dict(result, status='unchanged', reason='homogeneous_or_no_performance_cpus_allowed')
    selected = sum(1 << logical for logical in cpus)
    details = dict(result, logical_processors=cpus, core_count=len(cpus))
    if selected == original:
        return dict(details, status='already_applied')
    try:
        api.set_affinity(selected)
    except OSError:
        return dict(result, status='fallback', reason='affinity_unavailable')
    try:
        if api.affinity() != selected:
            raise OSError('CPU placement verification failed')
    except OSError:
        # If verification fails, fallback must restore the previous restriction.
        try:
            api.set_affinity(original)
            if api.affinity() != original:
                raise OSError('CPU placement restore verification failed')
        except OSError as error:
            raise RuntimeError('Cannot restore isolated worker CPU placement') from error
        return dict(result, status='fallback', reason='affinity_verification_failed')
    return dict(details, status='applied')
