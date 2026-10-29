"""Offline quarantine receipt and tensor parity. Never execute checkpoint code.

Owner assertions are recorded, not approved. PyTorch export remains blocked until
the exact trusted factory/export environment is supplied and reviewed separately.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import zipfile

import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'AIOT/edge'),str(ROOT/'tools')]
from cpu_model_tool import inspect_artifact
from cpu_onnx import validate_descriptor,descriptor_contract,checked_session,tensor
from model_cpu_lab import lab_path,write_new


def digest(path):
    with Path(path).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()


def ingest(artifact,expected_sha,evidence,descriptor_path,destination):
    artifact=Path(artifact).resolve();destination=lab_path(destination)
    if digest(artifact)!=expected_sha:raise ValueError('OWNER_SHA_MISMATCH')
    if not isinstance(evidence,dict) or not all(isinstance(evidence.get(k),str) and evidence[k].strip()
            for k in ('source','checkpoint','training','export','preprocessing','license')):
        raise ValueError('Explicit evidence or UNVERIFIED for each provenance field required')
    facts=inspect_artifact(artifact)  # No pickle or imports from artifact/factory.
    if facts['sha256']!=expected_sha:raise ValueError('Artifact changed while inspecting')
    descriptor=None
    if artifact.suffix.lower()=='.onnx':
        if descriptor_path is None:raise ValueError('Explicit preprocessing/I/O descriptor required; not inferred')
        original=Path(descriptor_path).resolve()
        descriptor=validate_descriptor(json.loads(original.read_text(encoding='utf-8')))
        if descriptor['recognizer']['sha256']!=expected_sha:raise ValueError('Descriptor does not bind supplied recognizer')
        for role in ('detector','recognizer'):
            descriptor[role]['path']=str((original.parent/descriptor[role]['path']).resolve())
        # Preserve what was supplied but do not bless a conflicting descriptor.
        if Path(descriptor['recognizer']['path'])!=artifact:raise ValueError('Descriptor path differs from supplied artifact')
    destination.mkdir(parents=True,exist_ok=False)
    suffix='.onnx' if descriptor else '.checkpoint'
    target=destination/('recognizer-'+expected_sha+suffix)
    with artifact.open('rb') as source,target.open('xb') as output:shutil.copyfileobj(source,output)
    if digest(target)!=expected_sha:raise ValueError('Quarantine copy digest mismatch; retain evidence for inspection')
    receipt=dict(schema=1,status='QUARANTINED_UNAPPROVED' if descriptor else 'BLOCKED_TRUSTED_EXPORT_REQUIRED',
                 artifact_sha256=expected_sha,artifact_facts=facts,owner_assertions=evidence,
                 evidence_status='UNVERIFIED_OWNER_ASSERTIONS',checkpoint_deserialized=False,
                 production_approved=False,production_activated=False,
                 required_export=['trusted factory source + revision/hash','weights-only/state-dict loader reviewed in isolated environment',
                                  'pinned export environment + opset + explicit input/output/preprocessing',
                                  'original-export golden crops/tensors/outputs with SHA; no arbitrary pickle execution'])
    if descriptor:
        descriptor['recognizer']['path']=str(target)
        # Review statuses cannot be promoted by this tool, even if user text claims approval.
        descriptor.update(provenance='UNVERIFIED_INGESTION_OWNER_ASSERTIONS',training='UNVERIFIED_OWNER_ASSERTIONS',
                          export='UNVERIFIED_OWNER_ASSERTIONS',license='UNVERIFIED_OWNER_ASSERTIONS',
                          preprocessing_evidence='UNVERIFIED_OWNER_ASSERTIONS')
        write_new(destination/'candidate-descriptor.json',descriptor)
        receipt['contract_id']=descriptor_contract(descriptor)['contract_id']
    write_new(destination/'ingestion-receipt.json',receipt)
    return receipt


def compare_tensors(reference,actual,*,atol,rtol,min_cosine):
    if any(type(x) not in (int,float) or not np.isfinite(x) for x in (atol,rtol,min_cosine)) or not 0<=atol<=1 or not 0<=rtol<=1 or not -1<=min_cosine<=1:
        raise ValueError('Explicit bounded parity tolerances required')
    reference,actual=np.asarray(reference),np.asarray(actual)
    if reference.shape!=actual.shape or reference.ndim!=2 or reference.shape[1]!=512 or not 1<=len(reference)<=32:
        raise ValueError('Expected matching batch x 512 output tensors')
    if reference.dtype.kind!='f' or actual.dtype.kind!='f':raise ValueError('Floating-point outputs required')
    reference,actual=reference.astype(np.float64),actual.astype(np.float64)
    if not np.isfinite(reference).all() or not np.isfinite(actual).all():raise ValueError('Nonfinite parity output')
    with np.errstate(over='ignore',invalid='ignore'):
        norms=np.linalg.norm(reference,axis=1)*np.linalg.norm(actual,axis=1)
    if not np.isfinite(norms).all() or (norms<1e-12).any():raise ValueError('Zero or overflowing parity vector')
    cosines=np.clip(np.sum(reference.astype(np.float64)*actual,axis=1)/norms,-1,1)
    close=bool(np.allclose(reference,actual,atol=atol,rtol=rtol))
    return dict(status='PASS_TENSOR_PARITY_ONLY' if close and cosines.min()>=min_cosine else 'FAIL_TENSOR_PARITY',
                samples=len(reference),allclose=close,max_abs_error=float(np.max(np.abs(reference-actual))),
                min_cosine=float(cosines.min()),atol=atol,rtol=rtol,required_min_cosine=min_cosine,
                accuracy_claim=False,provenance_approved=False,production_activated=False)


def parity(descriptor_path,reference_path,expected_sha,*,atol,rtol,min_cosine,threads=4):
    reference_path=Path(reference_path)
    if digest(reference_path)!=expected_sha:raise ValueError('REFERENCE_SHA_MISMATCH')
    # Bound uncompressed archive before np.load; forbid pickle/object payloads.
    with zipfile.ZipFile(reference_path) as archive:
        if len(archive.infolist())>8 or sum(x.file_size for x in archive.infolist())>32*1024*1024:
            raise ValueError('Reference bundle too large')
    path=Path(descriptor_path).resolve()
    descriptor=validate_descriptor(json.loads(path.read_text(encoding='utf-8')))
    with np.load(reference_path,allow_pickle=False) as data:
        if set(data.files) not in ({'inputs','outputs'},{'inputs','outputs','crops'}):raise ValueError('Unexpected reference keys')
        inputs,expected=data['inputs'],data['outputs']
        if inputs.dtype!=np.float32 or inputs.ndim!=4 or inputs.shape[1:]!=(3,112,112) or not 1<=len(inputs)<=32 or not np.isfinite(inputs).all():
            raise ValueError('Expected finite FP32 reference NCHW tensors')
        preprocessing='UNVERIFIED_NO_GOLDEN_CROPS'
        if 'crops' in data:
            crops=data['crops']
            if crops.dtype!=np.uint8 or crops.shape!=(len(inputs),112,112,3):raise ValueError('Invalid reference BGR crops')
            generated=np.concatenate([tensor(crop,descriptor['recognizer']) for crop in crops])
            if not np.allclose(inputs,generated,atol=1e-7,rtol=0):raise ValueError('GOLDEN_PREPROCESSING_MISMATCH')
            preprocessing='PASS_SUPPLIED_CROP_TO_TENSOR_ONLY'
        session=checked_session(descriptor['recognizer'],path.parent,threads,descriptor.get('ftz',False))
        actual=np.concatenate([session.run([descriptor['recognizer']['outputs'][0]['name']],
                               {descriptor['recognizer']['input']:value[None]})[0] for value in inputs])
        result=compare_tensors(expected,actual,atol=atol,rtol=rtol,min_cosine=min_cosine)
    result.update(contract_id=descriptor_contract(descriptor)['contract_id'],reference_sha256=expected_sha,
                  preprocessing=preprocessing,alignment_parity='UNVERIFIED',reference_origin='UNVERIFIED_OWNER_SUPPLIED')
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    intake=sub.add_parser('ingest');intake.add_argument('artifact',type=Path);intake.add_argument('--sha256',required=True)
    intake.add_argument('--evidence',type=Path,required=True);intake.add_argument('--descriptor',type=Path)
    intake.add_argument('--destination',type=Path,required=True)
    check=sub.add_parser('parity');check.add_argument('--descriptor',type=Path,required=True)
    check.add_argument('--reference',type=Path,required=True);check.add_argument('--reference-sha256',required=True)
    check.add_argument('--atol',type=float,required=True);check.add_argument('--rtol',type=float,required=True)
    check.add_argument('--min-cosine',type=float,required=True);check.add_argument('--threads',type=int,default=4)
    check.add_argument('--experimental',action='store_true');check.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.command=='ingest':
        if args.evidence.stat().st_size>128*1024:parser.error('Evidence file too large')
        receipt=ingest(args.artifact,args.sha256,json.loads(args.evidence.read_text(encoding='utf-8')),args.descriptor,args.destination)
        print(json.dumps({k:receipt[k] for k in ('status','artifact_sha256','production_activated')}));return 0
    if not args.experimental:parser.error('Explicit --experimental required')
    result=parity(args.descriptor,args.reference,args.reference_sha256,atol=args.atol,rtol=args.rtol,min_cosine=args.min_cosine,threads=args.threads)
    write_new(args.output,result);print(json.dumps(result));return 0 if result['status']=='PASS_TENSOR_PARITY_ONLY' else 2


if __name__=='__main__':sys.exit(main())
