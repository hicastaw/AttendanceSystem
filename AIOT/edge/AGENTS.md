# Python edge worker

Applies below `AIOT/edge/`, in addition to the repository instructions. Commands below run from repository root with `$python` configured there.

- `main.py` owns camera acquisition and cleanup. `stream_server.py` serves copies of preview buffers and queues capture work; it must not open a second camera. Enrollment/inference runs through the camera owner. Preserve buffer copies, request release, stale-frame guards and cleanup on startup failure/shutdown.
- Trace detection -> alignment -> embedding -> gallery contract -> cosine/margin -> consensus -> attendance decision before changing recognition. Reset votes when capture, gallery revision, invalid/stale frames or recovery invalidates identity continuity. Pause attendance during active enrollment.
- Live legacy path: `face_detector.py`, `face_recognizer.py`, `model_contract.py`, `AIOT/embedding-contract.json`. YuNet/affine-three-point/MobileFaceNet is distinct from `experimental_cpu.py` SCRFD/five-point/R50. `integration_gate.py` deliberately rejects live R50 activation; do not bypass this through environment flags or fallback.
- `experimental_hailo.py` is transport/metadata preparation; `official_hailo_cpu.py` and `reference_adapters.py` do not establish an accepted Hailo-10H attendance pipeline. Validate real HEF architecture, tensor layout/quantization, postprocessing, CPU parity and new enrollment before any separately authorized activation.
- Gallery compatibility requires the full contract, artifact checksums, preprocessing/alignment and numeric mode. Dimension/filename alone is insufficient. Never relabel or merge MobileFaceNet, R50 ONNX or R50 HEF vectors; use a new isolated gallery and explicit migration evidence.
- `attendance_service.py` creates only check-ins. `outbox.py` durably reserves a member/occurrence before transport; `api_client.py` retries the same UUID and immutable payload. Validate ACK identity before atomically recording ACK/confirmed state. Blocked/unacknowledged rows remain durable; do not delete them or mark them sent on enqueue/timeout.
- Preserve bounded recovery and delivery/storage budgets in `recovery.py`/`api_client.py`, explicit requeue with the original UUID, and fail-closed checksum/schema/programming errors. Recovery never switches to mock or another model.
- Readiness in `health.py`/`worker_status.py` requires actual fresh capture/inference progress and valid storage/gallery, not just a live thread or old JPEG. Watchdog and native-driver behavior still need Pi validation.

Targeted checks (choose the affected boundary):

```powershell
& $python -B -m unittest discover -s tools/tests -p test_attendance_decision.py -v
& $python -B -m unittest discover -s tools/tests -p test_outbox_delivery.py -v
& $python -B -m unittest discover -s tools/tests -p test_autonomous_reliability.py -v
& $python -B -m unittest discover -s tools/tests -p test_camera_provider.py -v
& $python -B -m unittest discover -s tools/tests -p test_experimental_cpu.py -v
```

Use existing synthetic geometry/runtime tests and failure injection for lost ACK, restart, corrupt/mismatched gallery, stale camera, DB/storage faults and cleanup. Candidate-weight tests require `AIOT_TEST_CPU_MODELS=1` and local artifacts; a skip must remain visible. No camera, real faces or hardware benchmark is implied by these tests. Load the integrity/model skills for their respective workflows; see [architecture](../../docs/AIOT_ARCHITECTURE.md) for component boundaries.
