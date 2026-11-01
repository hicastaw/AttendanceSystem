"""Giao tiếp HTTP với server trên laptop.

- Không block vòng lặp camera: việc gửi sự kiện chạy qua 1 thread nền +
  hàng đợi (queue.Queue), vòng lặp chính chỉ enqueue rồi tiếp tục đọc frame.
- Có timeout + retry nhẹ (mặc định 1 lần thử lại).
- Không crash khi mất mạng: mọi lỗi request đều được bắt và log, vòng lặp
  camera/health vẫn tiếp tục chạy bình thường.
"""
import logging
import queue
import threading
import time

import requests

logger = logging.getLogger(__name__)


class ApiClient:
    def __init__(self, base_url, device_key="", timeout=3, max_retries=1, queue_size=50):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self.server_reachable = False

        self._session = requests.Session()
        headers = {"Content-Type": "application/json"}
        if device_key:
            headers["X-Device-Key"] = device_key
        self._session.headers.update(headers)

        self._queue: "queue.Queue" = queue.Queue(maxsize=queue_size)
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._worker, daemon=True, name="api-client-sender")

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop_event.set()
        try:
            self._queue.put_nowait(None)  # đánh thức worker đang chờ get()
        except queue.Full:
            pass
        self._thread.join(timeout=2)

    def send_event_async(self, event):
        try:
            self._queue.put_nowait(event)
        except queue.Full:
            logger.warning("Hàng đợi gửi sự kiện đã đầy, bỏ qua sự kiện %s", event.get("event_id"))

    def check_health(self):
        try:
            resp = self._session.get(f"{self.base_url}/api/health", timeout=self.timeout)
            self.server_reachable = resp.ok
        except requests.RequestException as exc:
            self.server_reachable = False
            logger.debug("Server chưa sẵn sàng: %s", exc)
        return self.server_reachable

    def get_face_data(self):
        try:
            resp = self._session.get(f"{self.base_url}/api/face-data", timeout=self.timeout * 3)
            resp.raise_for_status()
            self.server_reachable = True
            return resp.json().get("data", [])
        except requests.RequestException as exc:
            self.server_reachable = False
            logger.warning("Không tải được face-data từ server: %s", exc)
            return []

    def get_last_state(self):
        """Trạng thái check_in/check_out gần nhất của mỗi người — dùng để mồi cache
        toggle cục bộ lúc khởi động (xem attendance_service.py:seed_last_state)."""
        try:
            resp = self._session.get(f"{self.base_url}/api/last-state", timeout=self.timeout * 3)
            resp.raise_for_status()
            self.server_reachable = True
            return resp.json().get("data", {})
        except requests.RequestException as exc:
            self.server_reachable = False
            logger.warning("Không tải được trạng thái ra/vào gần nhất: %s", exc)
            return {}

    def _worker(self):
        while not self._stop_event.is_set():
            event = self._queue.get()
            if event is None:
                continue

            sent = False
            for attempt in range(self.max_retries + 1):
                try:
                    resp = self._session.post(
                        f"{self.base_url}/api/access-events", json=event, timeout=self.timeout,
                    )
                    resp.raise_for_status()
                    self.server_reachable = True
                    logger.info(
                        "Đã gửi sự kiện: %s %s (%s), confidence=%.1f%%",
                        event.get("user_code"), event.get("event_type"),
                        event.get("event_id"), event.get("confidence", 0),
                    )
                    sent = True
                    break
                except requests.RequestException as exc:
                    self.server_reachable = False
                    logger.warning(
                        "Gửi sự kiện thất bại (lần %d/%d): %s",
                        attempt + 1, self.max_retries + 1, exc,
                    )
                    time.sleep(0.5)

            if not sent:
                logger.error(
                    "Bỏ sự kiện %s sau %d lần thử — server không phản hồi",
                    event.get("event_id"), self.max_retries + 1,
                )
