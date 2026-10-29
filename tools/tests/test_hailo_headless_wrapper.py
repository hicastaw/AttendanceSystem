"""Tests wrapper control flow using stubs; these do NOT test Hailo/GStreamer."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location("wrapper", Path(__file__).parents[1] / "hailo_face_headless.py")
wrapper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wrapper)


class WrapperTests(unittest.TestCase):
    def test_selects_sink_before_main_and_restores_on_failure(self):
        core = SimpleNamespace(GST_VIDEO_SINK="autovideosink")
        def main():
            self.assertEqual(core.GST_VIDEO_SINK, "fakesink")
            raise RuntimeError("synthetic error")
        with self.assertRaisesRegex(RuntimeError, "synthetic error"):
            wrapper.launch(SimpleNamespace(main=main), core)
        self.assertEqual(core.GST_VIDEO_SINK, "autovideosink")

    def test_rejects_changed_upstream_contract(self):
        with self.assertRaises(RuntimeError):
            wrapper.launch(SimpleNamespace(main=lambda: None), SimpleNamespace(GST_VIDEO_SINK="changed"))


if __name__ == "__main__":
    unittest.main()
