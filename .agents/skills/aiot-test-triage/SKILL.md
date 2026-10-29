---
name: aiot-test-triage
description: Select AIOT regression tests, reproduce Python/Node/browser failures or intermittent errors, find root causes, and assess a diff's impact with evidence from isolated fixtures.
---

# AIOT test triage

1. Read `git status --short` and the affected diff/callers. Select the smallest test that exercises the changed behavior, using the routing table below. Set up native `$python`, `TEST_PYTHON`, Node and (when needed) Chromium via [the existing runbook](../../../docs/SOFTWARE_ENVIRONMENT.md); inspect `AIOT/server/package.json` and `playwright.config.js` for current commands.
2. Reproduce the exact failure. Record command, working directory, environment variable names/modes (never secrets), runtime versions, test identity, error/exit code, expected versus observed behavior and cleanup. Existing fixtures own temporary DBs/ports/processes; do not use a live server or kill all Node/Python processes.
3. Separate assertion/product failures from missing packages/native ABI, process/IPC/listener failures, browser launch restrictions, candidate-weight skips and hardware gates. `tools/check_python_environment.py` checks pinned dependency metadata; `tools/software_test_support.mjs` and `tools/attendance_test_support.py` define fixture lifecycles. A deadline failure is not evidence of its root cause. Isolate a failing file or run files serially to investigate concurrency; retain the original failed result.

| Boundary | Existing targeted tests (repository-relative) |
|---|---|
| Check-in, schedule, ACK/outbox | `tools/tests/test_attendance_decision.py`, `test_event_attendance.py`, `test_durable_outbox.py`, `test_outbox_delivery.py` |
| Gallery/model math and experimental CPU | `tools/tests/test_member_gallery.py`, `test_pipeline_contract.py`, `test_experimental_cpu.py` |
| Camera, capture, recovery/readiness | `tools/tests/test_camera_provider.py`, `test_autonomous_reliability.py`, `tools/test_autonomous_integration.mjs` |
| API/schema/auth/fixture lifecycle | `tools/test_software_integration.mjs`, `test_event_backend_migration.mjs`, `test_admin_auth.mjs`, `test_fixture_lifecycle.mjs` |
| Browser capture/kiosk/admin | `AIOT/server/tests/capture.spec.js`, `kiosk.spec.js` |
| Package/backup/operator tools | `tools/tests/test_rpi_release.py`, `test_rpi_deployment.py`, `test_autonomous_operations.py`, `tools/test_release_contracts.mjs` |

Targeted invocation examples:

```powershell
& $python -B -m unittest discover -s tools/tests -p test_outbox_delivery.py -v
node --test --test-concurrency=1 --test-timeout=45000 tools/test_fixture_lifecycle.mjs
Push-Location AIOT/server
npx.cmd --no-install playwright test tests/capture.spec.js
Pop-Location
```

4. If the task permits fixes, address the demonstrated cause with the smallest change and add a regression only when it checks meaningful behavior. Documentation/audit-only requests do not authorize application/test changes. Do not weaken assertions, hide failures/skips, replace the real path with mocks, or raise timeouts indefinitely to obtain PASS. A passing rerun alone does not resolve an intermittent failure.
5. Rerun the affected test and adjacent boundary. For cross-cutting changes, use `& $python -B -m unittest discover -s tools/tests -q`, `npm.cmd test --prefix AIOT/server`, then `npm.cmd run test:browser --prefix AIOT/server` as appropriate. Keep heavy suites separate when diagnosing resource contention. Run `tools/check_software.py` only when syntax/model-graph coverage is needed; it reads model artifacts and is not accuracy validation.
6. Report the original failure, established cause or unresolved hypothesis, changes, actual rerun results and untested platform gates. Keep remote CI, ARM/native-driver behavior and hardware evidence distinct from local software tests.
