"""Explicit synthetic worker using REAL gallery, matching, outbox and HTTP code.

No camera or model is loaded. Never falls back from a production failure.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
import logging
from pathlib import Path
import signal
import sys
import time
import uuid

import numpy as np
import requests

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'AIOT/edge'))
from api_client import ApiClient
from attendance_service import AttendanceDecision
from member_gallery import MemberGallery
from model_contract import MOCK_CONTRACT
from pipeline import Consensus
from worker_status import WorkerStatus


def recognize_once(client, gallery, decision, publisher, scenario, *, code='DEMO001', stamp=None):
    if scenario in ('camera_unavailable','model_unavailable','idle'):
        publisher.update(scenario,camera_ok=scenario!='camera_unavailable',model_ok=scenario!='model_unavailable')
        return None
    publisher.update('evaluating')
    if scenario=='unknown':
        query=np.zeros(512);query[-1]=1
    else:
        entry=next((entry for entry in gallery.entries if entry['user_code']==code),None)
        if entry is None:
            publisher.update('unknown');return None
        query=entry['embedding']
    consensus=Consensus()
    result=decision.match(query,gallery.entries)
    for _ in range(3):
        stable=consensus.observe(result[0]['user_code'] if result else None,version=gallery.version)
    if not stable:
        publisher.update('unknown');return None
    entry,score=result
    if decision.should_send(entry['user_code']):
        event=decision.build_checkin_event('MOCK_LAPTOP',entry['user_code'],score)
        if stamp:
            event['timestamp']=stamp
            event['event_id']=str(uuid.uuid5(uuid.NAMESPACE_URL,'aiot-mock:'+code+':'+stamp))
        key=decision.context_for(event['timestamp'])['occurrence_key'] or '__outside__'
        client.send_event_async(event,attendance_key=key)
    row=client.outbox.latest_for(entry['user_code'],decision.current_key())
    publisher.update('pending',event_id=row['event_id'] if row else client.outbox.confirmed_event_id(entry['user_code'],decision.current_key()))
    return row['event_id'] if row else None


def main():
    logging.basicConfig(level=logging.INFO,format='%(levelname)s %(name)s: %(message)s')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime',type=Path,required=True)
    parser.add_argument('--scenario',choices=['known','unknown','idle','camera_unavailable','model_unavailable'],default='known')
    parser.add_argument('--code',default='DEMO001')
    parser.add_argument('--timestamp')
    parser.add_argument('--watch',action='store_true')
    args=parser.parse_args()
    settings=json.loads(args.runtime.read_text(encoding='utf-8'))
    if settings.get('mode')!='mock':raise ValueError('Not a mock runtime')
    health=requests.get(settings['url']+'/api/health',timeout=3).json()
    if health.get('mode')!='mock':raise ValueError('Refusing to send synthetic data to production')
    logging.info('Synthetic worker connected to isolated mock backend')
    base=args.runtime.resolve().parent
    # Existing outbox has device binding; dedicated MOCK device and path.
    client=ApiClient(settings['url'],settings['key'],outbox_path=base/'mock-outbox.db')
    gallery=MemberGallery(base/'mock-gallery.json',source=settings['url'],contract=MOCK_CONTRACT,allow_legacy=False)
    publisher=WorkerStatus(settings['url'],settings['key'],MOCK_CONTRACT,mode='mock')
    now=(lambda:datetime.fromisoformat(args.timestamp)) if args.timestamp else lambda:datetime.now(timezone(timedelta(hours=7)))
    decision=AttendanceDecision(outbox=client.outbox,now=now,minimum_margin=.05)
    stopped=False
    def stop(*_):
        nonlocal stopped
        stopped=True
    signal.signal(signal.SIGINT,stop);signal.signal(signal.SIGTERM,stop)
    client.start();publisher.start()
    cycle=['idle','known','unknown','camera_unavailable','model_unavailable','known'] if args.watch else [args.scenario]
    try:
        step=0
        while not stopped:
            gallery.refresh(client);client.sync_attendance_policy(decision)
            recognize_once(client,gallery,decision,publisher,cycle[step%len(cycle)],code=args.code,stamp=args.timestamp)
            for _ in range(40):
                if stopped:break
                time.sleep(.1)
            step+=1
            if not args.watch:break
    finally:
        publisher.stop();client.stop()


if __name__=='__main__':main()
