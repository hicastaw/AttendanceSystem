"""Optional LOCAL smoke tests for the existing MBF model, NOT R50/Hailo accuracy."""
import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
EDGE = ROOT / "AIOT" / "edge"
# The recognizer is loaded by file path below, so make its first-party sibling
# imports resolve exactly as they do when the edge worker is the entrypoint.
if str(EDGE) not in sys.path:
    sys.path.insert(0, str(EDGE))
AVAILABLE = all(importlib.util.find_spec(name) is not None for name in ("cv2", "numpy", "onnx", "onnxruntime"))


@unittest.skipUnless(AVAILABLE, "Install optional model-audit dependencies to run this LOCAL test")
class ExistingModelTests(unittest.TestCase):
    def test_opencv_onnxruntime_same_crop(self):
        import cv2
        import numpy as np
        import onnx
        import onnxruntime as ort
        model = ROOT / "AIOT/edge/model/w600k_mbf.onnx"
        onnx.checker.check_model(onnx.load(str(model)))
        spec = importlib.util.spec_from_file_location("recognizer", ROOT / "AIOT/edge/face_recognizer.py")
        recognizer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(recognizer)
        crop = np.random.default_rng(0).integers(0, 256, (112, 112, 3), dtype=np.uint8)
        actual = recognizer.FaceRecognizer(str(model)).get_embedding(crop)
        blob = cv2.dnn.blobFromImage(crop, 1 / 127.5, (112, 112), (127.5,)*3, swapRB=True)
        session = ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])
        reference = session.run(None, {session.get_inputs()[0].name: blob})[0].reshape(-1)
        reference = reference / np.linalg.norm(reference)
        self.assertEqual(actual.shape, (512,))
        self.assertTrue(np.isfinite(actual).all())
        self.assertAlmostEqual(float(np.linalg.norm(actual)), 1.0, places=5)
        cosine = float(actual @ reference)
        np.testing.assert_allclose(actual, reference, atol=1e-4, rtol=1e-3)
        self.assertGreaterEqual(cosine, 0.999)
        print(f"LOCAL MBF same-crop OpenCV/ORT cosine={cosine:.8f}; not face accuracy/Hailo")


if __name__ == "__main__":
    unittest.main()
