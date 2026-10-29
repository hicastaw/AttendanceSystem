"""Hash-pinned Hailo Model Zoo ONNX baseline, NOT a HEF tensor adapter.

Published artifact origin is traceable; underlying checkpoint/export factory and
conflicting pretrained-weight licenses still block production approval.
"""
import copy
import numpy as np
from experimental_cpu import (BASE_CONTRACT,ExperimentalPipeline,model_session,validate_io,
                              detector_tensor,rgb_tensor,frame)
from reference_adapters import decode_scrfd,r50_output

REVISION='49039700f5c1aff9063e028c3bc55ef174371b36'
DETECTOR_SHA='ba018cc303bdb3279c102794db84c0b5e86ebf32a5d765c63a11138f52917aca'
RECOGNIZER_SHA='664c361bf352a3fc474168ca9def511b6178dd0040eda2e3b0229ae68d368390'
OUTPUT_NAMES=[f'{kind}_{stride}' for kind in ('score','bbox','kps') for stride in (8,16,32)]
OUTPUT_SHAPES=[[1,count,width] for width in (1,4,10) for count in (12800,3200,800)]
S3='https://hailo-model-zoo.s3.eu-west-2.amazonaws.com/'
ARTIFACTS={
    'scrfd_10g.zip':dict(url=S3+'FaceDetection/scrfd/scrfd_10g/pretrained/2022-09-07/scrfd_10g.zip',
        archive_sha256='edb61bbd5e5f6e9fa6f19cd3653ccab8e77aeb3ff623f880bf40bb7bb3d2f44a',
        model='scrfd_10g_bnkps.onnx',sha256=DETECTOR_SHA,bytes=16923479),
    'arcface_r50.zip':dict(url=S3+'FaceRecognition/arcface/arcface_r50/pretrained/2022-08-24/arcface_r50.zip',
        archive_sha256='f11f55b4fa1b3b5456826baddfd7e5160428d46b1a810e51a524c1c69503eaa4',
        model='r50.onnx',sha256=RECOGNIZER_SHA,bytes=124135202)}


class OfficialScrfd:
    def __init__(self,session,score_threshold=.5):
        if type(score_threshold) not in (int,float) or not 0<=score_threshold<=1:raise ValueError('Finite detector operating point required')
        validate_io(session,'input.1',[1,3,640,640],list(zip(OUTPUT_NAMES,OUTPUT_SHAPES)))
        self.session,self.score_threshold,self.nms_threshold=session,score_threshold,.4

    def detect(self,image):
        tensor,scale=detector_tensor(image)
        heads=self.session.run(OUTPUT_NAMES,{'input.1':tensor})
        # These EXACT ONNX outputs have a verified leading batch axis; HEF may
        # have entirely different native heads. Never apply this squeeze to HEF.
        if len(heads)!=9 or any(list(value.shape)!=shape for value,shape in zip(heads,OUTPUT_SHAPES)):
            raise ValueError('Official SCRFD output contract changed')
        return decode_scrfd([value[0] for value in heads],size=(640,640),scale=scale,
                            score_threshold=self.score_threshold,nms_threshold=self.nms_threshold)


class OfficialR50:
    def __init__(self,session):
        validate_io(session,'data',[1,3,112,112],[('642',[1,512])]);self.session=session

    def get_embedding(self,image):
        if frame(image).shape!=(112,112,3):raise ValueError('Expected aligned 112x112 BGR crop')
        return r50_output(self.session.run(['642'],{'data':rgb_tensor(image,127.5)})[0])


def load_official_reference(directory,*,experimental=False,threads=4,denormal_as_zero=False,detection_threshold=.5):
    from pathlib import Path
    if experimental is not True:raise ValueError('Explicit research opt-in required; license approval unresolved')
    root=Path(directory)
    detector=OfficialScrfd(model_session(root/'scrfd_10g_bnkps.onnx',DETECTOR_SHA,threads,denormal_as_zero),detection_threshold)
    recognizer=OfficialR50(model_session(root/'r50.onnx',RECOGNIZER_SHA,threads,denormal_as_zero))
    contract=copy.deepcopy(BASE_CONTRACT)
    contract.update(schema=2,model_id='hailomz-r50-664c361bf352-onnx-reference-v1',
                    detector_sha256=DETECTOR_SHA,recognizer_sha256=RECOGNIZER_SHA,
                    preprocess_id='hailomz-r50-rgb112-nchw-f32-mean1275-std1275-v1',
                    detector_decode='hailomz-scrfd-batch1-nine-heads-inclusive-nms-axis-inverse-v1',
                    source_revision=REVISION,provenance='VENDOR_PUBLISHED_ARTIFACT_HASH_VERIFIED',
                    training_lineage='MS1MV3_VENDOR_DECLARED_NOT_INDEPENDENTLY_ATTESTED',
                    export_factory='UNVERIFIED_PUBLISHED_PYTORCH1.10_ONNX',
                    preprocessing_status='PUBLISHED_NORMALIZATION_ONLY_ALIGNMENT_VENDOR_PARITY_UNVERIFIED',
                    license='BLOCKED_CONFLICT_VENDOR_MIT_VS_INSIGHTFACE_PRETRAINED_RESEARCH_ONLY',
                    preprocess_evidence=f'https://github.com/hailo-ai/hailo_model_zoo/blob/{REVISION}/hailo_model_zoo/cfg/networks/arcface_r50.yaml',
                    hef_parity='UNVERIFIED_DIFFERENT_ARTIFACT_SPACE')
    return ExperimentalPipeline(detector,recognizer,denormal_as_zero=denormal_as_zero,
                                artifacts_verified=True,reference_contract=contract)
