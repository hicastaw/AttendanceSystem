"""Descriptor-bound ONNX CPU providers. No production activation or filename inference.

The descriptor records *asserted* preprocessing/lineage; a matching SHA does not
verify those assertions. A supplied iResNet50 needs independently reviewed evidence.
"""
import copy
import hashlib
import json
from pathlib import Path
import re

import cv2
import numpy as np
from experimental_cpu import ExperimentalPipeline, frame, model_session
from reference_adapters import decode_scrfd, r50_output

ALIGNMENT = 'arcface112-five-point-lstsq-linear-zero-border-v1'


def _number(value):
    return type(value) in (int, float) and np.isfinite(value)


def validate_descriptor(value):
    if not isinstance(value, dict) or type(value.get('schema')) is not int or value['schema'] != 1 or value.get('production_approved') is not False:
        raise ValueError('Unactivated CPU descriptor schema 1 required')
    for key in ('model_version', 'family_assertion', 'provenance', 'training', 'export', 'license', 'preprocessing_evidence'):
        if not isinstance(value.get(key), str) or not value[key].strip():
            raise ValueError('Missing descriptor evidence/status: ' + key)
    if value.get('alignment_id') != ALIGNMENT:
        raise ValueError('Unsupported five-point alignment contract')
    if type(value.get('ftz', False)) is not bool:
        raise ValueError('FTZ/DAZ requires explicit boolean opt-in')
    for role, size in (('detector', 640), ('recognizer', 112)):
        spec = value.get(role)
        if not isinstance(spec, dict) or not isinstance(spec.get('path'), str) or not spec['path']:
            raise ValueError('Explicit ONNX path required')
        if not isinstance(spec.get('sha256'), str) or not re.fullmatch('[a-f0-9]{64}', spec['sha256']):
            raise ValueError('Explicit model SHA-256 required')
        if not isinstance(spec.get('input'), str) or not spec['input']:
            raise ValueError('Explicit input name required')
        if spec.get('shape') != [1, 3, size, size] or spec.get('layout') != 'NCHW' or spec.get('color') not in ('RGB', 'BGR'):
            raise ValueError('Unsupported model input contract')
        for key in ('mean', 'std'):
            numbers = spec.get(key)
            if not isinstance(numbers, list) or len(numbers) != 3 or not all(_number(x) for x in numbers):
                raise ValueError('Explicit finite channel normalization required')
            if key == 'std' and any(x <= 0 for x in numbers):
                raise ValueError('Standard deviation must be positive')
        outputs = spec.get('outputs')
        if not isinstance(outputs, list) or len(outputs) != (9 if role == 'detector' else 1):
            raise ValueError('Explicit ordered output bindings required')
        if any(not isinstance(x, dict) or set(x) != {'name', 'shape'} or not isinstance(x['name'], str) or not x['name'] for x in outputs):
            raise ValueError('Invalid output bindings')
        if len({x['name'] for x in outputs}) != len(outputs):
            raise ValueError('Duplicate output bindings')
        if role == 'recognizer' and outputs[0]['shape'] != [1, 512]:
            raise ValueError('Expected batch-one 512-D recognition output')
        if role == 'detector':
            shapes = [[n, d] for d in (1, 4, 10) for n in (12800, 3200, 800)]
            actual = [x['shape'] for x in outputs]
            if actual not in (shapes, [[1] + s for s in shapes]):
                raise ValueError('Expected SCRFD strides 8/16/32, two anchors, score/bbox/5kps heads')
    for key in ('detection_threshold', 'nms_threshold'):
        if not _number(value.get(key)) or not 0 <= value[key] <= 1:
            raise ValueError('Explicit detector operating point required')
    return copy.deepcopy(value)


def tensor(image, spec):
    image = frame(image)
    if image.shape != (spec['shape'][2], spec['shape'][3], 3):
        raise ValueError('Input image shape mismatch')
    channels = image[:, :, ::-1] if spec['color'] == 'RGB' else image
    array = (channels.astype(np.float32) - np.asarray(spec['mean'], np.float32)) / np.asarray(spec['std'], np.float32)
    return np.ascontiguousarray(array.transpose(2, 0, 1)[None])


def checked_session(spec, base, threads, ftz):
    session = model_session(Path(base) / spec['path'], spec['sha256'], threads, ftz, allow_spinning=False)
    inputs = session.get_inputs()
    if len(inputs) != 1 or inputs[0].name != spec['input'] or inputs[0].type != 'tensor(float)' or len(inputs[0].shape) != 4:
        raise ValueError('MODEL_INPUT_CONTRACT_MISMATCH')
    if any(isinstance(a, int) and a != b for a, b in zip(inputs[0].shape, spec['shape'])):
        raise ValueError('MODEL_INPUT_SHAPE_MISMATCH')
    actual = session.get_outputs()
    if len(actual) != len(spec['outputs']):raise ValueError('MODEL_OUTPUT_CONTRACT_MISMATCH')
    for output, expected in zip(actual, spec['outputs']):
        shape = output.shape
        if output.name != expected['name'] or output.type != 'tensor(float)' or len(shape) != len(expected['shape']):
            raise ValueError('MODEL_OUTPUT_CONTRACT_MISMATCH')
        # Dynamic leading batch is common in iResNet exports. ONLY that axis may
        # be symbolic; the actual batch-one runtime tensor is validated again.
        if any(a != b and not (i == 0 and b == 1 and not isinstance(a, int))
               for i, (a, b) in enumerate(zip(shape, expected['shape']))):
            raise ValueError('MODEL_OUTPUT_CONTRACT_MISMATCH')
    return session


