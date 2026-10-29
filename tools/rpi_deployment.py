"""Deployment diagnostics; imports hardware/ML libraries only when requested.

This is tooling, not a Hailo adapter or an attendance application.
"""
import argparse
from contextlib import closing
import hashlib
import importlib
import json
import math
import os
from pathlib import Path
import platform
import shutil
import sqlite3
import subprocess
import sys
import time
import uuid


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def backup_database(source, destination, timeout_seconds=30):
    if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
        raise ValueError("Backup timeout must be finite and positive")
    deadline = time.monotonic() + timeout_seconds

    def progress(_status, _remaining, _total):
        if time.monotonic() >= deadline:
            raise TimeoutError("SQLite backup exceeded its time budget; partial output removed")

    source, destination = Path(source).resolve(), Path(destination).absolute()
    if not source.is_file():
        raise FileNotFoundError(source)
    if source == destination.resolve():
        raise ValueError("Backup must not overwrite source")
    for suffix in ('-wal', '-shm', '-journal'):
        sidecar = Path(str(destination) + suffix)
        if os.path.lexists(sidecar):
            raise FileExistsError(f"Refusing destination with SQLite sidecar: {sidecar}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation: never overwrite an earlier backup, including symlinks.
    descriptor = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    try:
        with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True, timeout=min(1, timeout_seconds))) as src:
            with closing(sqlite3.connect(destination)) as dst:
                src.backup(dst, pages=128, sleep=0.1, progress=progress)
                dst.set_progress_handler(lambda: int(time.monotonic() >= deadline), 1000)
                result = dst.execute("PRAGMA integrity_check").fetchone()[0]
                if result != "ok":
                    raise RuntimeError(result)
    except Exception:
        destination.unlink(missing_ok=True)  # Only the new file created above.
        raise
    return {"path": str(destination), "integrity_check": "ok", "sha256": sha256(destination)}


def restore_database(source, destination, timeout_seconds=30):
    """Validate/copy a snapshot into a NEW file; never replace or switch a live DB."""
    return {**backup_database(source, destination, timeout_seconds), "operation": "restore-to-new-file"}


def snapshot_database(source, directory):
    """Opt-in managed backup directory; no retention deletion is automatic."""
    directory=Path(directory).absolute()
    if directory.is_symlink():raise ValueError('Snapshot directory symlink refused')
    directory.mkdir(parents=True,exist_ok=True)
    name=uuid.uuid4().hex+'.sqlite'
    result=backup_database(source,directory/name)
    manifest=directory/(name+'.aiot-backup.json')
    with manifest.open('x',encoding='utf-8') as stream:
        json.dump(dict(schema=1,file=name,sha256=result['sha256'],created_at=time.time()),stream)
        stream.flush();os.fsync(stream.fileno())
    return result


def retain_snapshots(directory, keep=7, apply=False):
    """Only UUID snapshots with valid tool manifests; dry-run unless explicit apply."""
    directory=Path(directory).absolute()
    if directory.is_symlink() or not directory.is_dir():raise ValueError('Expected a real backup directory')
    if type(keep) is not int or keep<1:raise ValueError('Retain at least one snapshot')
    verified=[];skipped=[]
    for manifest in directory.glob('*.sqlite.aiot-backup.json'):
        try:
            if manifest.is_symlink():raise ValueError('Manifest symlink')
            item=json.loads(manifest.read_text(encoding='utf-8'))
            name=item['file']
            if not isinstance(name,str):raise ValueError('Invalid snapshot filename')
            stem=name.removesuffix('.sqlite')
            if item.get('schema')!=1 or len(stem)!=32 or any(c not in '0123456789abcdef' for c in stem) or name!=stem+'.sqlite':raise ValueError('Not a tool snapshot')
            target=directory/name
            if manifest.name!=name+'.aiot-backup.json' or target.is_symlink() or not target.is_file():raise ValueError('Snapshot binding mismatch')
            stamp=item['created_at']
            if type(stamp) not in (int,float) or not math.isfinite(stamp) or not 0<=stamp<=time.time():raise ValueError('Invalid timestamp')
            if any(os.path.lexists(str(target)+suffix) for suffix in ('-wal','-shm','-journal')):raise ValueError('Active sidecar')
            if sha256(target)!=item['sha256']:raise ValueError('Changed snapshot')
            verified.append((stamp,target,manifest,item['sha256']))
        except (OSError,ValueError,KeyError,TypeError):skipped.append(manifest.name)
    selected=sorted(verified,key=lambda row:(row[0],row[1].name),reverse=True)[keep:]
    if apply:
        for _,target,manifest,digest in selected:
            if target.is_symlink() or sha256(target)!=digest:raise ValueError('Snapshot changed after review')
            target.unlink();manifest.unlink()  # Exact manifest-bound files only, never recursive.
    return dict(status='APPLIED' if apply else 'DRY_RUN',selected=[row[1].name for row in selected],skipped=skipped,keep=keep)


