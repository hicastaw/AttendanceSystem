"""Read-only Git inventory + verified, deterministic first-party source snapshot.

No staging/commits/restores. Excludes weights, data, secrets and dependencies.
Deleted tracked paths are recorded, never automatically removed on restore.
"""
import argparse
import hashlib
import json
from pathlib import Path,PurePosixPath
import subprocess
import stat
import sys
import tempfile
import zipfile

ROOT=Path(__file__).resolve().parents[1]
SUFFIXES={'.py','.js','.mjs','.cjs','.ts','.tsx','.jsx','.html','.css','.sql','.sh','.md','.yml','.yaml','.toml','.service'}
SKIP={'node_modules','.venv','__pycache__','.git','data','uploads','faces','logs','.model-validation','.codex','.aws'}


def allowed(name):
    value=PurePosixPath(name)
    if value.is_absolute() or '\\' in name or '..' in value.parts or not value.parts:return False
    if any(p in SKIP for p in value.parts):return False
    if any(p.startswith('.') and p not in ('.agents','.github','.env.example','.gitignore') for p in value.parts):return False
    if value.name=='.gitignore' or value.name=='.env.example' or value.name.endswith('.env.example'):return True
    if value.suffix in SUFFIXES:return True
    if value.name in ('package.json','package-lock.json','tsconfig.json','embedding-contract.json'):return True
    return value.suffix=='.txt' and value.name.startswith(('requirements','constraints-'))


def _git(source,*arguments):
    return subprocess.check_output(['git','-C',str(source),*arguments],timeout=30)


def inventory(source=ROOT):
    source=Path(source).resolve()
    if Path(_git(source,'rev-parse','--show-toplevel').decode().strip()).resolve()!=source:
        raise ValueError('Inventory must run at its actual Git root, not an unpacked stage inside another repository')
    tracked=set(_git(source,'ls-files','-z').decode('utf-8').rstrip('\0').split('\0'))-{''}
    untracked=set(_git(source,'ls-files','--others','--exclude-standard','-z').decode('utf-8').rstrip('\0').split('\0'))-{''}
    entries={};excluded=[];deleted=[]
    for name in sorted(tracked|untracked):
        path=source/name
        if not allowed(name):excluded.append(name);continue
        if not path.exists():
            if name in tracked:deleted.append(name)
            continue
        if path.is_symlink() or any((source/p).is_symlink() for p in path.relative_to(source).parents if p!=Path('.')):
            raise ValueError('Source symlink refused')
        if not path.resolve().is_relative_to(source) or not path.is_file():raise ValueError('Source path escapes repository')
        with path.open('rb') as stream:sha=hashlib.file_digest(stream,'sha256').hexdigest()
        entries[name]=dict(sha256=sha,bytes=path.stat().st_size,tracked=name in tracked)
    return dict(schema=1,head=_git(source,'rev-parse','HEAD').decode().strip(),files=entries,
                untracked=sorted(untracked),excluded=excluded,deleted_tracked=deleted,
                status_porcelain=_git(source,'status','--porcelain=v1','-z').decode('utf-8').split('\0'),
                limitations='Source snapshot only; no Git history, model weights, secrets, runtime data or off-device backup certification.')


def output_path(path):
    path=Path(path).resolve()
    if not (path.is_relative_to(ROOT/'.model-validation') or path.is_relative_to(Path(tempfile.gettempdir()).resolve()) and not path.is_relative_to(ROOT)):
        raise ValueError('Snapshot output must be lab/OS temp, never production source')
    return path


def verify(archive):
    with zipfile.ZipFile(archive) as package:
        names=package.namelist()
        if len(names)>20000 or len(names)!=len(set(names)) or 'SOURCE_MANIFEST.json' not in names:raise ValueError('Snapshot membership invalid')
        if package.getinfo('SOURCE_MANIFEST.json').file_size>16*1024*1024 or sum(x.file_size for x in package.infolist())>512*1024*1024:
            raise ValueError('Snapshot exceeds source verification bounds')
        manifest=json.loads(package.read('SOURCE_MANIFEST.json'))
        if manifest.get('schema')!=1 or set(names)!=(set(manifest['files'])|{'SOURCE_MANIFEST.json'}):raise ValueError('Snapshot manifest mismatch')
        for name,entry in manifest['files'].items():
            info=package.getinfo(name)
            if not allowed(name) or info.file_size!=entry['bytes'] or stat.S_ISLNK(info.external_attr>>16):raise ValueError('Unsafe/invalid snapshot member')
            with package.open(name) as stream:
                if hashlib.file_digest(stream,'sha256').hexdigest()!=entry['sha256']:raise ValueError('Snapshot SHA mismatch')
        return dict(status='PASS_SOURCE_SNAPSHOT',files=len(manifest['files']),head=manifest['head'],git_reproducible=False)


def snapshot(destination,source=ROOT):
    source=Path(source).resolve();destination=output_path(destination)
    manifest=inventory(source);destination.parent.mkdir(parents=True,exist_ok=True)
    with destination.open('xb') as output,zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED) as package:
        for name,entry in manifest['files'].items():
            data=(source/name).read_bytes()
            if hashlib.sha256(data).hexdigest()!=entry['sha256']:raise ValueError('Source changed during snapshot; retain partial archive as failed')
            package.writestr(zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0)),data)
        package.writestr(zipfile.ZipInfo('SOURCE_MANIFEST.json',date_time=(1980,1,1,0,0,0)),json.dumps(manifest,sort_keys=True,indent=2).encode())
    # Catch concurrent edits/deletions/additions; never claim a moving tree was preserved.
    if inventory(source)!=manifest:raise ValueError('Working tree changed during snapshot; retry to a new file')
    return verify(destination)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=['inventory','snapshot','verify'])
    parser.add_argument('--output',type=Path);parser.add_argument('--archive',type=Path)
    args=parser.parse_args()
    if args.command=='verify':
        if args.archive is None:parser.error('--archive required')
        result=verify(args.archive)
    elif args.command=='snapshot':
        if args.output is None:parser.error('--output required')
        result=snapshot(args.output)
    else:
        result=inventory()
        if args.output is not None:
            target=output_path(args.output);target.parent.mkdir(parents=True,exist_ok=True)
            with target.open('x',encoding='utf-8') as stream:json.dump(result,stream,indent=2)
            result=dict(head=result['head'],source_files=len(result['files']),untracked=len(result['untracked']),
                        excluded=len(result['excluded']),git_mutated=False)
    print(json.dumps(result,indent=2))


if __name__=='__main__':main()
