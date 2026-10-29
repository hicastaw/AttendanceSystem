"""Run the official Hailo face demo with a process-local fakesink.

This is a bring-up wrapper, NOT an attendance worker. Activate Hailo Apps' own
environment first. The reviewed upstream parser has no --video-sink flag.
"""
import importlib


def launch(app_module, core_module):
    original = getattr(core_module, "GST_VIDEO_SINK", None)
    if original != "autovideosink":
        raise RuntimeError("Upstream sink contract changed; review this wrapper against your checkout")
    if not callable(getattr(app_module, "main", None)):
        raise RuntimeError("Upstream face demo main() not available")
    core_module.GST_VIDEO_SINK = "fakesink"
    try:
        # GStreamerApp.__init__ reads this global BEFORE creating the pipeline.
        # Keep sys.argv intact so upstream validates all regular CLI options.
        return app_module.main()
    finally:
        core_module.GST_VIDEO_SINK = original


if __name__ == "__main__":
    core = importlib.import_module("hailo_apps.python.core.gstreamer.gstreamer_app")
    app = importlib.import_module("hailo_apps.python.pipeline_apps.face_recognition.face_recognition")
    launch(app, core)
