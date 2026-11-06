"""Giao tiếp HTTP với server.

Các hàm đều đồng bộ, có timeout, không ném lỗi mạng ra ngoài trừ khi ghi rõ —
gọi từ thread nền (sync_service.py, refresh khuôn mặt) để không chặn vòng lặp
camera. Việc lưu sự kiện bền vững khi mất mạng do local_store.py đảm nhận.
"""
import logging
import time

import requests

logger = logging.getLogger(__name__)


class ApiClient:
    def __init__(self, base_url, device_key="", timeout=3, max_retries=1):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self.server_reachable = False
        self.face_data_pipeline = None
        self.face_data_version = None
        self.last_state_times = {}

        self._session = requests.Session()
        headers = {"Content-Type": "application/json"}
        if device_key:
            headers["X-Device-Key"] = device_key
        self._session.headers.update(headers)

    def check_health(self):
        try:
            resp = self._session.get(f"{self.base_url}/api/health", timeout=self.timeout)
            self.server_reachable = resp.ok
        except requests.RequestException as exc:
            self.server_reachable = False
            logger.debug("Server chưa sẵn sàng: %s", exc)
        return self.server_reachable

    def get_face_data(self, if_version=None):
        """Tải embedding từ server. Trả list (có thể rỗng); trả None nếu truyền
        if_version và server báo không đổi (HTTP 304). Lỗi mạng trả [] và
        server_reachable=False. Metadata pipeline/version lưu vào thuộc tính."""
        self.face_data_pipeline = None
        headers = {"If-None-Match": f'"{if_version}"'} if if_version else {}
        try:
            resp = self._session.get(f"{self.base_url}/api/face-data", headers=headers,
                                     timeout=self.timeout * 3)
            if resp.status_code == 304:
                self.server_reachable = True
                self.face_data_version = if_version
                return None
            resp.raise_for_status()
            self.server_reachable = True
            payload = resp.json()
            self.face_data_pipeline = payload.get("pipeline")
            self.face_data_version = payload.get("version")
            return payload.get("data", [])
        except requests.RequestException as exc:
            self.server_reachable = False
            logger.warning("Không tải được face-data từ server: %s", exc)
            return []

    def send_events_batch(self, device_id, events):
        """Gửi lô sự kiện; trả list kết quả {event_id, result, reason} từ server.
        Ném requests.RequestException khi lỗi mạng/HTTP để SyncService retry."""
        try:
            resp = self._session.post(f"{self.base_url}/api/access-events/batch",
                                      json={"device_id": device_id, "events": events},
                                      timeout=self.timeout * 3)
            resp.raise_for_status()
        except requests.RequestException:
            self.server_reachable = False
            raise
        self.server_reachable = True
        return resp.json().get("results", [])

    def send_heartbeat(self, payload):
        """Báo trạng thái edge; trả data server (face_data_version, server_time) hoặc None."""
        try:
            resp = self._session.post(f"{self.base_url}/api/devices/heartbeat", json=payload,
                                      timeout=self.timeout)
            resp.raise_for_status()
        except requests.RequestException as exc:
            self.server_reachable = False
            logger.debug("Heartbeat thất bại: %s", exc)
            return None
        self.server_reachable = True
        return resp.json().get("data", {})

    def get_last_state(self):
        """Trạng thái check_in/check_out gần nhất của mỗi người — dùng để mồi cache
        toggle cục bộ lúc khởi động (xem attendance_service.py:seed_last_state)."""
        try:
            resp = self._session.get(f"{self.base_url}/api/last-state", timeout=self.timeout * 3)
            resp.raise_for_status()
            self.server_reachable = True
            payload = resp.json()
            self.last_state_times = payload.get("times", {})
            return payload.get("data", {})
        except requests.RequestException as exc:
            self.server_reachable = False
            logger.warning("Không tải được trạng thái ra/vào gần nhất: %s", exc)
            return {}

    def send_event(self, event):
        """Gửi 1 sự kiện đồng bộ (có retry). Trả về True nếu server đã nhận."""
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
        return sent