def outbox_admin(path, requeue=None):
    path=Path(path).resolve()
    if not path.is_file():raise FileNotFoundError(path)
    with closing(sqlite3.connect(path.as_uri()+'?mode=ro',uri=True)) as db:
        if db.execute('PRAGMA user_version').fetchone()[0]!=2:raise ValueError('Expected outbox schema v2')
        counts=dict(db.execute('SELECT status,count(*) FROM events GROUP BY status'))
    if requeue:
        if str(uuid.UUID(requeue))!=requeue:raise ValueError('Expected canonical event UUID')
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'AIOT/edge'))
        from outbox import DurableOutbox
        changed=DurableOutbox(path).requeue_blocked(requeue)
        return dict(status='REQUEUED' if changed else 'NOT_BLOCKED',event_id=requeue)
    return dict(status='READ_ONLY',counts=counts)


def run_command(argv):
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=15)
        return {"exit_code": result.returncode, "output": (result.stdout + result.stderr).strip()}
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"unavailable": str(exc)}


def preflight(software_only=False):
    result = {"machine": platform.machine(), "python": platform.python_version(),
              "system": platform.system(), "storage": shutil.disk_usage(str(Path.cwd()))._asdict()}
    if platform.system() == "Linux" and not software_only:
        try:
            result["os_release"] = Path("/etc/os-release").read_text()
        except OSError as exc:
            result["os_release"] = {"unavailable": str(exc)}
        for label, argv in {"ip": ["ip", "-br", "address"],
                            "ssh": ["systemctl", "is-active", "ssh"],
                            "temperature": ["vcgencmd", "measure_temp"],
                            "throttled": ["vcgencmd", "get_throttled"],
                            "hailo": ["hailortcli", "fw-control", "identify"]}.items():
            result[label] = run_command(argv)
    return result


def camera_smoke(seconds, output):
    import cv2
    from picamera2 import Picamera2
    from libcamera import controls
    camera = Picamera2()
    try:
        camera.configure(camera.create_video_configuration(
            main={"size": (1280, 720), "format": "RGB888"},
            controls={"FrameRate": 30.0, "AfMode": controls.AfModeEnum.Continuous}))
        camera.start()
        time.sleep(2)
        start, count = time.monotonic(), 0
        frame, metadata = None, {}
        while time.monotonic() - start < seconds:
            request = camera.capture_request()
            try:
                frame = request.make_array("main").copy()
                metadata = request.get_metadata()
            finally:
                request.release()
            count += 1
        # Picamera2 RGB888 memory ordering matches OpenCV's BGR convention.
        if frame is None or not cv2.imwrite(str(output), frame):
            raise RuntimeError("Cannot save camera frame")
        return {"frames": count, "capture_fps": count / (time.monotonic() - start),
                "shape": list(frame.shape), "metadata": metadata, "image": str(output)}
    finally:
        camera.stop()
        camera.close()


def inspect_onnx(path, expected_dim=None):
    import onnx
    import numpy as np
    import onnxruntime as ort
    graph = onnx.load(str(path))
    onnx.checker.check_model(graph)
    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    inputs = [{"name": x.name, "shape": x.shape, "type": x.type} for x in session.get_inputs()]
    result = {"path": str(path), "sha256": sha256(path), "checker": "ok",
              "opsets": [{"domain": x.domain, "version": x.version} for x in graph.opset_import],
              "inputs": inputs, "outputs": [{"name": x.name, "shape": x.shape, "type": x.type}
                                             for x in session.get_outputs()]}
    # A symbolic batch axis is common in the repository's MobileFaceNet.
    # Resolve ONLY that axis to batch=1; do not invent dynamic spatial sizes.
    shape = list(inputs[0]["shape"]) if len(inputs) == 1 else []
    if shape and not isinstance(shape[0], int):
        shape[0] = 1
    if shape and all(isinstance(x, int) and x > 0 for x in shape):
        if inputs[0]["type"] != "tensor(float)":
            raise ValueError("Smoke inference supports float input only")
        sample = np.random.default_rng(0).uniform(-1, 1, shape).astype(np.float32)
        result["synthetic_input_shape"] = shape
        start = time.perf_counter()
        outputs = session.run(None, {inputs[0]["name"]: sample})
        result["synthetic_inference_ms"] = (time.perf_counter() - start) * 1000
        result["actual_output_shapes"] = [list(x.shape) for x in outputs]
        if not all(np.isfinite(x).all() for x in outputs):
            raise ValueError("Non-finite output")
        if expected_dim is not None and (len(outputs) != 1 or outputs[0].shape != (1, expected_dim)):
            raise ValueError(f"Expected output (1,{expected_dim}), got {result['actual_output_shapes']}")
    elif expected_dim is not None:
        raise ValueError("Recognizer must have fixed, single input before this smoke test")
    return result


