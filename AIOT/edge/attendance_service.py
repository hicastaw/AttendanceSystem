"""Chuyển kết quả nhận diện thành sự kiện check-in/check-out ra/vào phòng lab.

Không còn khái niệm phiên/sớm/muộn — chỉ còn 2 loại sự kiện: check_in, check_out.
Thiết bị biên tự QUYẾT ĐỊNH loại sự kiện bằng cách toggle theo trạng thái gần nhất
của từng người (lưu trong RAM, được "mồi" lúc khởi động từ GET /api/last-state để
không bị sai ngay sau khi restart edge).

- So khớp cosine với cache embeddings tải từ server (embedding đã L2-normalize ở
  cả 2 phía nên cosine similarity = dot product).
- Cooldown để một người không bị gửi sự kiện liên tục khi đứng lâu trước camera
  (mặc định 60s, cấu hình qua ATTENDANCE_COOLDOWN_SECONDS).
"""
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone

import numpy as np

logger = logging.getLogger(__name__)

_VN_TZ = timezone(timedelta(hours=7))


class AttendanceDecision:
    def __init__(self, similarity_threshold=0.60, cooldown_seconds=60):
        self.similarity_threshold = similarity_threshold
        self.cooldown_seconds = cooldown_seconds
        self._last_sent = {}   # user_code -> time.monotonic() lúc gửi gần nhất (cooldown)
        self._last_state = {}  # user_code -> "check_in" | "check_out" (trạng thái hiện tại)

    def seed_last_state(self, state_map):
        """state_map: {user_code: 'check_in'|'check_out'} lấy từ GET /api/last-state
        lúc khởi động, để toggle không bị sai ngay sau khi restart tiến trình edge."""
        self._last_state.update(state_map or {})
        logger.info("Đã nạp trạng thái ra/vào gần nhất cho %d người dùng", len(self._last_state))

    def match(self, embedding, known_embeddings):
        """known_embeddings: list[{user_code, full_name, embedding(np.ndarray đã normalize)}]"""
        best = None
        best_score = -1.0
        for entry in known_embeddings:
            score = float(np.dot(embedding, entry["embedding"]))
            if score > best_score:
                best_score = score
                best = entry
        if best is None or best_score < self.similarity_threshold:
            return None
        return best, best_score

    def should_send(self, user_code):
        last = self._last_sent.get(user_code)
        if last is None:
            return True
        return (time.monotonic() - last) >= self.cooldown_seconds

    def next_event_type(self, user_code):
        """Toggle đơn giản: chưa từng thấy hoặc lần trước là check_out -> check_in;
        lần trước là check_in -> check_out."""
        return "check_out" if self._last_state.get(user_code) == "check_in" else "check_in"

    def mark_sent(self, user_code, event_type):
        self._last_sent[user_code] = time.monotonic()
        self._last_state[user_code] = event_type

    @staticmethod
    def build_event(device_id, user_code, event_type, similarity):
        return {
            "event_id": str(uuid.uuid4()),
            "device_id": device_id,
            "user_code": user_code,
            "event_type": event_type,
            "timestamp": datetime.now(_VN_TZ).isoformat(timespec="seconds"),
            # confidence gửi dạng phần trăm 0-100 để dễ đọc trong log/trang quản lý
            "confidence": round(similarity * 100, 2),
        }
