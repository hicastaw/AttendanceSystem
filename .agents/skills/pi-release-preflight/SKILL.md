---
name: pi-release-preflight
description: Prepare or inspect an AIOT Raspberry Pi 5 and AI HAT+ 2 Hailo-10H release, including source packaging, systemd/env/runtime dependencies, and isolated backup/restore or deployment readiness checks.
---

# Pi release preflight

1. Identify whether the request is a software preflight, source package, backup rehearsal or explicitly authorized device operation. Default to local inspection for preparation requests. Do not flash, SSH, install/start services, deploy or modify production data without an explicit request for that action.
2. Read only the relevant parts of [the existing runbook](../../../docs/SOFTWARE_ENVIRONMENT.md), [Pi handbook](../../../docs/RASPBERRY_PI5_ATTENDANCE_A_TO_Z.md) and [current status](../../../docs/AIOT_CURRENT_STATUS.md). Inspect `deploy/rpi5/` service/env templates, `AIOT/server/.env.example` and `AIOT/.env.example`; do not read real secrets. Distinguish older Orange Pi scripts from Pi5 templates.
3. Check paths, service user/permissions, StateDirectory, env placeholders, working directories, loopback ports, interpreter/native SQLite ABI, requirements closure and camera ownership. Windows wheel pins/venvs/node_modules are not an ARM runtime lock. For Hailo require the actual Hailo-10H architecture and OS/driver/firmware/HailoRT/compiler/HEF tuple with verified tensor metadata/parity. Refer model decisions to `face-model-validation`.
4. Run the software-only checks from repository root with the configured native `$python`:

```powershell
& $python tools/rpi_deployment.py preflight --software-only
& $python tools/check_deployment_doc.py
& $python tools/rpi_release.py git-readiness
& $python -B -m unittest discover -s tools/tests -p test_rpi_release.py -v
& $python -B -m unittest discover -s tools/tests -p test_rpi_deployment.py -v
```

`git-readiness` emits JSON and exits 1 when `status=BLOCKED`; inspect the missing/changed inventory as well as the exit code. It compares the runtime release inventory with HEAD, not every project instruction/skill file. Also inspect `git status --short` and `git check-ignore` for shared config readiness. Do not stage/commit to clear this gate unless asked.

5. When a package is requested, build to a new OS-temp path and verify against the reviewed working tree:

```powershell
$release = Join-Path ([IO.Path]::GetTempPath()) ('aiot-source-' + [guid]::NewGuid().ToString('N') + '.tar.gz')
& $python tools/rpi_release.py build "$release"
& $python tools/rpi_release.py verify "$release"
```

The allowlist includes untracked first-party runtime files and pinned legacy models, excludes experimental candidate weights and runtime data, and does not package root `AGENTS.md`/`.agents/skills`. These agent files travel with the repository checkout. Do not change the packager simply to make a configuration task pass.

6. Backup/restore rehearsals use only synthetic temporary DBs via `tools/rpi_deployment.py backup`/`restore`; tests cover committed WAL and refuse overwrite/sidecars. Restore to a new file and verify integrity/content; never cut over production or prune pending attendance. Managed retention is dry-run unless separately authorized; inspect `--help` before any mutation.
7. Report software/package/Git gates separately from actual hardware gates. `bash -n`, synthetic SDK tests and an archive manifest with `hardware_verified=false` cannot establish systemd boot, camera/Hailo, display/touch, SSD/power-loss, thermal performance or soak PASS. Leave unavailable device/runtime/artifact/accuracy gates BLOCKED or UNVERIFIED with the next evidence needed.
