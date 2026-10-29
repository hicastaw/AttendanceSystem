"""HTTP sender backed by a durable SQLite outbox, not an event RAM queue.

Enqueue waits for a small local durable commit; HTTP runs in one background
thread. Unacknowledged events survive shutdown/restart and never expire.
"""
import logging
from contextlib import ExitStack
import math
import sqlite3
import threading

import requests
from outbox import DurableOutbox
from member_gallery import GalleryFetchResult
from attendance_schedule import OUTSIDE_KEY, local_time, validate_events

logger = logging.getLogger(__name__)


class ApiClient:
    def __init__(self, base_url, device_key="", timeout=3, *, outbox_path=None,
                 outbox=None, retry_base_seconds=1, retry_max_seconds=60, max_attempts=32):
        if (outbox_path is None) == (outbox is None):
            raise ValueError("Specify exactly one persistent outbox_path or outbox")
        if type(max_attempts) is not int or not 1 <= max_attempts <= 1000:
            raise ValueError('Invalid durable delivery retry budget')
        if not (math.isfinite(timeout) and timeout > 0 and
                math.isfinite(retry_base_seconds) and retry_base_seconds > 0 and
                math.isfinite(retry_max_seconds) and retry_max_seconds >= retry_base_seconds):
            raise ValueError("Timeout/backoff must be finite and positive; max >= base")
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.outbox = outbox if outbox is not None else DurableOutbox(outbox_path)
        self.retry_base_seconds = retry_base_seconds
        self.retry_max_seconds = retry_max_seconds
        self.server_reachable = False
        self.max_attempts, self.storage_ok, self.fatal_error = max_attempts, True, None

        with ExitStack() as startup:
            self._session = requests.Session()
            startup.callback(self._session.close)
            # Do not share a requests.Session between foreground GETs and sender POSTs.
            self._send_session = requests.Session()
            startup.callback(self._send_session.close)
            headers = {"Content-Type": "application/json"}
            if device_key:
                headers["X-Device-Key"] = device_key
            self._session.headers.update(headers)
            self._send_session.headers.update(headers)

            self._wake = threading.Event()  # Coalesced wakeups, never event storage.
            self._stop_event = threading.Event()
            self._thread = threading.Thread(target=self._worker, daemon=True, name="api-client-sender")
            startup.pop_all()  # Ownership transfers to stop() only after construction succeeds.

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop_event.set()
        self._wake.set()
        if self._thread.ident is not None:
            self._thread.join(timeout=self.timeout + 1)
        stopped = not self._thread.is_alive()
        if stopped:
            self._session.close()
            self._send_session.close()
        else:
            logger.warning("Sender still in flight; unconfirmed events remain on disk")
        return stopped

    def send_event_async(self, event, *, attendance_key=None):
        result = self.outbox.enqueue(event, attendance_key=attendance_key)
        if result in ("queued", "already_pending"):
            self._wake.set()
        return result

    def sync_attendance_policy(self, decision):
        """Restore schedule even offline; only persist a fully valid HTTP snapshot."""
        cached = self.outbox.cached_policy(self.base_url)
        if cached is not None:
            decision.events = cached
        day = decision.current_day()
        try:
            response = self._session.get(f"{self.base_url}/api/attendance-policy",
                                         params={"day": day}, timeout=self.timeout, allow_redirects=False)
            response.raise_for_status()
            self.server_reachable = True
            body = response.json()
            if (not isinstance(body, dict) or body.get("status") != "success" or body.get("day") != day or
                    not isinstance(body.get("data"), dict)):
                raise ValueError("Invalid attendance snapshot")
            events = validate_events(body["data"].get("events"))
            confirmed = body['data'].get('confirmed')
            if not isinstance(confirmed, list) or any(not isinstance(row, dict) or
                    not isinstance(row.get('occurrence_key'), str) or not row['occurrence_key'].endswith(':' + day)
                    for row in confirmed):
                raise ValueError('Confirmed attendance must belong to requested day')
            decision.events = self.outbox.sync_policy(self.base_url, events, confirmed)
            return True
        except ValueError:
            logger.warning("Invalid attendance policy; retaining cached/default calendar")
            return False
        except requests.RequestException:
            self.server_reachable = False
            logger.warning("Attendance policy unavailable; retaining cached/default calendar")
            return False

    def check_health(self):
        try:
            resp = self._session.get(f"{self.base_url}/api/health", timeout=self.timeout, allow_redirects=False)
            self.server_reachable = resp.ok
        except requests.RequestException as exc:
            self.server_reachable = False
            logger.debug("Server chưa sẵn sàng: %s", exc)
        return self.server_reachable

    def get_face_data(self):
        try:
            route = getattr(self, 'face_data_path', '/api/face-data')
            resp = self._session.get(f"{self.base_url}{route}", timeout=self.timeout * 3, allow_redirects=False)
            resp.raise_for_status()
            self.server_reachable = True
            body = resp.json()
            if not isinstance(body, dict) or body.get("status") != "success" or not isinstance(body.get("data"), list):
                return GalleryFetchResult(False, error="invalid_gallery_response")
            if "embedding_contract" in body and not isinstance(body["embedding_contract"], dict):
                return GalleryFetchResult(False, error="invalid_embedding_contract")
            return GalleryFetchResult(True, data=body["data"], contract=body.get("embedding_contract"))
        except ValueError:
            # requests.JSONDecodeError also inherits RequestException; classify it
            # BEFORE transport errors so malformed JSON is not mistaken for outage.
            self.server_reachable = True
            return GalleryFetchResult(False, error="gallery_invalid_json")
        except requests.RequestException as exc:
            self.server_reachable = False
            logger.warning("Không tải được face-data từ server: %s", exc)
            return GalleryFetchResult(False, error="gallery_http_or_network_error")

    def get_last_state(self):
        """Trạng thái check_in/check_out gần nhất của mỗi người — dùng để mồi cache
        toggle cục bộ lúc khởi động (xem attendance_service.py:seed_last_state)."""
        try:
            resp = self._session.get(f"{self.base_url}/api/last-state", timeout=self.timeout * 3, allow_redirects=False)
            resp.raise_for_status()
            self.server_reachable = True
            return resp.json().get("data", {})
        except requests.RequestException as exc:
            self.server_reachable = False
            logger.warning("Không tải được trạng thái ra/vào gần nhất: %s", exc)
            return {}

    @staticmethod
    def _valid_ack(body, event):
        if not isinstance(body, dict) or body.get("status") != "success":
            return False
        if not isinstance(body.get("duplicate"), bool) or not isinstance(body.get("data"), dict):
            return False
        if "attendance_context" in body:
            context = body["attendance_context"]
            if not isinstance(context, dict) or set(context) != {"scheduled_event_id", "occurrence_key", "event_name"}:
                return False
            key = context["occurrence_key"]
            if key is None:
                if context["scheduled_event_id"] is not None or context["event_name"] is not None:
                    return False
            else:
                try:
                    DurableOutbox._validate_key(key)
                except (ValueError, TypeError):
                    return False
                if (key == OUTSIDE_KEY or context["scheduled_event_id"] != key.split(":")[0] or
                        key.split(":")[1] != local_time(event['timestamp']).date().isoformat() or
                        not isinstance(context["event_name"], str) or not context["event_name"]):
                    return False
        return all(body["data"].get(key) == event[key]
                   for key in ("event_id", "user_code", "event_type", "timestamp"))

    def run_once(self):
        """Send at most one due event. Exposed for deterministic software tests.

        Only one sender may call this for a database. Return False if no due work;
        True also means a FAILED attempt was recorded, not that it was confirmed.
        """
        row = self.outbox.next_due()
        if row is None:
            return False
        event = row["event"]
        self.outbox.begin_attempt(event["event_id"])
        delay = min(self.retry_max_seconds,
                    self.retry_base_seconds * (2 ** min(row["attempts"], 30)))
        blocked = False
        error_code = None
        ack_body = None
        try:
            resp = self._send_session.post(f"{self.base_url}/api/access-events",
                                           json=event, timeout=self.timeout, allow_redirects=False)
            if not 200 <= resp.status_code < 300:
                error_code = f"http_{resp.status_code}"
                blocked = 300 <= resp.status_code < 500 and resp.status_code not in (408, 429)
            else:
                ack_body = resp.json()
                if not self._valid_ack(ack_body, event):
                    error_code = "invalid_ack"
        except (requests.RequestException, ValueError):
            error_code = "transport_or_json_error"

        if error_code:
            self.server_reachable = False
            if row['attempts'] + 1 >= self.max_attempts:
                blocked = True
                error_code = 'retry_budget_exhausted'
            self.outbox.defer(event["event_id"], error_code, delay, blocked=blocked)
            logger.warning("Outbox event %s: %s (%s); retained on disk",
                           event["event_id"], error_code, "blocked" if blocked else "retry")
        else:
            # If commit fails AFTER server persistence, keep pending and replay the
            # same ID. The server UNIQUE key makes this an idempotent duplicate.
            self.outbox.confirm(event["event_id"], attendance_context=ack_body.get("attendance_context"))
            self.server_reachable = True
            logger.info("ACK-confirmed event %s", event["event_id"])
        return True

    def _worker(self):
        failures = 0
        while not self._stop_event.is_set():
            self._wake.clear()
            try:
                attempted = self.run_once()
                failures, self.storage_ok = 0, True
                if attempted:
                    continue
            except (sqlite3.Error, OSError):
                failures += 1
                self.storage_ok = False
                logger.error('Outbox storage failure; event not confirmed; storage_attempt=%s/5', failures)
                if failures >= 5:
                    self.fatal_error = 'storage_retry_exhausted'
                    return
            self._wake.wait(timeout=1)  # Interruptible; disk remains authoritative.
