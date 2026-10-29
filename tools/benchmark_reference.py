"""Synthetic CPU ONNX smoke/latency only; no faces, accuracy or hardware claims."""
import argparse
import hashlib
import json
from pathlib import Path
import time
import numpy as np


def benchmark(path, expected_sha256, shape, iterations=5, *, threads=1, warmup=1,
              sample_kind='zero', denormal_as_zero=False, profile_prefix=None):
    if type(iterations) is not int or not 1<=iterations<=100 or len(shape)!=4 or any(type(n) is not int or not 1<=n<=2048 for n in shape) or np.prod(shape)>16_000_000:
        raise ValueError('Invalid bounded benchmark input')
    if type(threads) is not int or not 1<=threads<=32 or type(warmup) is not int or not 0<=warmup<=20 or sample_kind not in ('zero','random'):
        raise ValueError('Invalid benchmark configuration')
    path=Path(path)
    data=path.read_bytes();digest=hashlib.sha256(data).hexdigest()
    if digest!=expected_sha256:raise ValueError('Artifact checksum mismatch')
    import onnx
    import onnxruntime as ort
    graph=onnx.load_model_from_string(data)
    if any(t.external_data for t in graph.graph.initializer):raise ValueError('External model data requires a separate audit')
    onnx.checker.check_model(graph)
    options=ort.SessionOptions();options.intra_op_num_threads=threads;options.inter_op_num_threads=1
    options.add_session_config_entry('session.set_denormal_as_zero',str(int(denormal_as_zero)))
    if profile_prefix:
        options.enable_profiling=True;options.profile_file_prefix=str(profile_prefix)
    session=ort.InferenceSession(data,sess_options=options,providers=['CPUExecutionProvider'])
    inputs=session.get_inputs()
    if len(inputs)!=1 or inputs[0].type!='tensor(float)':raise ValueError('Expected a single float input')
    if len(inputs[0].shape)!=len(shape) or any(isinstance(a,int) and a!=b for a,b in zip(inputs[0].shape,shape)):
        raise ValueError('Explicit shape does not match graph')
    sample=(np.zeros(shape,dtype=np.float32) if sample_kind=='zero' else
            np.random.default_rng(42).uniform(-1,1,shape).astype(np.float32))
    latency=[];outputs=None;warmup_latency=[]
    for index in range(iterations+warmup):
        start=time.perf_counter();outputs=session.run(None,{inputs[0].name:sample});elapsed=(time.perf_counter()-start)*1000
        if not all(np.isfinite(output).all() for output in outputs):raise ValueError('Nonfinite model output')
        (warmup_latency if index<warmup else latency).append(elapsed)
    result=dict(status='PASS_SYNTHETIC_RUNTIME_ONLY',sha256=digest,input_shape=shape,
                outputs=[dict(name=metadata.name,shape=list(output.shape)) for metadata,output in zip(session.get_outputs(),outputs)],
                iterations=iterations,cpu_threads=threads,warmup_ms=warmup_latency,sample_kind=sample_kind,
                denormal_as_zero=denormal_as_zero,ort_version=ort.__version__,latency_ms=latency,
                p50_ms=float(np.percentile(latency,50)),p95_ms=float(np.percentile(latency,95)),
                accuracy='UNVERIFIED',provenance='UNVERIFIED',hardware_verified=False)
    if profile_prefix:
        from collections import Counter
        profile=session.end_profiling();events=json.loads(Path(profile).read_text())
        operators=Counter();nodes=Counter()
        for event in events:
            if event.get('cat')=='Node':
                operators[event.get('args',{}).get('op_name','?')]+=event.get('dur',0)
                nodes[event['name']]+=event.get('dur',0)
        result.update(profile=profile,operator_us=dict(operators),top_nodes_us=nodes.most_common(5))
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('model',type=Path);parser.add_argument('--sha256',required=True)
    parser.add_argument('--shape',required=True,help='Explicit N,C,H,W; no spatial dimensions guessed')
    parser.add_argument('--iterations',type=int,default=5)
    parser.add_argument('--threads',type=int,default=1)
    parser.add_argument('--warmup',type=int,default=1)
    parser.add_argument('--sample-kind',choices=['zero','random'],default='zero')
    parser.add_argument('--denormal-as-zero',action='store_true',help='Use a FRESH process for each setting; ORT main-thread FP mode is sticky')
    parser.add_argument('--profile-prefix',type=Path)
    args=parser.parse_args()
    print(json.dumps(benchmark(args.model,args.sha256,[int(value) for value in args.shape.split(',')],args.iterations,
                              threads=args.threads,warmup=args.warmup,sample_kind=args.sample_kind,
                              denormal_as_zero=args.denormal_as_zero,profile_prefix=args.profile_prefix),indent=2))


if __name__=='__main__':main()
