"""Hardware-independent contracts for SCRFD -> five-point alignment -> R50.

No model artifacts or Hailo outputs are invented here. Legacy affine3 stays
unchanged; this alignment requires a new alignment_id and re-enrollment.
"""
from collections import deque
from dataclasses import dataclass
import time
from typing import Protocol
import numpy as np

TARGET = np.array([[38.2946,51.6963],[73.5318,51.5014],[56.0252,71.7366],
                   [41.5493,92.3655],[70.7299,92.2041]], dtype=np.float64)


class CameraProvider(Protocol):
    def read(self): ...  # (ok, owned BGR frame); one camera owner
    def release(self): ...


@dataclass(frozen=True)
class Detection:
    bbox_xyxy: tuple
    landmarks_5: np.ndarray  # pixel coordinates in ORIGINAL frame, left/right eyes, nose, mouth
    score: float


class DetectorProvider(Protocol):
    def detect(self, frame) -> list[Detection]: ...


class RecognizerProvider(Protocol):
    contract: dict
    def get_embedding(self, aligned_face_bgr) -> np.ndarray: ...


def normalize(vector):
    value = np.asarray(vector, dtype=np.float64)
    if value.shape != (512,) or not np.isfinite(value).all():
        raise ValueError('Expected finite 512-D embedding')
    norm = np.linalg.norm(value)
    if not np.isfinite(norm) or norm < 1e-8:
        raise ValueError('Zero/invalid embedding')
    return value if abs(norm-1.0)<1e-12 else value / norm


def normalized_centroid(embeddings):
    values = np.asarray(embeddings)
    if values.ndim != 2 or not len(values):
        raise ValueError('Need at least one embedding')
    return normalize(np.mean([normalize(v) for v in values], axis=0))


def inverse_letterbox(points, *, scale, padding):
    value = np.asarray(points, dtype=np.float64)
    if value.shape[-1] != 2 or not np.isfinite(value).all() or not np.isfinite(scale) or scale <= 0:
        raise ValueError('Invalid coordinate transform')
    return (value - np.asarray(padding)) / scale


def similarity_transform(landmarks):
    source = np.asarray(landmarks, dtype=np.float64)
    if source.shape != (5,2) or not np.isfinite(source).all() or np.linalg.matrix_rank(source-source.mean(axis=0))<2:
        raise ValueError('Invalid/degenerate five-point landmarks')
    # Least-squares similarity over ALL five points: no shear or reflection.
    x,y=source.T
    design=np.zeros((10,4)); design[0::2]=np.column_stack([x,-y,np.ones(5),np.zeros(5)])
    design[1::2]=np.column_stack([y,x,np.zeros(5),np.ones(5)])
    a,b,tx,ty=np.linalg.lstsq(design,TARGET.reshape(-1),rcond=None)[0]
    if not np.isfinite([a,b,tx,ty]).all() or np.hypot(a,b)<1e-8:
        raise ValueError('Invalid alignment transform')
    return np.array([[a,-b,tx],[b,a,ty]])


def align_five_points(image_bgr, landmarks):
    import cv2
    return cv2.warpAffine(image_bgr, similarity_transform(landmarks), (112,112))


class Consensus:
    """Bounded votes for a caller-owned track; invalidate on gallery/model change.

    Caller must clear a lost/ambiguous track. Default age is a software setting,
    not a claim about calibrated recognition accuracy.
    """
    def __init__(self, required=3, window=5, max_age=2, clock=None):
        if not 1 <= required <= window:
            raise ValueError('Invalid consensus window')
        self.required,self.window,self.max_age=required,window,max_age
        self.clock=clock or time.monotonic
        self.votes=deque(maxlen=window);self.key=None;self.last=None

    def reset(self):
        self.votes.clear();self.key=None;self.last=None

    def observe(self, code, *, track='single', version=None):
        now=self.clock();key=(track,version)
        if self.key!=key or self.last is None or now-self.last>self.max_age:
            self.votes.clear()
        self.key,self.last=key,now
        self.votes.append(code)
        return code is not None and self.votes.count(code)>=self.required


def recognition_confirmed(match, consensus, *, version=None, single_frame=False):
    """Confirm a thresholded match; isolated laptop runs use one frame, live uses votes."""
    if single_frame:
        return match is not None
    if match is None:
        consensus.observe(None, version=version)
        return False
    return consensus.observe(match[0]['user_code'], version=version)
