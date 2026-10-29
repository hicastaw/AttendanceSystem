# AIOT model artifacts

Laptop test pipeline uses the explicit descriptor
`r50-experimental-laptop.json`: **SCRFD-10G → five-point alignment → 512-D
ONNX recognizer**. The descriptor pins model SHA-256 and exact tensor names.
It is intentionally `production_approved: false` and its preprocessing,
training, export, provenance and license fields are **UNVERIFIED** assertions.
`tools/run_r50_laptop_test.mjs` refuses a changed artifact and never falls back
to YuNet/MobileFaceNet.

`ms1mv3_r50.onnx` is graph-valid only: SHA-256
`8bd26c17e760e4c88872be2208330d409a406e85413735188ad4e8bce2d44d8a`, input
`input.1` (`N×3×112×112` FP32), output `683` (`1×512` FP32). Its graph does
not attest InsightFace, MS1MV3, training, exporter, RGB/normalization or a
license. Keep it out of Git/releases and provide a model card/source URL,
license and preprocessing/export evidence before any production review.

Legacy YuNet/MobileFaceNet artifacts and galleries are retained solely for
explicit rollback/history. They are not in the R50 laptop test launcher path
and are never used as a fallback after an R50 error.
