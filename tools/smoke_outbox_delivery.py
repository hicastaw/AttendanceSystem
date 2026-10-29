"""Test-only child of smoke_aiot_api.mjs; real HTTP, temporary DB, no .env.

phase lost-ack: backend stores event, pretend its response was lost, abrupt exit.
phase replay: a NEW process reopens SQLite, resends UUID, validates duplicate ACK.
"""
import os
from pathlib import Path
import sys
import time
from urllib.parse import urlparse
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "AIOT/edge"))
from api_client import ApiClient
from outbox import DurableOutbox
import requests


def main():
    phase, url, database = sys.argv[1:]
    if urlparse(url).hostname != "127.0.0.1":
        raise ValueError("Smoke must use localhost only")
    path = Path(database).resolve()
    if path.parent != Path.cwd().resolve() or path.name != "edge-outbox-smoke.db":
        raise ValueError("Only the harness-created temporary outbox is allowed")
    key = os.environ["OUTBOX_SMOKE_KEY"]
    # Deterministic retry deadline advance, not a 60s sleep or model/camera clock.
    store = DurableOutbox(path, clock=lambda: time.time() + (120 if phase == "replay" else 0))
    client = ApiClient(url, device_key=key, outbox=store)
    real_post = client._send_session.post
    try:
        if phase == "lost-ack":
            event = dict(event_id=str(uuid.uuid4()), device_id="OUTBOX_SMOKE",
                         user_code="TEST001", event_type="check_out",
                         timestamp="2026-10-10T09:00:00+07:00", confidence=80)
            assert client.send_event_async(event) == "queued"
            def lose_response(*args, **kwargs):
                response = real_post(*args, **kwargs)
                assert response.status_code == 200
                assert response.json()["duplicate"] is False
                raise requests.ConnectionError("synthetic ACK loss AFTER real server commit")
            client._send_session.post = lose_response
            assert client.run_once()
            assert store.get(event["event_id"])["status"] == "pending"
            assert store.state("TEST001") is None
            print("PASS: real server commit + simulated ACK loss; pending durable; abrupt exit next", flush=True)
            os._exit(23)
        elif phase == "replay":
            event = store.next_due()["event"]
            def require_duplicate(*args, **kwargs):
                assert kwargs["json"] == event
                response = real_post(*args, **kwargs)
                assert response.json()["duplicate"] is True
                return response
            client._send_session.post = require_duplicate
            assert client.run_once()
            assert store.counts() == {"pending": 0, "blocked": 0, "acked": 1}
            assert store.get(event["event_id"])["attempts"] == 2
            assert store.state("TEST001")["event_type"] == "check_out"
            assert store.cooldown_remaining("TEST001", 60) > 59
            print("PASS: new-process reopen/replay same UUID; duplicate ACK confirmed atomically")
        else:
            raise ValueError("Unknown smoke phase")
    finally:
        client.stop()


if __name__ == "__main__":
    main()
