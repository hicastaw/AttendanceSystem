"""Descriptor-bound real ONNX synthetic check and bounded CPU stage benchmark.

No image files, camera, backend or database. Positive path injects landmarks;
only the blank negative path runs the real SCRFD detector. No accuracy claim.
Use a fresh process per numeric mode; the descriptor alone selects FTZ.
"""
import argparse
import json
from pathlib import Path
import platform
import sys
import time

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'AIOT/edge'), str(ROOT / 'tools')]
from cpu_onnx import load_descriptor
from model_cpu_lab import synthetic


def bounded(value, low, high, name):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f'{name} must be {low}..{high}')


def check(descriptor, *, experimental=False, threads=4, iterations=5, warmup=1):
    bounded(threads, 1, 16, 'threads')
    bounded(iterations, 1, 100, 'iterations')
    bounded(warmup, 0, 20, 'warmup')
    import cv2
    import onnxruntime as ort
    cv2.setNumThreads(1)
    pipeline = load_descriptor(descriptor, experimental=experimental, threads=threads)
    result = synthetic(pipeline)
    image = np.random.default_rng(42).integers(0, 256, (112, 112, 3), dtype=np.uint8)
    latency = {'real_scrfd_blank_ms': [], 'real_r50_synthetic_crop_ms': []}
    for index in range(warmup + iterations):
        started = time.perf_counter()
        detections = pipeline.detector.detect(np.zeros((480, 640, 3), np.uint8))
        detector_ms = (time.perf_counter() - started) * 1000
        if detections:
            raise ValueError('Blank synthetic negative unexpectedly detected a face')
        started = time.perf_counter()
        vector = pipeline.recognizer.get_embedding(image)
        recognizer_ms = (time.perf_counter() - started) * 1000
        if vector.shape != (512,) or not np.isfinite(vector).all() or not np.isclose(np.linalg.norm(vector), 1):
            raise ValueError('Invalid normalized R50 synthetic output')
        if index >= warmup:
            latency['real_scrfd_blank_ms'].append(detector_ms)
            latency['real_r50_synthetic_crop_ms'].append(recognizer_ms)
    result.update(machine=platform.machine(), system=platform.system(), python=platform.python_version(),
                  numpy=np.__version__, opencv=cv2.__version__, onnxruntime=ort.__version__,
                  cpu_threads=threads, warmup=warmup, iterations=iterations,
                  providers={role: getattr(pipeline, role).session.get_providers()
                             for role in ('detector', 'recognizer')},
                  measurements={key: dict(samples_ms=values, p50_ms=float(np.percentile(values, 50)),
                                          p95_ms=float(np.percentile(values, 95)))
                                for key, values in latency.items()},
                  positive_detector='NOT_TESTED_LANDMARKS_INJECTED', attendance_e2e='NOT_TESTED',
                  production_activated=False, camera_opened=False)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('descriptor', type=Path)
    parser.add_argument('--experimental', action='store_true', required=True)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--iterations', type=int, default=5)
    parser.add_argument('--warmup', type=int, default=1)
    args = parser.parse_args()
    print(json.dumps(check(args.descriptor, experimental=args.experimental, threads=args.threads,
                           iterations=args.iterations, warmup=args.warmup), indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
