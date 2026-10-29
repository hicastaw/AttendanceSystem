"""Explicit CPU/reference tensor contracts, NOT enabled in attendance main.

SCRFD nine-head distances/strides follow the official InsightFace model layout.
Bindings/quantization for Hailo must be verified separately, not guessed here.
"""
import numpy as np
from pipeline import Detection, normalize


def decode_scrfd(outputs, *, size, scale, padding=(0,0), score_threshold=.8, nms_threshold=.4):
    width,height=size
    scale=np.asarray(scale,dtype=np.float64)
    if scale.shape==():scale=np.repeat(scale,2)
    if len(outputs)!=9 or any(type(x) is not int or not 32<=x<=2048 for x in (width,height)) or width%32 or height%32 or scale.shape!=(2,) or not np.isfinite(scale).all() or (scale<=0).any():
        raise ValueError('Expected explicit SCRFD 9-head shape/scale')
    if not 0<=score_threshold<=1 or not 0<=nms_threshold<=1 or np.asarray(padding).shape!=(2,) or not np.isfinite(padding).all():
        raise ValueError('Invalid SCRFD reference transform/threshold')
    candidates=[]
    for i,stride in enumerate((8,16,32)):
        count=(height//stride)*(width//stride)*2
        scores,distances,landmarks=[np.asarray(outputs[i+offset]) for offset in (0,3,6)]
        if [value.shape for value in (scores,distances,landmarks)]!=[(count,1),(count,4),(count,10)] or not all(np.isfinite(x).all() for x in (scores,distances,landmarks)):
            raise ValueError('Unexpected SCRFD output shape/values; no automatic binding')
        # Raw regression is unconstrained (including low-score/background heads).
        # Reject nonfinite values above, not finite negative distance logits.
        if (scores<0).any() or (scores>1).any():raise ValueError('Invalid SCRFD probabilities')
        for index in np.flatnonzero(scores[:,0]>=score_threshold):
            cell=index//2;center=np.array([cell%(width//stride),cell//(width//stride)])*stride
            d=distances[index]*stride
            box=np.r_[center-d[:2],center+d[2:]]
            box=(box-np.tile(padding,2))/np.tile(scale,2)
            points=(landmarks[index].reshape(5,2)*stride+center-padding)/scale
            if box[2]<=box[0] or box[3]<=box[1]:continue
            candidates.append(Detection(tuple(box),points,float(scores[index,0])))
            if len(candidates)>1000:raise ValueError('Reference candidate budget exceeded')
    kept=[]
    for item in sorted(candidates,key=lambda item:-item.score):
        # InsightFace SCRFD uses inclusive-pixel (+1) NMS, in original coordinates.
        box=np.asarray(item.bbox_xyxy);area=np.prod(box[2:]-box[:2]+1)
        overlaps=[]
        for previous in kept:
            other=np.asarray(previous.bbox_xyxy)
            intersection=np.prod(np.maximum(0,np.minimum(box[2:],other[2:])-np.maximum(box[:2],other[:2])+1))
            overlaps.append(intersection/(area+np.prod(other[2:]-other[:2]+1)-intersection))
        if all(value<=nms_threshold for value in overlaps):kept.append(item)
    return kept


def r50_output(value):
    """Validate output only. Preprocessing/provenance are NOT inferred from its filename."""
    value=np.asarray(value)
    if value.shape!=(1,512):raise ValueError('Expected explicit ArcFace output (1,512)')
    return normalize(value[0])
