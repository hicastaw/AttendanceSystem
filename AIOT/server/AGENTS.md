# AIOT API, SQLite, enrollment service and browser UI

Applies below `AIOT/server/`, in addition to the repository instructions. Commands run from repository root, with `TEST_PYTHON` set to the native test interpreter.

- Express serves both `src/` API and `public/` HTML/CSS/JS. This is not the root React/PostgreSQL app. Preserve frontend request/response fields, status semantics and auth requirements; inspect API callers and browser tests before changing a route.
- `db.js`/`schema.sql` use better-sqlite3, WAL/FULL, foreign keys, mode/schema guards and additive migrations. Parameterize SQL. Keep related writes inside transactions and test against a separate temp DB. Imports of `db.js` have side effects: never import it casually with default/live data paths.
- In `routes/access-events.js`, UUID replay with identical payload is idempotent; conflicting payload returns 409. Member/occurrence dedup also covers different devices/new outboxes; `event_receipts` maps alternate UUIDs to the committed attendance row. ACK success follows transaction completion; DB errors cannot become success. Preserve delayed-event timestamp/schedule semantics and legacy checkout history while new workers remain check-in-only.
- `middleware/auth.js` separates admin Bearer sessions from `X-Device-Key`. Device credentials do not grant admin/capture rights. Preserve token TTL/revocation, login bounds, placeholder rejection and redirect restrictions; do not introduce identity-header trust or default secrets.
- `routes/capture.js` requires admin authorization and binds session, user and embedding contract. Preview is private/no-store; browser status does not expose embeddings. Explicit identity confirmation precedes commit; profile + capture receipt persist atomically and retries/concurrent commits resolve through the receipt. Never open a second camera from this path.
- `ai/main.py`/`ai/core/face_engine.py` provide legacy CPU enrollment, not experimental R50 enrollment. Preserve face-count/quality/vector validation and contract matching. Synthetic enrollment belongs only to mock mode and a separate mock DB/device namespace.
- `routes/kiosk.js` accepts whitelisted worker state; public `confirmed` must resolve a committed attendance row or its receipt, never an optimistic browser/worker claim. Edge ACK may arrive later. Preserve frame-age/stale-worker checks, `/api/ready` DB scope and `/api/system-ready` local-pipeline scope.
- Render user-controlled names as text, preserve cancellation/stale-response handling, and keep the 1024x600 kiosk usable. Coordinate with Ant before editing `public/`; inspect current diffs and avoid overlapping ownership.

Checks selected by impact:

```powershell
npm.cmd test --prefix AIOT/server
node --test --test-timeout=45000 tools/test_software_integration.mjs tools/test_autonomous_integration.mjs
& $python -B -m unittest discover -s tools/tests -p test_enrollment_api.py -v
npm.cmd run test:browser --prefix AIOT/server
```

Browser tests live in `tests/kiosk.spec.js` and `tests/capture.spec.js`; Chromium and Flask/Werkzeug in the test Python environment are needed for the synthetic camera-owner fixture. Use [existing environment/runbook](../../docs/SOFTWARE_ENVIRONMENT.md) for setup and [test triage](../../.agents/skills/aiot-test-triage/SKILL.md) when a test fails. Do not edit assertions or timeouts to conceal a runtime/setup failure.
