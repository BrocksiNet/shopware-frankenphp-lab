#!/usr/bin/env python3
"""Summarize a completed report without hiding failures or pooling percentiles."""

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median


def summarize(report):
    if not report.get("completed") or not report.get("runs"):
        raise ValueError("Only completed, nonempty reports can be summarized")
    groups = defaultdict(list)
    runs = []
    for run in report["runs"]:
        samples = run["samples"]
        if (
            run["failures"]
            or not samples
            or len(samples) != run["requests"]
            or any(not sample["valid"] for sample in samples)
        ):
            raise ValueError("Report contains failed or missing response samples")
        item = {key: value for key, value in run.items() if key != "samples"}
        item["responseEncodings"] = dict(Counter(s["encoding"] for s in samples))
        item["meanWireBodyBytes"] = sum(s["bytes"] for s in samples) / len(samples)
        runs.append(item)
        groups[(run["protocol"], run["users"], run["target"])].append(item)
    aggregates = []
    for (protocol, users, target), values in sorted(groups.items()):
        aggregates.append(
            {
                "protocol": protocol,
                "users": users,
                "target": target,
                "runs": len(values),
                "medianRps": median(v["successfulRps"] for v in values),
                "minRps": min(v["successfulRps"] for v in values),
                "maxRps": max(v["successfulRps"] for v in values),
                "medianRunP95Ms": median(v["requestP95Ms"] for v in values),
                "medianRunP99Ms": median(v["requestP99Ms"] for v in values),
                "validatedResponses": sum(v["requests"] for v in values),
            }
        )
    return {
        **{k: v for k, v in report.items() if k != "runs"},
        "runs": runs,
        "aggregates": aggregates,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = summarize(json.loads(args.report.read_text()))
    with args.output.open("x") as output:
        json.dump(result, output, indent=2)
        output.write("\n")