class DescriptorRecognizer:
    def __init__(self, session, spec):
        self.session, self.spec = session, copy.deepcopy(spec)

    def get_embedding(self, aligned):
        value = self.session.run([self.spec['outputs'][0]['name']], {self.spec['input']: tensor(aligned, self.spec)})[0]
        return r50_output(value)


class DescriptorDetector:
    def __init__(self, session, spec, score, nms):
        self.session, self.spec = session, copy.deepcopy(spec)
        self.score_threshold, self.nms_threshold = score, nms

    def detect(self, image):
        image = frame(image)
        h, w = image.shape[:2]
        ratio = min(640 / w, 640 / h)
        rw, rh = max(1, int(w * ratio)), max(1, int(h * ratio))
        canvas = np.zeros((640, 640, 3), np.uint8)
        canvas[:rh, :rw] = cv2.resize(image, (rw, rh), interpolation=cv2.INTER_LINEAR)
        outputs = self.spec['outputs']
        heads = self.session.run([x['name'] for x in outputs], {self.spec['input']: tensor(canvas, self.spec)})
        if any(list(head.shape) != spec['shape'] for head, spec in zip(heads, outputs)):
            raise ValueError('SCRFD_RUNTIME_OUTPUT_MISMATCH')
        if len(outputs[0]['shape']) == 3:
            heads = [head[0] for head in heads]
        return decode_scrfd(heads, size=(640, 640), scale=(rw / w, rh / h),
                            score_threshold=self.score_threshold, nms_threshold=self.nms_threshold)


def descriptor_contract(descriptor):
    descriptor = validate_descriptor(descriptor)
    # Installation paths and thread count do not define the embedding space.
    bindings = {role: {k: v for k, v in descriptor[role].items() if k != 'path'} for role in ('detector', 'recognizer')}
    # JS/SQLite HTTP round trips serialize 128.0 as 128. Canonicalize integral
    # normalization values BEFORE hashing; never change historical contracts.
    def json_numbers(value):
        if isinstance(value, dict):return {k: json_numbers(v) for k, v in value.items()}
        if isinstance(value, list):return [json_numbers(v) for v in value]
        if type(value) is float and value.is_integer():return int(value)
        return value
    bindings = json_numbers(bindings)
    contract = dict(schema=2, mode='experimental-cpu-only', production_approved=False, dimension=512,
                    model_id='cpu-r50-' + descriptor['recognizer']['sha256'][:16], model_version=descriptor['model_version'],
                    detector_sha256=descriptor['detector']['sha256'], recognizer_sha256=descriptor['recognizer']['sha256'],
                    preprocess_id='descriptor-channel-normalization-v1', alignment_id=ALIGNMENT,
                    numeric_mode='ort-ftz-daz-v1' if descriptor.get('ftz', False) else 'ort-f32-default-v1',
                    artifact_binding='SHA_CHECKED_AT_LOAD', tensor_bindings=bindings,
                    detector_operating_point=json_numbers([descriptor['detection_threshold'], descriptor['nms_threshold']]),
                    normalization='l2-f64-centroid-of-unit-vectors',
                    evidence={k: descriptor[k] for k in ('family_assertion', 'provenance', 'training', 'export', 'license', 'preprocessing_evidence')})
    from integration_gate import candidate_contract_id
    contract['contract_id'] = candidate_contract_id(contract)
    return contract


def load_descriptor(path, *, experimental=False, threads=4):
    if experimental is not True:
        raise ValueError('Explicit isolated experimental opt-in required')
    path = Path(path).resolve()
    if path.stat().st_size > 128 * 1024:
        raise ValueError('Descriptor too large')
    descriptor = validate_descriptor(json.loads(path.read_text(encoding='utf-8')))
    ftz = descriptor.get('ftz', False)
    detector = DescriptorDetector(checked_session(descriptor['detector'], path.parent, threads, ftz), descriptor['detector'],
                                  descriptor['detection_threshold'], descriptor['nms_threshold'])
    recognizer = DescriptorRecognizer(checked_session(descriptor['recognizer'], path.parent, threads, ftz), descriptor['recognizer'])
    return ExperimentalPipeline(detector, recognizer, denormal_as_zero=ftz, artifacts_verified=True,
                                reference_contract=descriptor_contract(descriptor))
