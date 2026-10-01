import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "summarizer", Path(__file__).with_name("summarize-benchmark.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SummaryTest(unittest.TestCase):
    def report(self):
        return {
            "completed": True,
            "runs": [
                {
                    "target": "worker",
                    "protocol": "h2",
                    "users": 20,
                    "failures": 0,
                    "requests": 1,
                    "successfulRps": value,
                    "requestP95Ms": value,
                    "requestP99Ms": value,
                    "samples": [{"valid": True, "encoding": "gzip", "bytes": 100}],
                }
                for value in [10, 20, 90]
            ],
        }

    def test_medians_and_individual_runs_are_preserved(self):
        result = module.summarize(self.report())
        self.assertEqual(result["aggregates"][0]["medianRps"], 20)
        self.assertEqual(result["aggregates"][0]["validatedResponses"], 3)
        self.assertEqual(len(result["runs"]), 3)
        self.assertEqual(result["runs"][0]["responseEncodings"], {"gzip": 1})

    def test_partial_and_invalid_reports_are_rejected(self):
        report = self.report()
        report["completed"] = False
        with self.assertRaises(ValueError):
            module.summarize(report)
        report["completed"] = True
        report["runs"][0]["samples"][0]["valid"] = False
        with self.assertRaises(ValueError):
            module.summarize(report)


if __name__ == "__main__":
    unittest.main()
