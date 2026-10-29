"""Bounded, opt-in media validation. No enrollment writes, recording or attendance.

A subprocess owns both media and inference: a stalled native call cannot trap the
CLI forever. Forced termination is not hardware cleanup/driver certification.
"""
import argparse
import json
import math
import multiprocessing as mp
from pathlib import Path
import queue
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'AIOT/edge'))


def validate_options(options):
    if not options.get('experimental'):
        raise ValueError('Explicit --experimental required')
    kind = options.get('kind')
    if kind not in ('camera', 'video', 'image'):
        raise ValueError('Select exactly one explicit input source')
    if kind == 'camera':
        if options.get('allow_camera') is not True or options.get('allow_test_media') is not True:
            raise ValueError('Camera needs BOTH --allow-camera and --allow-test-media; never auto-open')
        if type(options.get('source')) is not int or not 0 <= options['source'] <= 15:
            raise ValueError('Explicit camera index 0..15 required')
    else:
        if options.get('allow_test_media') is not True:
            raise ValueError('Explicit permission to process test media required')
        if not Path(options['source']).is_file():
            raise ValueError('Local test media file required; network streams unsupported')
    for key, low, high in (('seconds', 1, 3600), ('threshold', -1, 1), ('margin', 0, 2)):
        value = options.get(key)
        if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError('Explicit bounded test setting required: '+key)
    if type(options.get('frames')) is not int or not 1 <= options['frames'] <= 100000:
        raise ValueError('Frame bound must be 1..100000')
    if type(options.get('threads')) is not int or not 1 <= options['threads'] <= 16:
        raise ValueError('CPU threads must be 1..16')
    return options


def process_frame(pipeline, image, gallery, *, threshold, margin):
    """Exactly one detection/inference per image; full gallery contract validated."""
    import numpy as np
    from pipeline import align_five_points, normalize
    entries = pipeline._gallery_entries(gallery)
    started = time.perf_counter()
    faces = pipeline.detector.detect(image)
    detected = time.perf_counter()
    result = dict(state='NO_FACE' if not faces else 'MULTIPLE_FACES', faces=len(faces),
                  detector_ms=(detected-started)*1000, alignment_ms=0., recognition_ms=0., matching_ms=0.)
    if len(faces) == 1:
        crop = align_five_points(image, faces[0].landmarks_5)
        aligned = time.perf_counter()
        vector = normalize(pipeline.recognizer.get_embedding(crop))
        embedded = time.perf_counter()
        scores = sorted((float(np.clip(normalize(x['embedding']) @ vector, -1, 1)) for x in entries), reverse=True)
        accepted = bool(scores and scores[0] >= threshold and (len(scores)==1 or scores[0]-scores[1] >= margin))
        result.update(state='MATCH' if accepted else 'UNKNOWN',alignment_ms=(aligned-detected)*1000,
                      recognition_ms=(embedded-aligned)*1000,matching_ms=(time.perf_counter()-embedded)*1000)
    result['total_ms'] = (time.perf_counter()-started)*1000
    # No image, crop, embedding, identity or match score in diagnostics.
    return result


def _emit(channel, value):
    if value['type'] not in ('done','error'):
        try:channel.put(value, block=False)
        except queue.Full:pass
        return
    # Diagnostics may be dropped under backpressure; a terminal result must not
    # be silently lost behind old progress samples. All attempts remain bounded.
    for _ in range(3):
        try:channel.put(value,timeout=.1);return
        except queue.Full:
            try:channel.get_nowait()
            except queue.Empty:pass


