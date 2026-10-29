"""Status delivery regressions; synthetic events, no camera or attendance data."""
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'AIOT/edge'))
from worker_status import WorkerStatus


class WorkerStatusTests(unittest.TestCase):
    def setUp(self):
        self.now = 10.0
        self.health = dict(camera_opened=True, model_loaded=True, ready=True,
                           frame_age_seconds=.1, frame_fresh=True, storage_ok=True,
                           error=None)
        self.publisher = WorkerStatus('http://127.0.0.1:1', 'synthetic', {},
                                      health=lambda: dict(self.health), clock=lambda: self.now)
        self.addCleanup(self.publisher.stop)
        post_patch = patch.object(self.publisher.session, 'post', return_value=Mock(ok=True, status_code=200))
        self.post = post_patch.start()
        self.addCleanup(post_patch.stop)

    def body(self):
        self.assertTrue(self.publisher.publish())
        return self.post.call_args.kwargs['json']

    def test_event_survives_evaluating_before_first_heartbeat_and_later_heartbeats(self):
        # Express calls this confirmed only once its event/receipt is committed.
        self.publisher.update('pending', event_id='committed-A')
        self.publisher.update('evaluating')
        self.assertEqual(self.body()['event_id'], 'committed-A')
        self.assertEqual(self.body()['state'], 'pending')
        self.publisher.update('evaluating')
        self.assertEqual(self.body()['event_id'], 'committed-A')

    def test_newer_recognition_replaces_held_event(self):
        self.publisher.update('pending', event_id='committed-A')
        self.publisher.update('evaluating')
        self.publisher.update('pending', event_id='committed-B')
        self.publisher.update('evaluating')
        self.assertEqual(self.body()['event_id'], 'committed-B')

    def test_rejection_enrollment_and_failure_clear_event(self):
        for state in ('unknown', 'idle', 'enrollment', 'storage_error',
                      'camera_unavailable', 'model_unavailable'):
            with self.subTest(state=state):
                self.publisher.update('pending', event_id='committed-A')
                self.publisher.update(state)
                self.publisher.update('evaluating')
                self.assertIsNone(self.body()['event_id'])

    def test_multiple_faces_explicitly_invalidate_event(self):
        self.publisher.update('pending', event_id='committed-A')
        self.publisher.update('evaluating', clear_event=True)
        self.assertEqual(self.body()['state'], 'evaluating')
        self.assertIsNone(self.body()['event_id'])

    def test_failed_send_does_not_consume_held_result(self):
        self.publisher.update('pending', event_id='committed-A')
        self.post.return_value.ok = False
        self.post.return_value.status_code = 503
        with self.assertLogs('worker_status', level='WARNING'):
            self.assertFalse(self.publisher.publish())
        self.publisher.update('evaluating')
        self.post.return_value.ok = True
        self.assertEqual(self.body()['event_id'], 'committed-A')

    def test_transport_failure_retries_the_held_result_with_a_newer_sequence(self):
        import requests
        self.publisher.update('pending', event_id='committed-A')
        self.post.side_effect = requests.ConnectionError('isolated transport failure')
        self.assertFalse(self.publisher.publish())
        failed = self.post.call_args.kwargs['json']
        self.publisher.update('evaluating')
        self.post.side_effect = None
        retried = self.body()
        self.assertEqual(retried['event_id'], 'committed-A')
        self.assertGreater(retried['status_sequence'], failed['status_sequence'])

    def test_unhealthy_publish_clears_event_even_after_health_recovers(self):
        self.publisher.update('pending', event_id='committed-A')
        self.health.update(ready=False, frame_fresh=False, frame_age_seconds=6.)
        body = self.body()
        self.assertEqual(body['state'], 'camera_unavailable')
        self.assertFalse(body['pipeline_ready'])
        self.assertIsNone(body['event_id'])
        self.health.update(ready=True, frame_fresh=True, frame_age_seconds=.1)
        self.assertIsNone(self.body()['event_id'])
        self.publisher.update('evaluating')
        self.assertIsNone(self.body()['event_id'])

    def test_evaluating_does_not_extend_five_second_result_expiry(self):
        self.publisher.update('pending', event_id='committed-A')
        self.now += 4.9
        self.publisher.update('evaluating')
        self.assertEqual(self.body()['event_id'], 'committed-A')
        self.now += .1
        self.assertIsNone(self.body()['event_id'])
        self.assertEqual(self.body()['state'], 'evaluating')

    def test_fresh_same_day_match_refreshes_visibility_without_new_event(self):
        self.publisher.update('pending', event_id='committed-A')
        self.now += 4.
        self.publisher.update('pending', event_id='committed-A')
        self.now += 4.
        self.publisher.update('evaluating')
        self.assertEqual(self.body()['event_id'], 'committed-A')

    def test_heartbeat_order_is_monotonic_and_restart_has_new_source_no_event(self):
        first = self.body()
        second = self.body()
        self.assertEqual(second['status_source'], first['status_source'])
        self.assertGreater(second['status_sequence'], first['status_sequence'])
        restarted = WorkerStatus('http://127.0.0.1:1', 'synthetic', {})
        self.addCleanup(restarted.stop)
        self.assertNotEqual(restarted.source, first['status_source'])
        self.assertIsNone(restarted.value.get('event_id'))

    def test_overlapping_publish_cannot_deliver_old_event_after_new_event(self):
        entered, release, second_done = threading.Event(), threading.Event(), threading.Event()
        delivered, errors = [], []
        def post(_url, **kwargs):
            event = kwargs['json']['event_id']
            if event == 'committed-A':
                entered.set()
                if not release.wait(2):
                    raise AssertionError('test did not release first heartbeat')
            delivered.append(event)
            return Mock(ok=True)
        self.post.side_effect = post
        def publish(done=None):
            try:
                self.publisher.publish()
            except BaseException as error:
                errors.append(error)
            finally:
                if done: done.set()
        self.publisher.update('pending', event_id='committed-A')
        first = threading.Thread(target=publish)
        second = threading.Thread(target=publish, args=(second_done,))
        first.start()
        try:
            self.assertTrue(entered.wait(1))
            self.publisher.update('pending', event_id='committed-B')
            second.start()
            self.assertFalse(second_done.wait(.05), 'new heartbeat overtook in-flight old heartbeat')
        finally:
            release.set()
            first.join(2)
            if second.ident is not None: second.join(2)
        self.assertFalse(first.is_alive())
        self.assertFalse(second.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(delivered, ['committed-A', 'committed-B'])


if __name__ == '__main__':
    unittest.main()
