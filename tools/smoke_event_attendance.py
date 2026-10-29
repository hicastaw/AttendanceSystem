"""Harness-only, real HTTP/process restart/temporary ledger. Never imports config."""
from datetime import datetime
import os
from pathlib import Path
import sys
from urllib.parse import urlparse

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'AIOT/edge'))
from attendance_service import AttendanceDecision
from api_client import ApiClient
from outbox import DurableOutbox


def main():
    phase,url,database=sys.argv[1:]
    path=Path(database).resolve()
    if urlparse(url).hostname!='127.0.0.1' or path.parent!=Path.cwd().resolve() or path.name!='event-attendance-smoke.db':
        raise ValueError('Only localhost/harness temporary ledger allowed')
    times={'morning':'2026-10-12T08:00:00+07:00','restart':'2026-10-12T09:00:00+07:00',
           'fresh-ledger':'2026-10-12T10:00:00+07:00','afternoon':'2026-10-12T13:00:00+07:00',
           'outside':'2026-10-12T18:00:00+07:00'}
    now=datetime.fromisoformat(times[phase])
    if phase=='fresh-ledger': path=path.with_name('fresh-event-ledger.db')
    # Deterministic deadline reconstruction, no sleeping/model/camera.
    store=DurableOutbox(path,clock=lambda:now.timestamp(),monotonic=lambda:now.timestamp())
    client=ApiClient(url,device_key=os.environ['OUTBOX_SMOKE_KEY'],outbox=store)
    decision=AttendanceDecision(outbox=store,now=lambda:now)
    try:
        assert client.sync_attendance_policy(decision)
        if phase in ('restart','fresh-ledger'):
            assert not decision.should_send('TEST001')
            assert decision.delivery_status('TEST001')=='confirmed'
            assert store.counts()['pending']==0
            print(f'PASS: {phase}, same event attendance not generated again')
            return
        assert decision.should_send('TEST001')
        event=decision.build_checkin_event('EVENT_SMOKE','TEST001',.8)
        context=decision.context_for(event['timestamp'])
        assert client.send_event_async(event,attendance_key=context['occurrence_key'] or '__outside__')=='queued'
        assert client.run_once()
        row=store.get(event['event_id']);assert row['status']=='acked'
        assert row['event']['timestamp']==times[phase] and row['event']['event_type']=='check_in'
        if phase!='outside':
            assert row['attendance_key']==context['occurrence_key']
            assert not decision.should_send('TEST001')
        else: assert row['attendance_key']=='__outside__'
        print(f'PASS: real HTTP {phase}, timestamp retained, ACK/context persisted')
    finally: client.stop()


if __name__=='__main__': main()