def media_worker(options, channel):
    import cv2
    from cpu_onnx import load_descriptor
    capture = None
    try:
        validate_options(options)  # Also checked before spawning, before any device access.
        cv2.setNumThreads(1)
        pipeline = load_descriptor(options['descriptor'],experimental=True,threads=options['threads'])
        if options.get('gallery'):
            path=Path(options['gallery'])
            if path.stat().st_size>64*1024*1024:raise ValueError('Test gallery too large')
            gallery=json.loads(path.read_text(encoding='utf-8'))
        else:gallery=dict(contract=pipeline.contract,entries=[])
        pipeline._gallery_entries(gallery)  # Fail mismatch BEFORE opening camera/video.
        if options['kind']!='image':
            capture=cv2.VideoCapture(options['source'])
            if not capture.isOpened():raise OSError('Media unavailable')
        started=time.monotonic();count=0
        while count<options['frames']:
            if options['kind']=='image':
                image=cv2.imread(str(options['source']),cv2.IMREAD_COLOR);ok=image is not None
            else:ok,image=capture.read()
            if not ok:
                if options['kind']=='video' and count:
                    _emit(channel,dict(type='done',reason='VIDEO_READ_ENDED',frames=count));return
                raise OSError('No camera/image frame')
            from experimental_cpu import frame
            result=process_frame(pipeline,frame(image),gallery,threshold=options['threshold'],margin=options['margin'])
            count+=1
            _emit(channel,dict(type='progress',frame=count,fps=count/max(time.monotonic()-started,1e-9),
                               contract_id=pipeline.contract['contract_id'],**result))
            if options['kind']=='image':break
        _emit(channel,dict(type='done',reason='FRAME_LIMIT',frames=count))
    except Exception as error:
        _emit(channel,dict(type='error',error=type(error).__name__,state='INPUT_OR_MODEL_ERROR'))
    finally:
        if capture is not None:capture.release()


def supervise(options, *, target=media_worker, emit=None):
    validate_options(options)
    emit=emit or (lambda value:print(json.dumps(value,allow_nan=False),flush=True))
    context=mp.get_context('spawn');channel=context.Queue(maxsize=16)
    child=context.Process(target=target,args=(options,channel));started=False;terminal=None
    try:
        child.start();started=True;deadline=time.monotonic()+options['seconds']
        while time.monotonic()<deadline:
            try:message=channel.get(timeout=min(.1,max(.001,deadline-time.monotonic())))
            except queue.Empty:
                if not child.is_alive():break
                continue
            emit(message)
            if message['type'] in ('done','error'):terminal=message;break
        if terminal is None:
            terminal=dict(type='error',state='DEADLINE_EXCEEDED' if child.is_alive() else 'CHILD_EXIT_WITHOUT_RESULT')
            emit(terminal)
        return 0 if terminal['type']=='done' else 2
    finally:
        if started:
            child.join(.5)
            if child.is_alive():child.terminate();child.join(2)
            if child.is_alive():child.kill();child.join(2)
            if child.is_alive():raise RuntimeError('Owned validation child did not stop')
            child.close()
        channel.close();channel.join_thread()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--descriptor',type=Path,required=True)
    source=parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--camera',type=int);source.add_argument('--video',type=Path);source.add_argument('--image',type=Path)
    parser.add_argument('--allow-camera',action='store_true');parser.add_argument('--allow-test-media',action='store_true')
    parser.add_argument('--experimental',action='store_true');parser.add_argument('--gallery',type=Path)
    parser.add_argument('--threshold',type=float,required=True);parser.add_argument('--margin',type=float,required=True)
    parser.add_argument('--max-seconds',type=float,default=60);parser.add_argument('--max-frames',type=int,default=300)
    parser.add_argument('--threads',type=int,default=4)
    args=parser.parse_args();kind='camera' if args.camera is not None else 'video' if args.video else 'image'
    options=dict(kind=kind,source=args.camera if kind=='camera' else str((args.video or args.image).resolve()),
                 descriptor=str(args.descriptor.resolve()),gallery=str(args.gallery.resolve()) if args.gallery else None,
                 experimental=args.experimental,allow_camera=args.allow_camera,allow_test_media=args.allow_test_media,
                 threshold=args.threshold,margin=args.margin,seconds=args.max_seconds,frames=args.max_frames,threads=args.threads)
    try:return supervise(options)
    except KeyboardInterrupt:
        print(json.dumps(dict(state='STOPPED_BY_OPERATOR')));return 130
    except (ValueError,OSError) as error:
        print(json.dumps(dict(state='PREFLIGHT_REJECTED',error=type(error).__name__)));return 2


if __name__=='__main__':sys.exit(main())
