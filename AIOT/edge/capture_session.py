"""Bounded in-memory enrollment; only the existing camera owner feeds samples.

No camera, image persistence, matching-threshold changes or new embedding space.
Admin must review/confirm the subject before the backend saves the centroid.
"""
import re
import copy
import threading
import time
import uuid
from pipeline import normalize, normalized_centroid
from model_contract import LEGACY_CONTRACT

_ANY_SESSION = object()


class SampleRejected(Exception):
    """Expected enrollment quality rejection, not a model/transport failure."""

    def __init__(self, reason='image_blurry'):
        super().__init__(reason)
        aliases = {'Blurry crop': 'image_blurry', 'Blurry': 'image_blurry'}
        reason = aliases.get(reason, reason)
        self.reason = reason if reason in ('image_blurry', 'stale_frame', 'no_face', 'multiple_faces',
                                           'invalid_landmarks', 'alignment_failed', 'embedding_failed') else 'image_blurry'


class CaptureSession:
    def __init__(self, *, clock=None, contract=None, deadline_seconds=30, max_sample_gap_seconds=1, allow_single_image=False):
        from member_gallery import validate_contract
        self.contract = validate_contract(LEGACY_CONTRACT if contract is None else contract)
        self.clock = clock or time.monotonic
        if (type(deadline_seconds) not in (int,float) or not 1 <= deadline_seconds <= 300 or
                type(max_sample_gap_seconds) not in (int,float) or not .1 <= max_sample_gap_seconds <= 60):
            raise ValueError('Invalid capture session timing policy')
        self.deadline_seconds=float(deadline_seconds)
        self.max_sample_gap_seconds=float(max_sample_gap_seconds)
        self.lock = threading.RLock()
        self.value = None
        self.samples = []
        self.last_sample = None
        self.allow_single_image = allow_single_image is True
        self.pending_image = None
        self.preview_bytes = None

    def _clear(self):
        if self.pending_image is not None:self.pending_image.fill(0)
        self.value, self.samples, self.last_sample = None, [], None
        self.pending_image, self.preview_bytes = None, None

    def _expire(self):
        if self.value and self.clock() >= self.value['deadline']:
            self._clear()

    def start(self, code, contract, frames=5, *, source='camera'):
        if not isinstance(code,str) or not re.fullmatch(r'[A-Z0-9_-]{1,64}', code) or contract != self.contract:
            raise ValueError('Invalid capture identity/contract')
        if type(frames) is not int or not (3 <= frames <= 8 or self.allow_single_image and frames == 1):
            raise ValueError('Capture requires 3..8 samples')
        if source not in ('camera', 'upload') or source == 'upload' and (not self.allow_single_image or frames != 1):
            raise ValueError('Invalid capture source')
        with self.lock:
            self._expire()
            if self.value:
                raise FileExistsError('Camera enrollment already active')
            self.value = dict(session_id=uuid.uuid4().hex,user_code=code,state='queued',
                              required=frames,deadline=self.clock()+self.deadline_seconds,embedding_contract=copy.deepcopy(contract))
            self.samples, self.last_sample = [], None
            self.pending_image, self.preview_bytes = None, None
            if self.allow_single_image:self.value['source'] = source
            return self.status(self.value['session_id'])

    def attach_upload(self, session_id, image):
        with self.lock:
            self.status(session_id)
            if self.value.get('source') != 'upload' or self.pending_image is not None:
                raise ValueError('Invalid upload session')
            self.pending_image = image

    def start_upload(self, code, contract, image):
        with self.lock:
            value = self.start(code, contract, 1, source='upload')
            self.attach_upload(value['session_id'], image)
            return value

    def take_upload(self):
        with self.lock:
            self._expire()
            if not self.value or self.value.get('source') != 'upload' or self.pending_image is None:
                return None
            image, self.pending_image = self.pending_image, None
            return self.value['session_id'], image

    def preview(self, session_id):
        with self.lock:
            value = self.status(session_id)
            if value['state'] != 'ready' or not self.preview_bytes:
                raise BlockingIOError('Validated preview not ready')
            return self.preview_bytes

    def reject(self, session_id, reason):
        with self.lock:
            self._expire()
            if self.value and self.value['session_id'] == session_id:
                self.samples, self.last_sample, self.preview_bytes = [], None, None
                self.value.update(state='rejected' if self.value.get('source') == 'upload' else 'capturing', reason=reason)

    def status(self, session_id, *, result=False):
        with self.lock:
            self._expire()
            if not self.value or self.value['session_id'] != session_id:
                raise FileNotFoundError('Capture expired or unavailable')
            value = copy.deepcopy({k:v for k,v in self.value.items() if k != 'deadline'})
            value.update(samples=len(self.samples),remaining_seconds=max(0,self.value['deadline']-self.clock()))
            if result and value['state']=='ready':
                value['embedding'] = normalized_centroid(self.samples).tolist()
            return value

    def cancel(self, session_id):
        with self.lock:
            self.status(session_id)
            self._clear()

    def reject_stale_frame(self, session_id):
        """Camera-owner rejection before embedding; completed samples stay ready."""
        with self.lock:
            self._expire()
            if (self.value and self.value['session_id'] == session_id and self.value.get('source','camera') == 'camera'
                    and self.value['state'] != 'ready'):
                self.samples, self.last_sample = [], None
                self.value.update(state='capturing', reason='stale_frame')

    def observe(self, faces, embed, *, source='camera', session_id=_ANY_SESSION, preview=None):
        """Called exclusively by worker main, NOT by Flask request threads."""
        with self.lock:
            self._expire()
            if not self.value:
                return False
            if self.value.get('source', 'camera') != source or session_id is not _ANY_SESSION and self.value['session_id'] != session_id:
                return True
            if self.value['state'] in ('ready', 'rejected'):
                return True  # Pause attendance until explicit commit/cancel/expiry.
            self.value['state']='capturing'  # Only camera owner acknowledges activation.
            now = self.clock()
            if len(faces)!=1:
                self.samples, self.last_sample = [], None
                self.value['reason'] = 'no_face' if not len(faces) else 'multiple_faces'
                if source == 'upload':self.value['state'] = 'rejected'
                return True
            if self.last_sample is not None and now-self.last_sample < .2:
                return True
            if self.last_sample is not None and now-self.last_sample > self.max_sample_gap_seconds:
                self.samples=[]
            session_id = self.value['session_id']

        # Model inference can take seconds. Do not block status/cancel/expiry on
        # it; only the camera owner calls observe. Never retain the frame/crop.
        try:
            sample = normalize(embed(faces[0]))
        except SampleRejected as error:
            self.reject(session_id, error.reason)
            return True
        except ValueError:
            if not self.allow_single_image:raise
            self.reject(session_id, 'embedding_failed')
            return True

        with self.lock:
            self._expire()
            # Cancellation, expiration or a different session may have happened
            # while the camera owner was computing the embedding.
            if not self.value or self.value['session_id'] != session_id or self.value['state'] != 'capturing':
                return True
            self.value.pop('reason',None)
            self.samples.append(sample)
            self.last_sample = now
            if len(self.samples) >= self.value['required']:
                normalized_centroid(self.samples)  # Reject cancellation/zero result.
                self.value['state'] = 'ready'
                self.preview_bytes = preview
            return True
