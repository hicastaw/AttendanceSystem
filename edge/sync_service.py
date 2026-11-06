"""Đồng bộ edge -> server chạy nền (offline-first).

- Gửi sự kiện `pending` trong LocalStore theo lô, đúng thứ tự phát sinh. Server
  trả kết quả từng sự kiện: accepted/duplicate -> xoá khỏi hàng đợi; rejected ->
  đánh dấu rejected (lỗi vĩnh viễn, không gửi lại). Lỗi mạng -> giữ pending, retry với thời gian chờ
  tăng dần (SYNC_RETRY_MIN_SECONDS .. SYNC_RETRY_MAX_SECONDS).
- Heartbeat định kỳ: báo số sự kiện chờ/bị từ chối và trạng thái edge; server trả
  face_data_version — khác bản đang dùng thì gọi on_face_data_changed() để tải lại
  khuôn mặt ngay thay vì đợi chu kỳ refresh.
- notify(): vòng lặp camera gọi sau khi ghi sự kiện để gửi ngay, không đợi chu kỳ.
"""
import logging
import threading
import time

import requests

logger = logging.getLogger(__name__)


class SyncService:
    def __init__(self, store, api_client, device_id, *, batch_size=50, retry_min=2.0,
                 retry_max=60.0, heartbeat_seconds=30.0, status_provider=None,
                 face_data_version=None, on_face_data_changed=None):
        self.store = store
        self.api_client = api_client
        self.device_id = device_id
        self.batch_size = batch_size
        self.retry_min = retry_min
        self.retry_max = retry_max
        self.heartbeat_seconds = heartbeat_seconds
        self.status_provider = status_provider or (lambda: {})
        self.face_data_version = face_data_version or (lambda: None)
        self.on_face_data_changed = on_face_data_changed or (lambda: None)

        self.last_sync_at = None      # time.time() lần gửi lô thành công gần nhất
        self.last_sync_error = None
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="sync-service", daemon=True)

    def start(self):
        self._thread.start()

    def stop(self, timeout=3):
        self._stop.set()
        self._wake.set()
        if self._thread.is_alive():
            self._thread.join(timeout)

    def notify(self):
        self._wake.set()

    def _run(self):
        delay = 0.0
        next_heartbeat = 0.0
        while not self._stop.is_set():
            if time.monotonic() >= next_heartbeat:
                self._heartbeat()
                next_heartbeat = time.monotonic() + self.heartbeat_seconds

            try:
                drained = self.sync_once()
                delay = 0.0 if drained else min(self.retry_max, self.retry_min if not delay else delay * 2)
            except requests.RequestException as exc:
                delay = min(self.retry_max, self.retry_min if not delay else delay * 2)
                logger.warning("Đồng bộ sự kiện thất bại, thử lại sau %.0fs: %s", delay, exc)
            except Exception:
                delay = self.retry_max
                logger.exception("Lỗi không mong đợi khi đồng bộ")

            # Đang lỗi: chờ backoff. Hết hàng đợi: ngủ tới heartbeat kế tiếp. Cả hai
            # đều bị cắt ngắn khi có sự kiện mới (notify) — tần suất thấp, gửi ngay.
            wait = delay if delay else max(0.0, next_heartbeat - time.monotonic())
            self._wake.wait(wait)
            self._wake.clear()

    def sync_once(self):
        """Gửi 1 lô pending. Trả True nếu hàng đợi đã trống sau lô này.
        Ném RequestException khi lỗi mạng/HTTP (sự kiện vẫn pending)."""
        events = self.store.pending_events(self.batch_size)
        if not events:
            return True
        ids = [e["event_id"] for e in events]
        try:
            results = self.api_client.send_events_batch(self.device_id, events)
        except requests.RequestException as exc:
            self.last_sync_error = str(exc)
            self.store.record_attempt_failure(ids, exc)
            raise

        by_id = {r.get("event_id"): r for r in results}
        synced = []
        for event_id in ids:
            result = by_id.get(event_id) or {}
            if result.get("result") in ("accepted", "duplicate"):
                synced.append(event_id)
            elif result.get("result") == "rejected":
                reason = result.get("reason") or "rejected"
                self.store.mark_rejected(event_id, reason)
                logger.error("Server từ chối sự kiện %s: %s", event_id, reason)
            else:
                self.store.record_attempt_failure([event_id], "Server không trả kết quả cho sự kiện")
        self.store.mark_synced(synced)
        self.last_sync_at = time.time()
        self.last_sync_error = None
        if synced:
            logger.info("Đã đồng bộ %d sự kiện lên server", len(synced))
        return len(events) < self.batch_size

    def _heartbeat(self):
        counts = self.store.event_counts()
        response = self.api_client.send_heartbeat({
            "device_id": self.device_id,
            "pending_events": counts["pending"],
            "rejected_events": counts["rejected"],
            "face_data_version": self.face_data_version(),
            "status": self.status_provider(),
        })
        if response is None:
            return
        server_version = response.get("face_data_version")
        if server_version and server_version != self.face_data_version():
            logger.info("Server có dữ liệu khuôn mặt mới (version %s), tải lại ngay", server_version)
            self.on_face_data_changed()
