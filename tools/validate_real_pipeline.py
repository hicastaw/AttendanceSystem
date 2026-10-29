"""Public-domain fixture smoke, NOT recognition accuracy or threshold calibration.

Downloads are explicit; validation is offline/hash-pinned and prints no vectors.
Three enrollment views are augmentations of ONE photo, not independent samples.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import cv2
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'AIOT/edge'),str(ROOT/'tools')]
from experimental_cpu import ExperimentalPipeline
from model_cpu_lab import lab_path,write_new

FIXTURES={
    'astronaut.png':dict(sha256='88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5',
        url='https://raw.githubusercontent.com/scikit-image/scikit-image/v0.25.2/skimage/data/astronaut.png',
        license='public-domain',credit='NASA / Eileen Collins portrait, distributed by scikit-image',
        license_source='https://scikit-image.org/docs/0.25.x/api/skimage.data.html#skimage.data.astronaut'),
    'grace_hopper.jpg':dict(sha256='e1f57e98cf38076c0f9a058d74ffddf90f20453e436033784606b63c8ed2e49a',
        url='https://upload.wikimedia.org/wikipedia/commons/5/55/Grace_Hopper.jpg',
        license='public-domain-US-government',credit='James S. Davis / US Navy, NH 96919-KN, 1984',
        license_source='https://commons.wikimedia.org/wiki/File:Grace_Hopper.jpg')}


def fixture_images(directory):
    directory=lab_path(directory);images=[]
    for name,info in FIXTURES.items():
        path=directory/name
        if path.stat().st_size>5_000_000:raise ValueError('Oversized fixture')
        data=path.read_bytes()
        if hashlib.sha256(data).hexdigest()!=info['sha256']:raise ValueError('Public-domain fixture checksum mismatch')
        image=cv2.imdecode(np.frombuffer(data,dtype=np.uint8),cv2.IMREAD_COLOR)
        if image is None:raise ValueError('Fixture decode failed')
        images.append(image)
    return images


def fetch(directory):
    directory=lab_path(directory);directory.mkdir(parents=True,exist_ok=False)
    for name,info in FIXTURES.items():
        request=urllib.request.Request(info['url'],headers={'User-Agent':'AttendanceSystem-public-fixture-validation'})
        started=time.monotonic();data=bytearray()
        with urllib.request.urlopen(request,timeout=10) as response:
            while chunk:=response.read(65536):
                data.extend(chunk)
                if len(data)>5_000_000 or time.monotonic()-started>30:raise ValueError('Fixture download bound exceeded')
        if hashlib.sha256(data).hexdigest()!=info['sha256']:raise ValueError('Downloaded fixture checksum mismatch')
        with (directory/name).open('xb') as stream:stream.write(data)
    write_new(directory/'fixture-license-manifest.json',FIXTURES)
    return dict(status='FETCHED_HASH_VERIFIED',fixtures=len(FIXTURES))


def validate(pipeline,directory):
    known,unknown=fixture_images(directory)
    geometry=[]
    for image in (known,unknown):
        faces=pipeline.detector.detect(image)
        if len(faces)!=1:raise ValueError('Real-image fixture must have exactly ONE actually detected face; NO_FACE is not unknown-identity coverage')
        face=faces[0]
        if face.landmarks_5.shape!=(5,2) or not np.isfinite(face.landmarks_5).all():raise ValueError('Invalid real landmarks')
        geometry.append(dict(faces=1,landmark_shape=[5,2],score=face.score))
    samples=[known,cv2.convertScaleAbs(known,alpha=.98,beta=2),
             cv2.warpAffine(known,np.float32([[1,0,2],[0,1,1]]),(known.shape[1],known.shape[0]))]
    gallery=pipeline.enroll(samples,'PUBLIC_FIXTURE_A')
    probe=cv2.convertScaleAbs(known,alpha=1.02,beta=-2)
    # Predeclared smoke operating point, never selected from measured separation.
    same=pipeline.match(probe,gallery,threshold=.6,minimum_margin=.05)
    different=pipeline.match(unknown,gallery,threshold=.6,minimum_margin=.05)
    if same['state']!='MATCH' or different['state']!='UNKNOWN' or 'score' not in different:
        raise ValueError('Known/unknown identity smoke failed (not a calibrated accuracy evaluation)')
    return dict(status='PASS_REAL_IMAGE_SMOKE_ONLY',geometry=geometry,known=same,unknown=different,
                contract=pipeline.contract,fixtures=FIXTURES,enrollment='3 augmented views of ONE public-domain photo',
                accuracy='UNVERIFIED',calibration='UNVERIFIED',production_activated=False)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixtures',type=Path,required=True);parser.add_argument('--fetch',action='store_true')
    parser.add_argument('--models',type=Path,default=ROOT/'AIOT/edge/model')
    parser.add_argument('--profile',choices=['local-candidate','hailo-official'],default='local-candidate')
    parser.add_argument('--detector-threshold',type=float,default=.5)
    parser.add_argument('--experimental',action='store_true');parser.add_argument('--ftz',action='store_true')
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    if args.fetch:result=fetch(args.fixtures)
    else:
        if not args.experimental:parser.error('Explicit --experimental required; weights license approval is not implied')
        if args.profile=='hailo-official':
            from official_hailo_cpu import load_official_reference
            pipeline=load_official_reference(args.models,experimental=True,threads=4,denormal_as_zero=args.ftz,detection_threshold=args.detector_threshold)
        else:pipeline=ExperimentalPipeline.load(args.models,experimental=True,threads=4,denormal_as_zero=args.ftz,detection_threshold=args.detector_threshold)
        result=validate(pipeline,args.fixtures)
        if args.output:write_new(args.output,result)
    print(json.dumps(result,indent=2))


if __name__=='__main__':main()
