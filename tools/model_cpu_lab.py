"""Isolated CPU research CLI. Synthetic-only audit/benchmark; never starts attendance.

Enrollment/matching is opt-in, restricted to a lab state directory and must use
images the operator is authorized to process. No production gallery migration.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'AIOT/edge'))
from experimental_cpu import ExperimentalPipeline, DETECTOR_SHA, RECOGNIZER_SHA


def audit(path):
    import onnx
    from onnx import numpy_helper
    data=Path(path).read_bytes();model=onnx.load_model_from_string(data)
    if any(t.external_data for t in model.graph.initializer):raise ValueError('External-data models need separate audit')
    onnx.checker.check_model(model)
    arrays=[numpy_helper.to_array(t) for t in model.graph.initializer]
    def io(value):
        tensor=value.type.tensor_type
        return dict(name=value.name,element_type=tensor.elem_type,shape=[d.dim_value or d.dim_param for d in tensor.shape.dim])
    subnormal_tensors=[]
    for tensor,array in zip(model.graph.initializer,arrays):
        if array.dtype==np.float32:
            count=int(((np.abs(array)>0)&(np.abs(array)<np.finfo(np.float32).tiny)).sum())
            if count:subnormal_tensors.append(dict(name=tensor.name,count=count))
    return dict(sha256=hashlib.sha256(data).hexdigest(),bytes=len(data),producer=model.producer_name,
                producer_version=model.producer_version,ir=model.ir_version,
                opsets=[dict(domain=o.domain,version=o.version) for o in model.opset_import],
                metadata={x.key:x.value for x in model.metadata_props},
                inputs=[io(v) for v in model.graph.input],outputs=[io(v) for v in model.graph.output],
                operators=dict(Counter(n.op_type for n in model.graph.node)),parameters=sum(a.size for a in arrays),
                subnormal_initializers=sum(int(((np.abs(a)>0)&(np.abs(a)<np.finfo(np.float32).tiny)).sum()) for a in arrays if a.dtype==np.float32),
                subnormal_tensors=sorted(subnormal_tensors,key=lambda x:-x['count']),
                first_operations=[dict(name=n.name,op=n.op_type) for n in model.graph.node[:8]],
                residual_blocks={f'layer{i}':sum(n.op_type=='Add' and n.name.startswith(f'/layer{i}/') for n in model.graph.node) for i in range(1,5)},
                provenance='UNVERIFIED',license='UNVERIFIED',preprocessing='UNVERIFIED',training_checkpoint='UNVERIFIED')


def lab_path(path):
    path=Path(path).resolve()
    if path.is_relative_to(ROOT) and not path.is_relative_to(ROOT/'.model-validation'):
        raise ValueError('Repository state must stay inside .model-validation, even when a staging repository lives in OS temp')
    if not (path.is_relative_to(ROOT/'.model-validation') or path.is_relative_to(Path(tempfile.gettempdir()).resolve())):
        raise ValueError('Lab state must be inside .model-validation or OS temp, never a production directory')
    if any(p.is_symlink() for p in (path,*path.parents)):raise ValueError('Lab state symlink refused')
    return path


def write_new(path,result):
    path=lab_path(path);path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('x',encoding='utf-8') as stream:json.dump(result,stream,indent=2)


def measure(args):
    """Every FP/thread setting owns a NEW process; timeout kills/reaps that child."""
    directory=lab_path(args.output_dir);directory.mkdir(parents=True,exist_ok=False)
    records=[]
    for threads,flush,kind in [(1,False,'zero'),(1,False,'random'),(1,True,'zero'),(1,True,'random'),(2,True,'random'),(4,True,'random'),(8,True,'random')]:
        key=f't{threads}-ftz{int(flush)}-{kind}'
        command=[sys.executable,'-B',str(ROOT/'tools/benchmark_reference.py'),str(args.models/'vnceleb_ms1mv3_r50_selected.onnx'),
                 '--sha256',RECOGNIZER_SHA,'--shape','1,3,112,112','--iterations',str(args.iterations),'--warmup','2',
                 '--threads',str(threads),'--sample-kind',kind]
        if flush:command.append('--denormal-as-zero')
        if args.profile:command.extend(['--profile-prefix',str(directory/key)])
        try:
            child=subprocess.run(command,capture_output=True,text=True,timeout=args.timeout,check=True)
            record=json.loads(child.stdout)
        except subprocess.TimeoutExpired:record=dict(status='BLOCKED_TIMEOUT',configuration=key)
        except subprocess.CalledProcessError as exc:record=dict(status='FAIL_CHILD',configuration=key,exit_code=exc.returncode)
        write_new(directory/(key+'.json'),record);records.append(record)
        print(json.dumps(dict(configuration=key,status=record['status'],p50_ms=record.get('p50_ms'),p95_ms=record.get('p95_ms'))),flush=True)
    write_new(directory/'summary.json',records)
    blocked=any(record['status']!='PASS_SYNTHETIC_RUNTIME_ONLY' for record in records)
    return dict(status='MEASURED_WITH_BLOCKERS' if blocked else 'MEASURED',exit_code=2 if blocked else 0,
                output_dir=str(directory),configurations=len(records))


def parity_child(args):
    # This command only generates seeded tensors, never reads a user image.
    from experimental_cpu import model_session
    session=model_session(args.models/'vnceleb_ms1mv3_r50_selected.onnx',RECOGNIZER_SHA,args.threads,args.ftz)
    outputs=[]
    for seed in (None,1,2):
        sample=np.zeros((1,3,112,112),np.float32) if seed is None else np.random.default_rng(seed).uniform(-1,1,(1,3,112,112)).astype(np.float32)
        outputs.append(session.run(['embedding'],{'input':sample})[0].tolist())
    return dict(synthetic_only=True,denormal_as_zero=args.ftz,outputs=outputs)


def synthetic(pipeline):
    from pipeline import Detection,TARGET
    image=np.indices((112,112)).sum(axis=0).astype(np.uint8)
    image=np.stack([image,np.flipud(image),255-image],axis=2)
    # Real SCRFD negative path + real R50 on known synthetic geometry. A forced
    # landmark fixture is NOT evidence SCRFD detects faces or identity accuracy.
    negative=pipeline.embed(np.zeros((480,640,3),np.uint8))
    real_detector=pipeline.detector
    class GeometryFixture:
        def detect(self,frame):return [Detection((0,0,112,112),TARGET.copy(),1.)]
    try:
        pipeline.detector=GeometryFixture()
        gallery=pipeline.enroll([image.copy() for _ in range(3)],'SYNTHETIC_ONLY')
        result=pipeline.match(image,gallery,threshold=.999,minimum_margin=.01)
        if result['state']!='MATCH' or negative is not None:raise ValueError('Synthetic runtime E2E failed')
    finally:pipeline.detector=real_detector
    return dict(status='PASS_SYNTHETIC_RUNTIME_ONLY',real_scrfd_blank='NO_FACE',r50_geometry_fixture=result,
                diagnostics=pipeline.diagnostics(),contract=pipeline.contract,recognition_accuracy='UNVERIFIED')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models',type=Path,default=ROOT/'AIOT/edge/model')
    sub=parser.add_subparsers(dest='command',required=True)
    audit_parser=sub.add_parser('audit');audit_parser.add_argument('--output',type=Path)
    bench=sub.add_parser('measure');bench.add_argument('--output-dir',type=Path,required=True)
    bench.add_argument('--iterations',type=int,default=5);bench.add_argument('--timeout',type=int,default=180);bench.add_argument('--profile',action='store_true')
    parity=sub.add_parser('parity-child');parity.add_argument('--threads',type=int,default=1);parity.add_argument('--ftz',action='store_true');parity.add_argument('--output',type=Path,required=True)
    for command in ('synthetic','enroll','match'):
        item=sub.add_parser(command);item.add_argument('--experimental',action='store_true',required=True)
        item.add_argument('--threads',type=int,default=4);item.add_argument('--ftz',action='store_true')
        if command!='synthetic':item.add_argument('--image',type=Path,action='append',required=True);item.add_argument('--gallery',type=Path,required=True)
        if command=='enroll':item.add_argument('--code',required=True);item.add_argument('--base-gallery',type=Path)
        if command=='match':item.add_argument('--threshold',type=float,required=True);item.add_argument('--minimum-margin',type=float,required=True)
    args=parser.parse_args()
    if args.command=='audit':
        result={name:audit(args.models/name) for name in ('det_10g.onnx','vnceleb_ms1mv3_r50_selected.onnx')}
        if args.output:write_new(args.output,result)
    elif args.command=='measure':
        if not 1<=args.iterations<=20 or not 10<=args.timeout<=300:parser.error('Bounded iterations 1..20, child timeout 10..300s')
        result=measure(args)
    elif args.command=='parity-child':
        result=parity_child(args);write_new(args.output,result);result=dict(status='SYNTHETIC_OUTPUT_SAVED',path=str(args.output))
    else:
        pipeline=ExperimentalPipeline.load(args.models,experimental=args.experimental,threads=args.threads,denormal_as_zero=args.ftz)
        if args.command=='synthetic':result=synthetic(pipeline)
        else:
            import cv2
            gallery_path=lab_path(args.gallery)
            images=[cv2.imread(str(p)) for p in args.image]
            if any(image is None for image in images):raise ValueError('Cannot read an input image')
            if args.command=='enroll':
                previous=None
                if args.base_gallery:
                    source=lab_path(args.base_gallery)
                    if source.stat().st_size>50_000_000:raise ValueError('Gallery too large')
                    previous=json.loads(source.read_text())
                write_new(gallery_path,pipeline.enroll(images,args.code,gallery=previous));result=dict(status='EXPERIMENTAL_ENROLLED',production_approved=False)
            else:
                if len(images)!=1:raise ValueError('Match accepts one image')
                if gallery_path.stat().st_size>50_000_000:raise ValueError('Gallery too large')
                result=pipeline.match(images[0],json.loads(gallery_path.read_text()),threshold=args.threshold,minimum_margin=args.minimum_margin)
    print(json.dumps(result,indent=2))
    if result.get('exit_code',0):raise SystemExit(result['exit_code'])


if __name__=='__main__':main()
