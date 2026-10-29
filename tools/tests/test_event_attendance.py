"""Event policy/ledger/HTTP boundaries: synthetic identities and temporary DBs."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime
import json
from pathlib import Path
import sqlite3
import subprocess
import unittest
from unittest.mock import Mock

import numpy as np
import requests
from attendance_test_support import ROOT, attendance
from attendance_schedule import DEFAULT_EVENTS, OUTSIDE_KEY, resolve_context, validate_events
from outbox import DurableOutbox
from test_outbox_delivery import DeliveryFixture, ack


class CalendarTests(unittest.TestCase):
    def test_boundaries_weekdays_utc_and_sunday(self):
        samples = [('2026-10-12T06:59:59+07:00',None),('2026-10-12T07:00:00+07:00','default-morning'),
                   ('2026-10-12T11:59:59+07:00','default-morning'),('2026-10-12T12:00:00+07:00',None),
                   ('2026-10-12T12:59:59+07:00',None),('2026-10-12T13:00:00+07:00','default-afternoon'),
                   ('2026-10-12T17:59:59+07:00','default-afternoon'),('2026-10-12T18:00:00+07:00',None),
                   ('2026-10-10T08:00:00+07:00','default-morning'),('2026-10-11T08:00:00+07:00',None),
                   ('2026-10-12T00:00:00Z','default-morning'),('2026-10-11T23:59:59Z',None)]
        for stamp, expected in samples:
            with self.subTest(stamp=stamp):
                self.assertEqual(resolve_context(stamp,DEFAULT_EVENTS)['scheduled_event_id'],expected)

    def test_oneoff_date_does_not_repeat_next_day(self):
        event = dict(schedule_id='meeting',name='Meeting',start_time='19:00',end_time='20:00',
                     weekdays=[],date='2026-10-12',active=True)
        events=validate_events([event])
        self.assertEqual(resolve_context('2026-10-12T19:00:00+07:00',events)['occurrence_key'],'meeting:2026-10-12')
        self.assertIsNone(resolve_context('2026-10-13T19:00:00+07:00',events)['occurrence_key'])

    def test_invalid_and_overlapping_schedules_rejected(self):
        base=DEFAULT_EVENTS[0]
        invalid=[{**base,'end_time':'06:00'},{**base,'start_time':'24:00'},{**base,'date':'2026-02-30'},
                 {**base,'weekdays':[True]},{**base,'active':1},{**base,'schedule_id':'bad:id'}]
        for value in invalid:
            with self.subTest(value=value),self.assertRaises(ValueError): validate_events([value])
        with self.assertRaises(ValueError): validate_events([base,{**base,'schedule_id':'other'}])
        with self.assertRaises(ValueError): validate_events([base,{**base,'schedule_id':'dated','date':'2026-10-12'}])
        self.assertEqual(len(validate_events([base,{**base,'schedule_id':'off','active':False}])),2)

    def test_naive_timestamps_rejected(self):
        with self.assertRaises(ValueError): resolve_context('2026-10-12T08:00:00',DEFAULT_EVENTS)
        with self.assertRaises(ValueError): attendance.AttendanceDecision.build_event('D','U','check_in',.8,timestamp=datetime(2026,10,12,8))

    def test_python_node_calendar_parity(self):
        stamps=[f'2026-10-{day:02}T{hour:02}:00:00+07:00' for day in (10,11,12,13) for hour in (0,6,7,11,12,13,17,18,23)]
        stamps+=['2026-10-11T23:59:59Z','2026-10-12T00:00:00Z']
        script="import {resolveContext,defaults} from './AIOT/server/src/attendance-schedule.js'; console.log(JSON.stringify(JSON.parse(process.argv[1]).map(s=>resolveContext(s,defaults))));"
        child=subprocess.run(['node','--input-type=module','-e',script,json.dumps(stamps)],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=10)
        self.assertEqual(child.returncode,0,child.stderr)
        self.assertEqual(json.loads(child.stdout),[resolve_context(s,DEFAULT_EVENTS) for s in stamps])


class EventDeliveryTests(DeliveryFixture):
    def acknowledge(self,event,context=None):
        response=ack(event)
        if context is not None: response.json.return_value['attendance_context']=context
        self.client._send_session.post.side_effect=None
        self.client._send_session.post.return_value=response
        self.assertTrue(self.client.run_once())

    def set_time(self,stamp):
        self.civil_time=datetime.fromisoformat(stamp)

    def test_long_standing_same_occurrence_one_checkin(self):
        event=self.dispatch()['event'];self.acknowledge(event)
        self.now+=3600
        self.set_time('2026-10-10T11:59:59+07:00')
        ns=self.dispatch()
        self.assertEqual(ns['att_status'],'confirmed')
        self.assertEqual(self.store.counts(),dict(pending=0,blocked=0,acked=1))
        self.assertEqual(self.decision.next_event_type('TEST001'),'check_in')

    def test_afternoon_new_occurrence_even_morning_still_pending(self):
        first=self.dispatch()['event']
        self.set_time('2026-10-10T13:00:00+07:00')
        second=self.dispatch()['event']
        self.assertNotEqual(first['event_id'],second['event_id'])
        self.assertEqual(self.store.counts()['pending'],2)
        self.assertEqual(self.store.next_due()['event'],first)
        self.assertIsNone(self.store.state('TEST001'))
        self.assertEqual(self.dispatch()['att_status'],'pending')
        self.assertEqual(self.store.counts()['pending'],2)

    def test_new_day_gets_distinct_occurrence(self):
        event=self.dispatch()['event'];self.acknowledge(event)
        self.set_time('2026-10-12T08:00:00+07:00')
        self.assertTrue(self.decision.should_send('TEST001'))
        self.assertEqual(self.dispatch()['event']['event_type'],'check_in')

    def test_outside_saves_timestamp_and_null_context(self):
        self.set_time('2026-10-10T12:00:00+07:00')
        event=self.dispatch()['event']
        self.assertEqual(event['timestamp'],'2026-10-10T12:00:00+07:00')
        self.assertIsNone(self.decision.context_for(event['timestamp'])['occurrence_key'])
        self.assertEqual(self.store.get(event['event_id'])['attendance_key'],OUTSIDE_KEY)
        self.acknowledge(event)
        self.assertEqual(self.decision.delivery_status('TEST001'),'cooldown')
        self.now+=59.999;self.assertFalse(self.decision.should_send('TEST001'))
        self.now+=.001;self.assertTrue(self.decision.should_send('TEST001'))

    def test_sunday_still_checkin_unassigned(self):
        self.set_time('2026-10-11T08:00:00+07:00')
        event=self.dispatch()['event']
        self.assertEqual(event['event_type'],'check_in')
        self.assertEqual(self.store.get(event['event_id'])['attendance_key'],OUTSIDE_KEY)

    def test_ack_late_belongs_to_observation_day(self):
        event=self.dispatch()['event']
        self.set_time('2026-10-12T08:00:00+07:00');self.now+=172800
        context=self.decision.context_for(event['timestamp'])
        self.acknowledge(event,context)
        self.assertTrue(self.store.has_attended('TEST001','default-morning:2026-10-10'))
        self.assertFalse(self.store.has_attended('TEST001','default-morning:2026-10-12'))
        self.assertTrue(self.decision.should_send('TEST001'))

    def test_restart_preserves_confirmed_occurrence(self):
        event=self.dispatch()['event'];self.acknowledge(event);self.now+=3600
        reopened=DurableOutbox(self.path,clock=lambda:self.now,monotonic=lambda:self.now)
        decision=attendance.AttendanceDecision(outbox=reopened,now=self.attendance_now)
        self.assertFalse(decision.should_send('TEST001'))
        self.assertTrue(decision.should_send('TEST002'))

    def test_enqueue_closes_stale_decision_race_after_ack(self):
        event=self.dispatch()['event'];stale=self.event()
        self.acknowledge(event)
        self.assertEqual(self.client.send_event_async(stale,attendance_key=self.decision.current_key()),'already_attended')
        self.assertEqual(self.store.counts()['acked'],1)
        self.assertEqual(self.store.counts()['pending'],0)

    def test_concurrent_context_enqueue_one_reservation(self):
        key=self.decision.current_key()
        with ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(lambda _:self.store.enqueue(self.event(),attendance_key=key),range(4)))
        self.assertEqual(results.count('queued'),1);self.assertEqual(results.count('reserved'),3)

    def test_thirty_synthetic_members_independent(self):
        entries=[dict(user_code=f'TEST{i:03}',full_name='Synthetic',embedding=np.eye(30,512)[i]) for i in range(30)]
        for entry in entries:
            match=self.decision.match(entry['embedding'],entries)
            self.assertEqual(match[0]['user_code'],entry['user_code'])
            event=self.dispatch(entry['user_code'])['event'];self.acknowledge(event)
            self.assertFalse(self.decision.should_send(entry['user_code']))
        self.assertEqual(self.store.counts()['acked'],30)

    def test_legacy_checkout_replay_keeps_payload_no_toggle(self):
        event={**self.event(),'event_type':'check_out'}
        self.client.send_event_async(event);self.acknowledge(event)
        self.assertEqual(self.store.get(event['event_id'])['event'],event)
        self.assertEqual(self.store.state('TEST001')['event_type'],'check_out')
        self.assertEqual(self.decision.next_event_type('TEST001'),'check_in')

    def test_snapshot_does_not_ack_pending_or_erase_confirmation(self):
        event=self.dispatch()['event'];key=self.decision.current_key()
        self.store.sync_policy(self.client.base_url,DEFAULT_EVENTS,[dict(user_code='TEST001',occurrence_key=key)])
        self.assertIsNone(self.store.state('TEST001'));self.assertEqual(self.store.get(event['event_id'])['status'],'pending')
        self.store.sync_policy(self.client.base_url,[],[])
        self.assertTrue(self.store.has_attended('TEST001',key))
        self.assertEqual(self.store.cached_policy(self.client.base_url),[])

    def test_bad_receipt_context_never_confirms(self):
        event=self.dispatch()['event']
        bad=[None,{},dict(scheduled_event_id='default-morning',occurrence_key='default-morning:2026-10-12',event_name='Morning'),
             dict(scheduled_event_id='wrong',occurrence_key='default-morning:2026-10-10',event_name='Morning')]
        for context in bad:
            response=ack(event);response.json.return_value['attendance_context']=context
            self.client._send_session.post.side_effect=None;self.client._send_session.post.return_value=response
            self.client.run_once()
            row=self.store.get(event['event_id']);self.assertEqual(row['status'],'pending')
            self.now=row['next_retry']

    def test_sync_valid_empty_calendar_persists_across_offline_restart(self):
        response=Mock();response.json.return_value=dict(status='success',day=self.decision.current_day(),data=dict(events=[],confirmed=[]))
        self.client._session.get.side_effect=None;self.client._session.get.return_value=response
        self.assertTrue(self.client.sync_attendance_policy(self.decision));self.assertEqual(self.decision.events,[])
        reopened=self.make_client(DurableOutbox(self.path));reopened._session.get.side_effect=requests.ConnectionError('offline')
        decision=attendance.AttendanceDecision(outbox=reopened.outbox,now=self.attendance_now)
        self.assertFalse(reopened.sync_attendance_policy(decision));self.assertEqual(decision.events,[])

    def test_bad_sync_preserves_old_calendar_no_partial_seed(self):
        self.store.sync_policy(self.client.base_url,DEFAULT_EVENTS,[])
        bad=[None,{},dict(status='success',day='2099-01-01',data={}),
             dict(status='success',day=self.decision.current_day(),data=dict(events=[],confirmed=[None])),
             dict(status='success',day=self.decision.current_day(),data=dict(events=[],confirmed=[dict(user_code='lower',occurrence_key='bad')]))]
        for body in bad:
            response=Mock();response.json.return_value=body
            self.client._session.get.side_effect=None;self.client._session.get.return_value=response
            self.assertFalse(self.client.sync_attendance_policy(self.decision))
            self.assertEqual(self.decision.events,validate_events(DEFAULT_EVENTS))

    def test_legacy_database_v1_migrates_preserving_uuid_and_pending(self):
        event=self.event();self.store.enqueue(event)
        with closing(sqlite3.connect(self.path)) as db,db:
            db.execute('DROP INDEX one_reservation_per_context')
            db.execute('ALTER TABLE events DROP COLUMN attendance_key')
            db.execute("CREATE UNIQUE INDEX one_reservation_per_user ON events(user_code) WHERE status IN ('pending','blocked')")
            db.execute('PRAGMA user_version=1')
        reopened=DurableOutbox(self.path)
        self.assertEqual(reopened.get(event['event_id'])['event'],event)
        self.assertEqual(reopened.reservation('TEST001','default-afternoon:2026-10-10'),'pending')
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0],2)

    def test_policy_cache_source_mismatch_not_reused(self):
        self.store.sync_policy(self.client.base_url,[],[])
        self.assertIsNone(self.store.cached_policy('http://different-backend'))


if __name__=='__main__': unittest.main()
