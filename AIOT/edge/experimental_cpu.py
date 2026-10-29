"""Opt-in research pipeline; no camera, backend, attendance DB or MBF gallery imports.

Hash-bound implementation assumptions are NOT evidence of checkpoint provenance.
No production launcher imports this module. New enrollment is mandatory.
"""
import copy
import hashlib
import json
from pathlib import Path
import time
import cv2
import numpy as np
from pipeline import align_five_points, normalize, normalized_centroid
from reference_adapters import decode_scrfd, r50_output

DETECTOR_SHA='5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91'
RECOGNIZER_SHA='e0f68a523d8ce09c288f146e655ffc0eb41f79d30a3a930b0213eafaf80a655c'
DETECTOR_OUTPUTS=['448','471','494','451','474','497','454','477','500']
BASE_CONTRACT=dict(schema=1,mode='experimental-cpu-only',dimension=512,
                   detector_sha256=DETECTOR_SHA,recognizer_sha256=RECOGNIZER_SHA,
                   detector_preprocess='bgr-to-rgb-nchw-f32-mean1275-std128-top-left-resize640-v1',
                   detector_decode='scrfd-strides8-16-32-anchor2-inclusive-nms-axis-inverse-v1',
                   preprocess_id='ASSUMED-rgb112-nchw-f32-mean1275-std1275-v1',
                   alignment_id='arcface112-five-point-lstsq-linear-zero-border-v1',
                   normalization='l2-f64-centroid-of-unit-vectors',
                   provenance='UNVERIFIED',license='UNVERIFIED',production_approved=False)


def frame(value):
    value=np.asarray(value)
    if value.dtype!=np.uint8 or value.ndim!=3 or value.shape[2]!=3 or min(value.shape[:2])<2 or max(value.shape[:2])>4096:
        raise ValueError('Expected bounded uint8 BGR image, 2..4096 pixels per axis')
    return value


def rgb_tensor(image, std):
    return np.ascontiguousarray(((frame(image)[:,:,::-1].astype(np.float32)-127.5)/std).transpose(2,0,1)[None])


def detector_tensor(image):
    image=frame(image);height,width=image.shape[:2]
    ratio=min(640/width,640/height)
    new_width,new_height=max(1,int(width*ratio)),max(1,int(height*ratio))
    canvas=np.zeros((640,640,3),np.uint8)
    canvas[:new_height,:new_width]=cv2.resize(image,(new_width,new_height),interpolation=cv2.INTER_LINEAR)
    return rgb_tensor(canvas,128.0),(new_width/width,new_height/height)


def model_session(path, digest, threads, denormal_as_zero, *, allow_spinning=True):
    import onnxruntime as ort
    if type(threads) is not int or not 1<=threads<=16:raise ValueError('CPU threads must be 1..16')
    data=Path(path).read_bytes()
    if hashlib.sha256(data).hexdigest()!=digest:raise ValueError('MODEL_SHA_MISMATCH')
    options=ort.SessionOptions();options.intra_op_num_threads=threads;options.inter_op_num_threads=1
    if not allow_spinning:
        options.add_session_config_entry('session.intra_op.allow_spinning','0')
        options.add_session_config_entry('session.inter_op.allow_spinning','0')
    options.add_session_config_entry('session.set_denormal_as_zero',str(int(denormal_as_zero)))
    return ort.InferenceSession(data,sess_options=options,providers=['CPUExecutionProvider'])


def validate_io(session, name, shape, outputs):
    inputs=session.get_inputs();actual=session.get_outputs()
    if len(inputs)!=1 or inputs[0].name!=name or inputs[0].type!='tensor(float)' or len(inputs[0].shape)!=4:
        raise ValueError('MODEL_INPUT_CONTRACT_MISMATCH')
    if any(isinstance(a,int) and a!=b for a,b in zip(inputs[0].shape,shape)):
        raise ValueError('MODEL_INPUT_SHAPE_MISMATCH')
    if [(x.name,x.shape,x.type) for x in actual]!=[(n,s,'tensor(float)') for n,s in outputs]:
        raise ValueError('MODEL_OUTPUT_CONTRACT_MISMATCH')


class ScrfdDetector:
    def __init__(self, session, *, score_threshold=.8, nms_threshold=.4):
        if type(score_threshold) not in (float,int) or not 0<=score_threshold<=1 or type(nms_threshold) not in (float,int) or not 0<=nms_threshold<=1:
            raise ValueError('Explicit finite detector thresholds required')
        shapes=[[n,d] for d in (1,4,10) for n in (12800,3200,800)]
        validate_io(session,'input.1',[1,3,640,640],list(zip(DETECTOR_OUTPUTS,shapes)))
        self.session=session
        self.score_threshold,self.nms_threshold=score_threshold,nms_threshold

    def detect(self,image):
        tensor,scale=detector_tensor(image)
        return decode_scrfd(self.session.run(DETECTOR_OUTPUTS,{'input.1':tensor}),size=(640,640),scale=scale,
                            score_threshold=self.score_threshold,nms_threshold=self.nms_threshold)


class R50Recognizer:
    def __init__(self,session):
        validate_io(session,'input',[1,3,112,112],[('embedding',[1,512])])
        self.session=session

    def get_embedding(self,aligned):
        if frame(aligned).shape!=(112,112,3):raise ValueError('Expected aligned 112x112 BGR crop')
        return r50_output(self.session.run(['embedding'],{'input':rgb_tensor(aligned,127.5)})[0])


