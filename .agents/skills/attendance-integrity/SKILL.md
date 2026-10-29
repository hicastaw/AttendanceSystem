---
name: attendance-integrity
description: Trace and validate AIOT check-in integrity when changing or testing SQLite transactions, durable outbox delivery, HTTP ACK/retry, UUID or occurrence deduplication, and event consistency.
---

# Attendance integrity

Run commands from repository root after setting `$python` and `TEST_PYTHON` as in [the runbook](../../../docs/SOFTWARE_ENVIRONMENT.md).

1. Trace only the affected path: `AIOT/edge/attendance_service.py` and `attendance_schedule.py` -> `outbox.py` -> `api_client.py` -> `AIOT/server/src/routes/access-events.js` -> `db.js`/`schema.sql` -> `routes/kiosk.js`. Compare the caller and server schedule logic; source comments can lag implementation.
2. State the invariants affected by the diff: new events are check-in-only; scheduled attendance is per member/occurrence; outside-schedule events retain timestamps/cooldown; enqueue is durable before HTTP; retries preserve UUID/payload; unvalidated ACK cannot confirm local state. Backend success and kiosk confirmation require committed rows, including receipt resolution for occurrence duplicates.
3. Check transaction boundaries and failure cases: same UUID/same payload; same UUID/different payload; different UUID/same occurrence; delayed retry across dates; concurrent devices; restart before/after local commit, backend commit or lost ACK; malformed/mismatched ACK; inactive member; locked/full DB; blocked/requeued delivery. Preserve existing history and pending/blocked rows. Use temp DBs and synthetic members, never operator data.
4. Choose the relevant existing tests, then exercise the cross-process boundary if changed:

```powershell
& $python -B -m unittest discover -s tools/tests -p test_attendance_decision.py -v
& $python -B -m unittest discover -s tools/tests -p test_durable_outbox.py -v
& $python -B -m unittest discover -s tools/tests -p test_outbox_delivery.py -v
& $python -B -m unittest discover -s tools/tests -p test_event_attendance.py -v
node --test --test-timeout=45000 tools/test_event_backend_migration.mjs tools/test_software_integration.mjs
node tools/smoke_aiot_api.mjs --outbox-python "$python" --gallery-python "$python" --event-python "$python"
```

5. Report each changed invariant with test evidence and its limits. Check both row counts and receipt/local-ledger state: HTTP 200 alone does not prove correctness. If blocked by the environment, preserve the failure and stop short of a data-integrity PASS; route diagnosis through `aiot-test-triage` when needed.

For component context, read [architecture](../../../docs/AIOT_ARCHITECTURE.md) only as needed. Do not reset databases, regenerate event IDs, discard reservations or change business rules to repair a test.
