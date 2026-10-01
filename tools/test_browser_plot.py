"""Validation tests for browser charts, including image-aware existing shops."""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "plot", Path(__file__).with_name("plot-browser-benchmark.py")
)
_plot = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_plot)
load_matrix = _plot.load_matrix


class ChartInputTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        self.raw = {
            "completed": True,
            "summary": {},
            "samples": [
                {
                    "protocol": "http/1.1",
                    "contentEncoding": "gzip",
                    "visibleImages": [{"loaded": True}],
                }
                for _ in range(3)
            ],
        }
        self.matrix = {
            "completed": True,
            "targets": [{"name": "music"}],
            "configuration": {
                "repeats": 1,
                "users": [1],
                "samplesPerRoutePerUser": 1,
                "expectedProtocol": "http/1.1",
                "requireImages": True,
            },
            "runs": [
                {
                    "runtime": "music",
                    "users": 1,
                    "repeat": 1,
                    "file": "run.json",
                    "summary": {},
                }
            ],
        }

    def load(self):
        (self.directory / "matrix.json").write_text(json.dumps(self.matrix))
        (self.directory / "run.json").write_text(json.dumps(self.raw))
        return load_matrix(self.directory)

    def test_existing_shop_protocol_and_target_are_supported(self):
        self.assertEqual(self.load()["targets"], [{"name": "music"}])

    def test_failed_or_missing_images_cannot_be_charted(self):
        for images in [[], [{"loaded": False}]]:
            with self.subTest(images=images):
                self.raw["samples"][0]["visibleImages"] = images
                with self.assertRaises(ValueError):
                    self.load()

    def test_protocol_fallback_cannot_be_charted(self):
        self.raw["samples"][0]["protocol"] = "h2"
        with self.assertRaises(ValueError):
            self.load()

    def test_partial_matrix_cannot_be_charted(self):
        self.matrix["runs"] = []
        with self.assertRaises(ValueError):
            self.load()


if __name__ == "__main__":
    unittest.main()
