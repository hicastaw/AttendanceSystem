"""Offline model inspection/preparation. Never deserialize pickle checkpoints.

An ONNX graph/hash proves neither training lineage nor preprocessing/license.
Inspect in a disposable environment if the supplied artifact is untrusted.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'AIOT/edge'))
from cpu_onnx import ALIGNMENT, descriptor_contract, load_descriptor


def inspect_artifact(path):
    path = Path(path)
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    result = dict(sha256=digest, bytes=path.stat().st_size, provenance='UNVERIFIED', license='UNVERIFIED')
    if path.suffix.lower() != '.onnx':
        entries = None
        if zipfile.is_zipfile(path):
            with zipfile.ZipFile(path) as archive:
                entries = len(archive.namelist())
        result.update(status='BLOCKED_EXPORT_FACTORY_REQUIRED', checkpoint_deserialized=False, archive_entries=entries)
        return result
    import onnx
    from collections import Counter
    graph = onnx.load(str(path), load_external_data=False)
    if any(t.data_location == onnx.TensorProto.EXTERNAL for t in graph.graph.initializer):
        raise ValueError('External-data ONNX requires an explicitly hashed bundle; not supported')
    onnx.checker.check_model(graph)
    def info(value):
        tensor = value.type.tensor_type
        return dict(name=value.name, dtype=onnx.TensorProto.DataType.Name(tensor.elem_type),
                    shape=[d.dim_value if d.HasField('dim_value') else d.dim_param or None for d in tensor.shape.dim])
    result.update(status='GRAPH_VALID_NOT_LINEAGE_VERIFIED', inputs=[info(x) for x in graph.graph.input],
                  outputs=[info(x) for x in graph.graph.output], ops=dict(Counter(n.op_type for n in graph.graph.node)),
                  metadata={x.key: x.value for x in graph.metadata_props}, producer=graph.producer_name,
                  opsets=[dict(domain=x.domain, version=x.version) for x in graph.opset_import])
    return result


def baseline_descriptor(models):
    # Reuse previously verified ONNX metadata, NOT HEF/runtime information.
    from official_hailo_cpu import DETECTOR_SHA, RECOGNIZER_SHA, OUTPUT_NAMES, OUTPUT_SHAPES, REVISION
    models = Path(models).resolve()
    def spec(name, sha, input_name, size, outputs, std):
        return dict(path=str(models / name), sha256=sha, input=input_name, shape=[1, 3, size, size],
                    layout='NCHW', color='RGB', mean=[127.5] * 3, std=[std] * 3, outputs=outputs)
    return dict(schema=1, production_approved=False, model_version='published-onnx-baseline-v1',
                family_assertion='VENDOR_R50_31M_RELU_NOT_VERIFIED_INSIGHTFACE_IRESNET50',
                provenance='PUBLISHED_ARTIFACT_HASH_VERIFIED_revision_' + REVISION,
                training='MS1MV3_VENDOR_DECLARED_NOT_ATTESTED', export='UNVERIFIED_CHECKPOINT_AND_EXPORT_FACTORY',
                license='BLOCKED_VENDOR_MIT_VS_PRETRAINED_RESEARCH_ONLY',
                preprocessing_evidence='PUBLISHED_NORMALIZATION_ALIGNMENT_PARITY_UNVERIFIED',
                alignment_id=ALIGNMENT, ftz=False, detection_threshold=.5, nms_threshold=.4,
                detector=spec('scrfd_10g_bnkps.onnx', DETECTOR_SHA, 'input.1', 640,
                              [dict(name=n, shape=s) for n, s in zip(OUTPUT_NAMES, OUTPUT_SHAPES)], 128.0),
                recognizer=spec('r50.onnx', RECOGNIZER_SHA, 'data', 112, [dict(name='642', shape=[1, 512])], 127.5))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    inspect = commands.add_parser('inspect'); inspect.add_argument('artifact', type=Path)
    baseline = commands.add_parser('baseline-descriptor'); baseline.add_argument('--models', type=Path, required=True)
    baseline.add_argument('--output', type=Path, required=True)
    baseline.add_argument('--ftz', action='store_true', help='Explicit distinct FTZ/DAZ numeric contract; default OFF')
    check = commands.add_parser('check'); check.add_argument('descriptor', type=Path); check.add_argument('--experimental', action='store_true')
    check.add_argument('--threads', type=int, default=4)
    check.add_argument('--smoke', action='store_true', help='Finite output check on zero tensors; NOT accuracy')
    contract = commands.add_parser('contract'); contract.add_argument('descriptor', type=Path)
    args = parser.parse_args()
    if args.command == 'inspect':
        result = inspect_artifact(args.artifact)
    elif args.command == 'baseline-descriptor':
        value = baseline_descriptor(args.models)
        value['ftz'] = args.ftz
        with args.output.open('x', encoding='utf-8') as stream:
            json.dump(value, stream, indent=2, allow_nan=False)
        result = dict(status='UNACTIVATED_DESCRIPTOR_WRITTEN', contract_id=descriptor_contract(value)['contract_id'])
    elif args.command == 'contract':
        result = descriptor_contract(json.loads(args.descriptor.read_text(encoding='utf-8')))
    else:
        pipeline = load_descriptor(args.descriptor, experimental=args.experimental, threads=args.threads)
        result = dict(status='HASH_AND_IO_PASS', contract=pipeline.contract, provenance_approved=False,
                      production_activated=False)
        if args.smoke:
            import numpy as np
            import time
            started=time.perf_counter();pipeline.detector.detect(np.zeros((640,640,3),np.uint8))
            detector_ms=(time.perf_counter()-started)*1000
            started=time.perf_counter();vector=pipeline.recognizer.get_embedding(np.zeros((112,112,3),np.uint8))
            result.update(synthetic_finite_output=bool(np.isfinite(vector).all()),detector_ms=detector_ms,
                          recognition_ms=(time.perf_counter()-started)*1000,accuracy='UNVERIFIED')
    print(json.dumps(result, indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
