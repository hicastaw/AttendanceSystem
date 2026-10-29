"""Versioned side-by-side gallery migration/rollback REHEARSAL, never live cutover.

All paths confined to .model-validation or OS temp. New R50 embeddings must be
provided by re-enrollment; conversion/relabeling MBF vectors is forbidden.
"""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import uuid

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'AIOT/edge'),str(ROOT/'tools')]
from integration_gate import validate_candidate_contract
from member_gallery import content_version,validate_members,CACHE_SCHEMA_VERSION
from model_contract import LEGACY_CONTRACT,MANIFEST
from pipeline import normalize
from model_cpu_lab import lab_path


def digest(data):return hashlib.sha256(data).hexdigest()


def read(path):
    path=lab_path(path)
    if path.stat().st_size>50_000_000:raise ValueError('Bounded gallery file required')
    data=path.read_bytes()
    return data,json.loads(data)


def candidate_codes(gallery):
    validate_candidate_contract(gallery.get('contract'))
    entries=gallery.get('entries')
    if not isinstance(entries,list) or len(entries)>10000:raise ValueError('Invalid candidate gallery')
    codes=[]
    for item in entries:
        code=item.get('code')
        if not isinstance(code,str) or not code or code!=code.strip().upper():raise ValueError('Expected canonical member code')
        if not isinstance(item.get('embedding'),list) or any(type(x) not in (float,int) for x in item['embedding']):raise ValueError('Invalid candidate embedding numbers')
        normalize(item['embedding']);codes.append(code)
    if len(set(codes))!=len(codes):raise ValueError('Duplicate candidate member')
    return set(codes)


def prepare(legacy_path,candidate_path,directory):
    legacy_bytes,legacy=read(legacy_path);candidate_bytes,candidate=read(candidate_path)
    if legacy.get('cache_schema_version')!=CACHE_SCHEMA_VERSION or legacy.get('contract')!=LEGACY_CONTRACT:
        raise ValueError('Expected an authentic legacy cache schema/contract, not relabeled R50')
    members=validate_members(legacy.get('data'));codes={item['user_code'] for item in members}
    if legacy.get('gallery_version')!=content_version(legacy['data'],LEGACY_CONTRACT):raise ValueError('Legacy gallery revision mismatch')
    new_codes=candidate_codes(candidate)
    # Membership parity is necessary, not proof of correct identity enrollment.
    if not codes or codes!=new_codes:raise ValueError('Complete matching membership must be re-enrolled; partial/extra/empty refused')
    if candidate['contract']['recognizer_sha256']==MANIFEST['sha256']['w600k_mbf.onnx']:
        raise ValueError('MBF weights cannot be declared as a new R50 space')
    directory=lab_path(directory);directory.mkdir(parents=True,exist_ok=False)
    names={}
    for label,data in (('legacy',legacy_bytes),('candidate',candidate_bytes)):
        name=f'{label}-{digest(data)}.json'
        with (directory/name).open('xb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
        names[label]=dict(file=name,sha256=digest(data))
    manifest=dict(schema=1,mode='migration-rehearsal-only',snapshots=names,candidate_contract_id=candidate['contract']['contract_id'],
                  members=len(codes),identity_proof='UNVERIFIED',production_activated=False)
    with (directory/'transition.json').open('x',encoding='utf-8') as stream:json.dump(manifest,stream,sort_keys=True)
    with (directory/'pointer.json').open('x',encoding='utf-8') as stream:json.dump(dict(schema=1,revision=0,active='legacy'),stream)
    return dict(status='PREPARED_REHEARSAL',members=len(codes),production_activated=False)


@contextmanager
def locked(directory):
    lock=directory/'transition.lock'
    with lock.open('x'):pass
    try:yield
    finally:lock.unlink()


def verified(directory,*,target='candidate'):
    _,manifest=read(directory/'transition.json')
    if manifest.get('schema')!=1 or manifest.get('mode')!='migration-rehearsal-only' or manifest.get('production_activated') is not False:
        raise ValueError('Not a rehearsal transition')
    snapshots={}
    for label in (('legacy','candidate') if target=='candidate' else ('legacy',)):
        info=manifest['snapshots'][label];name=info['file']
        if not isinstance(info.get('sha256'),str) or not re.fullmatch('[0-9a-f]{64}',info['sha256']):raise ValueError('Invalid snapshot SHA')
        if name!=f"{label}-{info['sha256']}.json":raise ValueError('Invalid snapshot binding')
        data,body=read(directory/name)
        if digest(data)!=info['sha256']:raise ValueError('Gallery snapshot changed')
        snapshots[label]=body
    legacy=snapshots['legacy']
    if legacy.get('contract')!=LEGACY_CONTRACT or legacy.get('cache_schema_version')!=CACHE_SCHEMA_VERSION or legacy.get('gallery_version')!=content_version(legacy['data'],LEGACY_CONTRACT):
        raise ValueError('Legacy snapshot contract/revision changed')
    if target=='candidate':
        if candidate_codes(snapshots['candidate'])!={item['user_code'] for item in validate_members(legacy['data'])}:
            raise ValueError('Snapshot membership mismatch')
        if snapshots['candidate']['contract']['contract_id']!=manifest['candidate_contract_id']:raise ValueError('Candidate binding changed')
    _,pointer=read(directory/'pointer.json')
    if pointer.get('schema')!=1 or type(pointer.get('revision')) is not int or pointer['revision']<0 or pointer.get('active') not in ('legacy','candidate'):
        raise ValueError('Invalid rehearsal pointer')
    return manifest,pointer


def select(directory,active,expected_revision):
    directory=lab_path(directory)
    if active not in ('legacy','candidate') or type(expected_revision) is not int:raise ValueError('Explicit pointer target/revision required')
    with locked(directory):
        manifest,pointer=verified(directory,target=active)
        if pointer['revision']!=expected_revision:raise ValueError('Stale transition revision')
        replacement=dict(schema=1,revision=expected_revision+1,active=active)
        temporary=directory/('pointer-'+uuid.uuid4().hex+'.tmp')
        try:
            with temporary.open('x',encoding='utf-8') as stream:
                json.dump(replacement,stream);stream.flush();os.fsync(stream.fileno())
            os.replace(temporary,directory/'pointer.json')
        finally:temporary.unlink(missing_ok=True)
    return dict(status='REHEARSAL_SELECTED',active=active,revision=replacement['revision'],production_activated=False)


def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    item=sub.add_parser('prepare');item.add_argument('--legacy',required=True);item.add_argument('--candidate',required=True);item.add_argument('--directory',required=True)
    for command in ('select-candidate','rollback'):
        item=sub.add_parser(command);item.add_argument('--directory',required=True);item.add_argument('--expected-revision',type=int,required=True)
    args=parser.parse_args()
    result=prepare(args.legacy,args.candidate,args.directory) if args.command=='prepare' else select(args.directory,'legacy' if args.command=='rollback' else 'candidate',args.expected_revision)
    print(json.dumps(result,indent=2))


if __name__=='__main__':main()
