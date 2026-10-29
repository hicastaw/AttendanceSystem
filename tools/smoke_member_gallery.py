"""Child of the isolated API harness: synthetic 30 members, real HTTP/cache.

Each invocation is a NEW process. No config, camera, checkpoint or .env import.
"""
import os
from pathlib import Path
import sys
from urllib.parse import urlparse

import numpy as np
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "AIOT/edge"))
from api_client import ApiClient
from member_gallery import MemberGallery


def main():
    phase, url, cache = sys.argv[1:]
    if urlparse(url).hostname != "127.0.0.1":
        raise ValueError("Smoke uses localhost only")
    path = Path(cache).resolve()
    if path.parent != Path.cwd().resolve() or path.name != "member-gallery-smoke.json":
        raise ValueError("Only harness-created temporary cache is allowed")
    client = ApiClient(url, device_key=os.environ["OUTBOX_SMOKE_KEY"],
                       outbox_path=path.parent / "edge-outbox-gallery-smoke.db")
    try:
        gallery = MemberGallery(path, source=url)
        restored = gallery.restore()
        if phase == "full":
            assert not restored
            assert gallery.refresh(client)
            assert len(gallery.entries) == 30
            print("PASS: real API 30 synthetic active members -> normalized versioned cache")
        elif phase == "removed":
            assert restored and len(gallery.entries) == 30
            old = gallery.version
            assert gallery.refresh(client)
            assert len(gallery.entries) == 29
            assert "TEST001" not in [entry["user_code"] for entry in gallery.entries]
            assert gallery.version != old
            print("PASS: one inactive member excluded by real API and replaced snapshot 30 -> 29")
        elif phase == "empty":
            assert restored and len(gallery.entries) == 29
            assert gallery.refresh(client)
            assert gallery.entries == [] and gallery.origin == "server"
            reopened = MemberGallery(path, source=url)
            assert reopened.restore() and reopened.entries == []
            print("PASS: real API all inactive -> valid data=[]; RAM and disk empty")
        elif phase == "offline-restart":
            assert restored and gallery.entries == [] and gallery.version is not None
            def offline(*args, **kwargs):
                raise requests.ConnectionError("synthetic outage after valid empty sync")
            client._session.get = offline
            assert not gallery.refresh(client)
            assert gallery.entries == [] and gallery.origin == "cache"
            # Real cosine implementation has no candidate, hence no member/event.
            from attendance_service import AttendanceDecision
            assert AttendanceDecision().match(np.eye(1, 512)[0], gallery.entries) is None
            assert client.outbox.counts()["pending"] == 0
            print("PASS: new process + offline after empty sync, no resurrected members/no match/event")
        else:
            raise ValueError("Unknown smoke phase")
    finally:
        client.stop()


if __name__ == "__main__":
    main()