def export_model(args):
    import numpy as np
    import torch
    import onnxruntime as ort
    module_name, name = args.factory.split(":", 1)
    factory = getattr(importlib.import_module(module_name), name)
    model = factory(**json.loads(args.factory_kwargs))
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    state = checkpoint[args.state_key] if args.state_key else checkpoint
    model.load_state_dict(state, strict=True)
    model.cpu().eval()
    sample = np.load(args.sample, allow_pickle=False).astype(np.float32)
    if sample.shape != (1, 3, 112, 112):
        raise ValueError("Sample must be preprocessed float32 NCHW (1,3,112,112)")
    if Path(args.output).exists():
        raise FileExistsError(args.output)
    tensor = torch.from_numpy(sample)
    with torch.no_grad():
        reference = model(tensor).numpy()
    if reference.shape != (1, 512):
        raise ValueError(f"Factory must return inference backbone with (1,512), got {reference.shape}")
    torch.onnx.export(model, tensor, args.output, input_names=["input"], output_names=["embedding"],
                      opset_version=13, dynamo=False)
    result = inspect_onnx(args.output, 512)
    session = ort.InferenceSession(args.output, providers=["CPUExecutionProvider"])
    actual = session.run(None, {"input": sample})[0]
    error = float(np.max(np.abs(reference - actual)))
    denominator = np.linalg.norm(reference) * np.linalg.norm(actual)
    cosine = float(np.sum(reference * actual) / denominator) if denominator else 0.0
    result.update({"max_absolute_error": error, "cosine_pytorch_onnx": cosine,
                   "reference_sha256": sha256(args.sample)})
    np.testing.assert_allclose(actual, reference, rtol=1e-3, atol=1e-4)
    if not np.isfinite(cosine) or cosine < 0.999:
        raise ValueError(f"Export mismatch: cosine={cosine}")
    return result


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    preflight_parser = sub.add_parser("preflight")
    preflight_parser.add_argument("--software-only", action="store_true", help="Skip OS/hardware commands")
    for name in ('backup', 'restore'):
        snapshot = sub.add_parser(name, help="Copy SQLite into a new file; never overwrite")
        snapshot.add_argument("source")
        snapshot.add_argument("destination")
        snapshot.add_argument("--timeout-seconds", type=float, default=30)
    snapshot_parser=sub.add_parser('snapshot')
    snapshot_parser.add_argument('source');snapshot_parser.add_argument('directory')
    retention=sub.add_parser('retain')
    retention.add_argument('directory');retention.add_argument('--keep',type=int,default=7);retention.add_argument('--apply',action='store_true')
    outbox_parser=sub.add_parser('outbox')
    outbox_parser.add_argument('path');outbox_parser.add_argument('--requeue')
    camera = sub.add_parser("camera")
    camera.add_argument("--seconds", type=float, default=10)
    camera.add_argument("--output", type=Path, default=Path("camera-smoke.jpg"))
    model = sub.add_parser("onnx")
    model.add_argument("path", type=Path)
    model.add_argument("--expected-dim", type=int)
    export = sub.add_parser("export")
    export.add_argument("--factory", required=True, help="Actual training module:function, not an arbitrary R50")
    export.add_argument("--factory-kwargs", default="{}")
    export.add_argument("--checkpoint", required=True)
    export.add_argument("--state-key", default="")
    export.add_argument("--sample", required=True)
    export.add_argument("--output", required=True)
    args = parser.parse_args()
    if args.command == "preflight":
        result = preflight(software_only=args.software_only)
    elif args.command in ("backup", "restore"):
        operation = backup_database if args.command == "backup" else restore_database
        try:
            result = operation(args.source, args.destination, args.timeout_seconds)
        except (OSError, ValueError, sqlite3.Error) as exc:
            print(json.dumps({"status": "error", "operation": args.command,
                              "error": type(exc).__name__, "message": str(exc)}), file=sys.stderr)
            raise SystemExit(1) from None
    elif args.command == "camera":
        if args.seconds <= 0:
            parser.error("--seconds must be positive")
        result = camera_smoke(args.seconds, args.output)
    elif args.command in ('snapshot','retain','outbox'):
        try:
            result=(snapshot_database(args.source,args.directory) if args.command=='snapshot' else
                    retain_snapshots(args.directory,args.keep,args.apply) if args.command=='retain' else outbox_admin(args.path,args.requeue))
        except (OSError,ValueError,sqlite3.Error) as exc:
            print(json.dumps(dict(status='error',error=type(exc).__name__,message=str(exc))),file=sys.stderr)
            raise SystemExit(1) from None
    elif args.command == "onnx":
        result = inspect_onnx(args.path, args.expected_dim)
    else:
        result = export_model(args)
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
