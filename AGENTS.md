# AttendanceSystem agent instructions

## Product and repository map

- The main deliverable is the **AIOT attendance kiosk**: check-in-only with scheduled occurrences and outside-schedule cooldown. Preserve existing history and schedule semantics.
- Target: Raspberry Pi 5 + AI HAT+ 2 (Hailo-10H), SCRFD-10G + ArcFace R50. No liveness or LLM in AIOT.
- `AIOT/server/src/`: Express API + SQLite; `AIOT/server/public/`: plain HTML/CSS/JS admin, capture and kiosk, served by the same Express process.
- `AIOT/edge/`: Python camera owner, recognition, gallery, durable outbox, HTTP sender and health. Read [edge instructions](AIOT/edge/AGENTS.md) before editing this subsystem.
- `AIOT/server/ai/`: legacy CPU enrollment service. Read [server instructions](AIOT/server/AGENTS.md) before editing server/API/UI/enrollment.
- `tools/`, `tools/tests/`, `AIOT/server/tests/`: local mock, diagnostics, Python/Node/Playwright tests and release helpers.
- `deploy/rpi5/`: Pi service/env templates. Older `AIOT/scripts/` and `AIOT/systemd/` are separate deployment paths; inspect the target before using them.
- `backend/`, `frontend/`, root `docker-compose.yml`: **legacy React/Vite + Express + PostgreSQL/pgvector application**. Do not modify or start it for an AIOT-only task unless required by that task. Its liveness/auth/model conventions do not define AIOT behavior.

## Read only the context needed

- Start with [architecture](docs/AIOT_ARCHITECTURE.md), [current status](docs/AIOT_CURRENT_STATUS.md), or the existing [development/release runbook](docs/SOFTWARE_ENVIRONMENT.md), according to the task.
- Reports are historical leads, not proof of current behavior. Confirm relevant source and actual test results; distinguish software, synthetic, artifact, and hardware evidence.
- The live-worker entrypoint currently uses YuNet/MobileFaceNet. SCRFD/R50 CPU is isolated experimental software; Hailo transport/preparation does not establish production integration. Never mix MobileFaceNet, R50 ONNX and R50 HEF embeddings, even when all have 512 dimensions.
- Search first-party paths with `rg`; exclude dependencies, virtualenvs, model weights and generated artifacts from broad reads. Do not read every report or the entire repository at session start.

## Workflow: inspect -> implement -> test -> report

1. Inspect `git status --short`, relevant diffs, scoped instructions, callers, contracts and existing tests. Preserve unrelated dirty/untracked work.
2. Make the smallest change that meets the request, following adjacent code. Python uses existing module imports and explicit resource cleanup; server JavaScript uses ES modules, parameterized SQL and transactions. Keep the UI framework-free. Do not introduce a formatter, dependency upgrade or broad refactor without a task need.
3. Run targeted tests first; use the suites below when the affected boundary warrants them. Tests use synthetic identities/images/vectors and temporary databases only. Do not weaken assertions or extend timeouts just to obtain PASS.
4. Report changed files, commands/results, remaining risks and unverified gates. A skipped test, source inspection or old report is not a new runtime PASS. Update concise status/runbook documentation when behavior or evidence changes.

## Verified command entrypoints (from repository root)

Set `$python` to native CPython 3.11 with the test profile installed; on this workspace `.venv/runtime/python.exe` exists. Check dependencies using the runbook; PATH may select MSYS2 Python. On Windows use `npm.cmd`/`npx.cmd` without changing execution policy.

```powershell
$python = (Resolve-Path '.venv/runtime/python.exe').Path
$env:TEST_PYTHON = $python
& $python -B -m unittest discover -s tools/tests -q
npm.cmd test --prefix AIOT/server
npm.cmd run test:browser --prefix AIOT/server
& $python tools/rpi_deployment.py preflight --software-only
```

Playwright needs installed Chromium; set `PLAYWRIGHT_BROWSERS_PATH` if using the workspace's `.venv/browsers`. `npm run test:aiot --prefix AIOT/server` is the archive-scoped suite; default `npm test` additionally includes legacy-auth source regression. Entrypoint verification does not mean every suite currently passes: consult dated evidence in current status.

## Data, Git and concurrent work

- Never test against production DBs, face images, galleries, outboxes or credentials. Do not print/read live `.env` values, tokens, enrollment payloads or personal attendance data to obtain context; use examples and isolated fixtures.
- Preserve UUID/payload identity, pending events, receipts, mode markers and model contracts. Do not reset/seed/migrate a live DB to make a test work. Use existing SQLite snapshot tooling for authorized backups; do not copy only the main file of a live WAL database.
- Do not overwrite files Ant or another contributor is editing. Inspect diffs immediately before edits; coordinate ownership when work overlaps. When multiple agents are explicitly authorized, assign disjoint paths and share contract changes before implementation; never revert another agent's work or kill unrelated processes.
- No commit, push, flash, SSH or deployment unless explicitly requested. Do not stage unrelated changes or use destructive Git cleanup. Keep shared configuration versionable inside this repository; do not install these skills globally.

## Project skills

Read only the relevant `.agents/skills/<name>/SKILL.md`; paths/commands inside skills are repository-relative unless stated otherwise. Combine skills only when the task crosses their boundaries.

- [attendance-integrity](.agents/skills/attendance-integrity/SKILL.md): check-in, SQLite, durable outbox, ACK/retry and deduplication.
- [face-model-validation](.agents/skills/face-model-validation/SKILL.md): artifacts, preprocessing/alignment, gallery contracts and CPU/Hailo parity.
- [aiot-test-triage](.agents/skills/aiot-test-triage/SKILL.md): regression selection, reproducible failures and diff impact.
- [pi-release-preflight](.agents/skills/pi-release-preflight/SKILL.md): Pi/Hailo readiness, source packages, env/services and backup/restore preparation.

Invoke explicitly with `$attendance-integrity`, `$face-model-validation`, `$aiot-test-triage` or `$pi-release-preflight`, or describe matching work. Local discovery follows [official skills guidance](https://learn.chatgpt.com/docs/build-skills). Start a new Codex session in this repository if new skills/instructions are missing. When launched at root, explicitly read the relevant nested instructions before subsystem work; starting in that subsystem also allows its instructions to enter the discovery chain.
