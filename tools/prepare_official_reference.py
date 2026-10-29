"""Reproduce hash-pinned Hailo ONNX lab artifacts; no production model writes."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'AIOT/edge'),str(ROOT/'tools')]
from official_hailo_cpu import ARTIFACTS,REVISION
from model_cpu_lab import lab_path,write_new


def prepare(archives,destination):
    archives=lab_path(archives);destination=lab_path(destination)
    verified=[]
    for name,info in ARTIFACTS.items():
        path=archives/name
        if path.stat().st_size>200_000_000:raise ValueError('Archive size bound exceeded')
        data=path.read_bytes()
        if hashlib.sha256(data).hexdigest()!=info['archive_sha256']:raise ValueError('Archive hash mismatch: incomplete or changed download')
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if archive.namelist()!=[info['model']] or Path(info['model']).name!=info['model']:
                raise ValueError('Unexpected archive member/path')
            if archive.getinfo(info['model']).file_size!=info['bytes']:raise ValueError('Unexpected model byte size')
            model=archive.read(info['model'])  # CRC checked; no extractall / path traversal.
            if hashlib.sha256(model).hexdigest()!=info['sha256']:raise ValueError('ONNX hash mismatch')
            verified.append((info['model'],model))
    destination.mkdir(parents=True,exist_ok=False)
    for name,data in verified:
        with (destination/name).open('xb') as stream:stream.write(data)
    manifest=dict(status='VERIFIED_PUBLISHED_ONNX_ARTIFACTS',source_revision=REVISION,artifacts=ARTIFACTS,
                  checkpoint_lineage='VENDOR_DECLARED',license_approval='BLOCKED_CONFLICT',production_activated=False)
    write_new(destination/'provenance.json',manifest)
    return manifest


def download(directory):
    directory=lab_path(directory);directory.mkdir(parents=True,exist_ok=False)
    curl=shutil.which('curl')
    if not curl:raise RuntimeError('curl required for bounded explicit public downloads')
    for name,info in ARTIFACTS.items():
        subprocess.run([curl,'--fail','--location','--silent','--show-error','--max-time','1200',
                        '--connect-timeout','10','--max-filesize','200000000','--output',str(directory/name),info['url']],check=True,timeout=1210)
    return directory


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archives',type=Path,required=True);parser.add_argument('--destination',type=Path,required=True)
    parser.add_argument('--download',action='store_true',help='Network opt-in; archive directory must be NEW')
    args=parser.parse_args()
    if args.download:download(args.archives)
    print(json.dumps(prepare(args.archives,args.destination),indent=2))
