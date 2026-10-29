"""Coalesced status heartbeat, separate from durable attendance transport."""
import threading
import requests
import logging
import time
import uuid


class WorkerStatus:
    def __init__(self, base_url, key, contract, *, mode='production', health=None, clock=time.monotonic):
        self.url=base_url.rstrip('/')+'/api/worker-state'
        self.contract,self.mode=contract,mode
        self.health = health
        self.clock = clock
        self.event_expires_at = 0.
        self.source = str(uuid.uuid4())
        self.sequence = 0
        self.revision = 0
        self.session=requests.Session()
        try:
            self.session.headers['X-Device-Key']=key
            self.lock=threading.Lock();self.publish_lock=threading.Lock();self.stop_event=threading.Event()
            self.value={'state':'idle','camera_ok':False,'model_ok':False}
            self.thread=threading.Thread(target=self._run,daemon=True,name='worker-status')
        except BaseException:
            self.session.close()
            raise

    def update(self, state, *, camera_ok=True, model_ok=True, event_id=None, clear_event=False):
        with self.lock:
            self.revision += 1
            # Keep the latest completed match through the next single-face
            # inference. It is still pending: only Express can confirm a row.
            if (state == 'evaluating' and not clear_event and camera_ok and model_ok
                    and self.value.get('event_id') and self.clock() < self.event_expires_at):
                state, event_id = 'pending', self.value['event_id']
            elif state == 'pending' and event_id:
                self.event_expires_at = self.clock() + 5.
            else:
                self.event_expires_at = 0.
            self.value=dict(state=state,camera_ok=camera_ok,model_ok=model_ok,event_id=event_id)

    def publish(self):
        # Startup/fault flushes can overlap the periodic thread. Take snapshots
        # inside this lock so an older request cannot overtake a newer one.
        with self.publish_lock:
            return self._publish()

    def _publish(self):
        with self.lock:
            if self.value.get('event_id') and self.clock() >= self.event_expires_at:
                self.value.update(state='evaluating', event_id=None)
            body=dict(self.value,mode=self.mode,embedding_contract=self.contract)
            revision = self.revision
            self.sequence += 1
            body.update(status_source=self.source, status_sequence=self.sequence)
        if self.health is not None:
            health = self.health()
            body.update(camera_ok=health['camera_opened'], model_ok=health['model_loaded'],
                        pipeline_ready=health['ready'], frame_age_seconds=health['frame_age_seconds'])
            if not health['ready']:
                with self.lock:
                    # Do not revive an old event on recovery. A concurrently
                    # completed newer match belongs to the next heartbeat.
                    if self.revision == revision:
                        self.value.update(event_id=None)
                        self.event_expires_at = 0.
                body['event_id'] = None
                body['state'] = ('storage_error' if not health['storage_ok'] else
                    'model_unavailable' if health['error']=='model_unavailable' else
                    'camera_unavailable' if not health['camera_opened'] or not health['frame_fresh']
                    else 'model_unavailable')
        try:
            response=self.session.post(self.url,json=body,timeout=2,allow_redirects=False)
            if not response.ok:logging.getLogger(__name__).warning('Worker heartbeat rejected: HTTP %s',response.status_code)
            return response.ok
        except requests.RequestException:
            return False

    def _run(self):
        while not self.stop_event.is_set():
            self.publish();self.stop_event.wait(.75)

    def start(self):
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread.ident is not None:self.thread.join(3)
        if not self.thread.is_alive():self.session.close()
        return not self.thread.is_alive()
