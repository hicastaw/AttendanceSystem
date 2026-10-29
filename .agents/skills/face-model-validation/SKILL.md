---
name: face-model-validation
description: Validate AIOT SCRFD-10G or ArcFace R50 artifacts, ONNX/HEF checksums and contracts, preprocessing/alignment, enrollment/gallery embeddings, or CPU-to-Hailo parity while separating legacy and experimental runtimes.
---

# Face model validation

1. Identify the requested runtime before loading artifacts. Use [current status](../../../docs/AIOT_CURRENT_STATUS.md) and inspect the relevant source:
   - Legacy live-worker path: `AIOT/edge/model_contract.py`, `face_detector.py`, `face_recognizer.py`, `AIOT/embedding-contract.json` and `AIOT/server/ai/core/face_engine.py` use YuNet/MobileFaceNet.
   - Experimental CPU: `AIOT/edge/experimental_cpu.py`, `reference_adapters.py`, `tools/model_cpu_lab.py` implement hash-bound SCRFD/five-point/R50 separately; preprocessing assumptions and `production_approved=false` remain explicit.
   - Hailo-10H HEF: `experimental_hailo.py`, `official_hailo_cpu.py`, `tools/inspect_hailo_reference.py` provide preparation/transport/inspection. Existence of a HEF or SDK stub test is not verified runtime integration.
   - Production activation: inspect `integration_gate.py`; the live worker rejects R50 activation. Do not silently route it through MBF or mock.
2. Record artifact SHA, real graph/runtime I/O names, dtypes/shapes, layout, resize/padding, color/range normalization, landmark order, alignment, output normalization and numeric mode. For HEF additionally inspect architecture, memory layout and quantization metadata. Check against evidence from the actual export/upstream contract; label assumptions explicitly.
3. Require full gallery-contract equality. A shared dimension, filename, R50 topology or similar output does not prove embedding compatibility. Keep MobileFaceNet, R50 ONNX and R50 HEF galleries separate; changed weights/alignment/numeric mode requires new enrollment or an explicitly validated migration. Never relabel existing profiles.
4. Run targeted geometry/contract/runtime tests from repository root with the configured native `$python`:

```powershell
& $python -B -m unittest discover -s tools/tests -p test_model_pipeline.py -v
& $python -B -m unittest discover -s tools/tests -p test_model_integration_preparation.py -v
& $python -B -m unittest discover -s tools/tests -p test_experimental_cpu.py -v
& $python -B tools/model_cpu_lab.py synthetic --help
```

With the pinned candidate artifacts available and the task requiring actual CPU validation, run this in a fresh process (FTZ is experimental and opt-in):

```powershell
& $python -B tools/model_cpu_lab.py synthetic --experimental --threads 4 --ftz
```

`AIOT_TEST_CPU_MODELS=1` enables the candidate-weight unittest; otherwise record its skip. The CLI uses real SCRFD on a blank negative image and R50 on synthetic geometry with injected landmarks for the positive path. It writes no attendance; neither path establishes real-face detection/recognition accuracy. `enroll`/`match` help describes isolated gallery operations; use only synthetic input and new paths under `.model-validation` or OS temp for tests.

5. For CPU/Hailo parity, compare the same inputs/crops and intermediate tensors with declared tolerances, including quantized/layout decoding; require actual HailoRT/device evidence before a hardware PASS. See [the CPU integration report](../../../MODEL_CPU_INTEGRATION_REPORT.md) for historical measurements, not new benchmark claims.
6. Report structural/runtime, numerical parity, provenance/license, identity accuracy/calibration and hardware results separately. Never infer training dataset/loss/fine-tuning, licensing, accuracy or compatibility from filenames, graph shapes or synthetic tests. Production remains blocked until the relevant evidence gates and an authorized integration exist; do not change live models/contracts/thresholds as a validation shortcut.
