"""Check-in only: one/member/event occurrence; outside events retain timestamps.

Cosine matching is unchanged. Outside events use cooldown, not presence tracking.
Durable pending reservation remains separate from ACK-confirmed attendance.
"""
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone

import numpy as np
from pipeline import normalize
from attendance_schedule import DEFAULT_EVENTS, OUTSIDE_KEY, local_time, resolve_context, validate_events

logger = logging.getLogger(__name__)

_VN_TZ = timezone(timedelta(hours=7))


class AttendanceDecision:
    def __init__(self, similarity_threshold=0.60, cooldown_seconds=60, *, outbox=None, now=None, minimum_margin=0.0):
        self.similarity_threshold = similarity_threshold
        self.cooldown_seconds = cooldown_seconds
        self.outbox = outbox
        self.minimum_margin = minimum_margin
        self._now = now or (lambda: datetime.now(_VN_TZ))
        self.events = validate_events(DEFAULT_EVENTS)
        self._attended = set()
        self._last_sent = {}   # user_code -> time.monotonic() lúc gửi gần nhất (cooldown)
        self._last_state = {}  # user_code -> "check_in" | "check_out" (trạng thái hiện tại)

    def seed_last_state(self, state_map):
        """Compatibility only: dateless legacy state cannot identify a session."""
        if self.outbox is not None:
            self.outbox.seed_last_state(state_map)
            return
        self._last_state.update(state_map or {})
        logger.info("Đã nạp trạng thái ra/vào gần nhất cho %d người dùng", len(self._last_state))

    def current_day(self):
        return local_time(self._now()).date().isoformat()

    def context_for(self, timestamp):
        return resolve_context(timestamp, self.events)

    def current_key(self):
        return self.context_for(self._now())["occurrence_key"] or OUTSIDE_KEY

    def already_attended(self, user_code):
        key = self.current_key()
        if key == OUTSIDE_KEY:
            return False
        return self.outbox.has_attended(user_code, key) if self.outbox else (user_code, key) in self._attended

    def match(self, embedding, known_embeddings):
        """known_embeddings: list[{user_code, full_name, embedding(np.ndarray đã normalize)}]"""
        best_match = self.best_match(embedding, known_embeddings)
        if best_match is None or best_match[1] < self.similarity_threshold:
            return None
        runner_up = [float(normalize(embedding) @ normalize(e['embedding'])) for e in known_embeddings if e is not best_match[0]]
        if runner_up and best_match[1] - max(runner_up) < self.minimum_margin:
            return None
        return best_match

    @staticmethod
    def best_match(embedding, known_embeddings):
        """Trả về ứng viên tốt nhất kèm score, kể cả khi chưa đủ ngưỡng."""
        best = None
        best_score = -1.0
        try:
            embedding = normalize(embedding)
        except (ValueError, TypeError):
            return None
        for entry in known_embeddings:
            try:
                score = float(np.dot(embedding, normalize(entry["embedding"])))
            except (ValueError, TypeError):
                return None  # Invalid gallery is never partially trusted.
            if score > best_score:
                best_score = score
                best = entry
        if best is None:
            return None
        return best, best_score

    def should_send(self, user_code):
        if self.outbox is not None:
            if self.outbox.reservation(user_code, self.current_key()):
                return False
        if self.already_attended(user_code):
            return False
        # A distinct scheduled occurrence is not suppressed by yesterday/another
        # session's delayed ACK. Its own reservation/confirmation provides dedup.
        return self.current_key() != OUTSIDE_KEY or self.cooldown_remaining(user_code) <= 0

    def cooldown_remaining(self, user_code):
        if self.outbox is not None:
            return self.outbox.cooldown_remaining(user_code, self.cooldown_seconds)
        last = self._last_sent.get(user_code)
        if last is None:
            return 0.0
        return max(0.0, self.cooldown_seconds - (time.monotonic() - last))

    def next_event_type(self, user_code):
        """Only newly generated business events change; legacy history is retained."""
        return "check_in"

    def delivery_status(self, user_code):
        if self.outbox is not None:
            reservation = self.outbox.reservation(user_code, self.current_key())
            if reservation:
                return reservation
        if self.already_attended(user_code):
            return "confirmed"
        return "cooldown" if not self.should_send(user_code) else "ready"

    def mark_sent(self, user_code, event_type):
        """Legacy in-memory demo helper; NEVER call in durable production mode."""
        if self.outbox is not None:
            raise RuntimeError("Only a validated sender ACK may confirm durable state")
        if event_type != "check_in":
            raise ValueError("Only check_in is generated by the kiosk")
        self._last_sent[user_code] = time.monotonic()
        self._last_state[user_code] = event_type
        if self.current_key() != OUTSIDE_KEY:
            self._attended.add((user_code, self.current_key()))

    def build_checkin_event(self, device_id, user_code, similarity):
        return self.build_event(device_id, user_code, "check_in", similarity, timestamp=self._now())

    @staticmethod
    def build_event(device_id, user_code, event_type, similarity, *, timestamp=None):
        if event_type != "check_in":
            raise ValueError("Only check_in is generated by the kiosk")
        stamp = local_time(timestamp or datetime.now(_VN_TZ))
        return {
            "event_id": str(uuid.uuid4()),
            "device_id": device_id,
            "user_code": user_code,
            "event_type": event_type,
            "timestamp": stamp.isoformat(timespec="seconds"),
            # confidence gửi dạng phần trăm 0-100 để dễ đọc trong log/trang quản lý
            "confidence": round(similarity * 100, 2),
        }