class ExperimentalPipeline:
    def __init__(self,detector,recognizer,*,denormal_as_zero=False,artifacts_verified=False,reference_contract=None):
        self.detector,self.recognizer=detector,recognizer
        self._contract=copy.deepcopy(BASE_CONTRACT if reference_contract is None else reference_contract)
        self._contract.pop('contract_id',None)
        if self._contract.get('production_approved') is not False or self._contract.get('mode')!='experimental-cpu-only':
            raise ValueError('Reference pipeline cannot approve or activate production')
        self._contract['numeric_mode']='ort-ftz-daz-v1' if denormal_as_zero else 'ort-f32-default-v1'
        self._contract['artifact_binding']='SHA_CHECKED_AT_LOAD' if artifacts_verified else 'UNVERIFIED_INJECTED_PROVIDERS'
        operating_point=(getattr(detector,'score_threshold',.8),getattr(detector,'nms_threshold',.4))
        if operating_point!=(.8,.4) and self._contract.get('detector_operating_point')!=list(operating_point):
            self._contract['detector_operating_point']=list(operating_point)
        self._contract['contract_id']=hashlib.sha256(json.dumps(self._contract,sort_keys=True).encode()).hexdigest()
        self._status=dict(state='NOT_RUN',last_error=None,frames=0)

    @property
    def contract(self):return copy.deepcopy(self._contract)

    @classmethod
    def load(cls,model_dir,*,experimental=False,threads=4,denormal_as_zero=False,detection_threshold=.8):
        if experimental is not True:raise ValueError('Explicit experimental opt-in required: provenance/license UNVERIFIED')
        root=Path(model_dir)
        detector=model_session(root/'det_10g.onnx',DETECTOR_SHA,threads,denormal_as_zero)
        recognizer=model_session(root/'vnceleb_ms1mv3_r50_selected.onnx',RECOGNIZER_SHA,threads,denormal_as_zero)
        return cls(ScrfdDetector(detector,score_threshold=detection_threshold),R50Recognizer(recognizer),denormal_as_zero=denormal_as_zero,artifacts_verified=True)

    def embed(self,image):
        started=time.perf_counter();self._status.update(state='RUNNING',last_error=None)
        try:
            detections=self.detector.detect(frame(image))
            if len(detections)!=1:
                self._status.update(state='NO_FACE' if not detections else 'AMBIGUOUS_FACE_COUNT')
                return None
            vector=normalize(self.recognizer.get_embedding(align_five_points(image,detections[0].landmarks_5)))
            self._status.update(state='EMBEDDING_OK',frames=self._status['frames']+1)
            return vector
        except Exception as exc:
            # Record only exception class, never image, vector, user, path or credentials.
            self._status.update(state='MODEL_OR_INPUT_ERROR',last_error=type(exc).__name__)
            raise
        finally:self._status['last_latency_ms']=(time.perf_counter()-started)*1000

    def diagnostics(self):return dict(self._status,mode='experimental-cpu-only',production_approved=False,contract_id=self._contract['contract_id'])

    def _gallery_entries(self,gallery):
        import re
        if not isinstance(gallery,dict) or gallery.get('contract')!=self._contract:raise ValueError('GALLERY_CONTRACT_MISMATCH: never mix MBF/R50/numeric modes')
        entries=gallery.get('entries')
        if not isinstance(entries,list) or len(entries)>10000:raise ValueError('Invalid gallery')
        codes=[]
        for item in entries:
            if not isinstance(item,dict) or not isinstance(item.get('code'),str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',item['code']):raise ValueError('Invalid experimental identity')
            if not isinstance(item.get('embedding'),list) or any(type(x) not in (float,int) for x in item['embedding']):raise ValueError('Embedding must contain JSON numbers, not strings/booleans')
            codes.append(item['code']);normalize(item['embedding'])
        if len(set(codes))!=len(codes):raise ValueError('Duplicate experimental identity')
        return entries

    def enroll(self,images,code,*,gallery=None):
        import re
        if not isinstance(code,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',code):raise ValueError('Invalid experimental code')
        if not isinstance(images,(list,tuple)) or not 3<=len(images)<=8:raise ValueError('Enrollment requires 3..8 images')
        entries=[] if gallery is None else copy.deepcopy(self._gallery_entries(gallery))
        if len(entries)>=10000 or any(item['code']==code for item in entries):raise ValueError('Gallery full or identity already enrolled; no implicit overwrite')
        vectors=[self.embed(image) for image in images]
        if any(value is None for value in vectors):raise ValueError('Enrollment requires exactly one face in every frame')
        return dict(contract=self.contract,entries=entries+[dict(code=code,embedding=normalized_centroid(vectors).tolist())])

    def match(self,image,gallery,*,threshold,minimum_margin):
        if not np.isfinite(threshold) or not -1<=threshold<=1 or not np.isfinite(minimum_margin) or not 0<=minimum_margin<=2:
            raise ValueError('Explicit finite experimental threshold/margin required; NOT calibrated')
        entries=self._gallery_entries(gallery)
        codes=[item['code'] for item in entries]
        references=[normalize(item['embedding']) for item in entries]
        query=self.embed(image)
        if query is None or not references:return dict(state='UNKNOWN',calibrated=False)
        scores=np.clip(np.array(references)@query,-1.,1.);order=np.argsort(-scores,kind='stable');best=order[0]
        accepted=scores[best]>=threshold and (len(order)==1 or scores[best]-scores[order[1]]>=minimum_margin)
        return dict(state='MATCH' if accepted else 'UNKNOWN',code=codes[best] if accepted else None,
                    score=float(scores[best]),calibrated=False,attendance_written=False)
