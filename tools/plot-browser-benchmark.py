"""Plot measured browser timings: uv run --with matplotlib tools/plot-browser-benchmark.py DIR."""

import argparse
import json
from pathlib import Path
from statistics import median

import matplotlib.pyplot as plt

plt.switch_backend("Agg")


def load_matrix(directory):
    report = json.loads((directory / "matrix.json").read_text())
    if not report.get("completed"):
        raise ValueError("Refusing to chart an incomplete matrix")
    runs = report["runs"]
    config = report["configuration"]
    expected = 3 * config["repeats"] * len(config["users"])
    keys = {(run["runtime"], run["users"], run["repeat"]) for run in runs}
    expected_keys = {
        (runtime, users, repeat)
        for runtime in ("fpm", "classic", "worker")
        for users in config["users"]
        for repeat in range(1, config["repeats"] + 1)
    }
    if len(runs) != expected or keys != expected_keys:
        raise ValueError("Missing or duplicate runtime/concurrency/repeat")
    for run in runs:
        raw = json.loads((directory / run["file"]).read_text())
        count = run["users"] * config["samplesPerRoutePerUser"] * 3
        if (
            not raw["completed"]
            or len(raw["samples"]) != count
            or any(
                s.get("error")
                or s["protocol"] != "h2"
                or s["contentEncoding"] != "gzip"
                for s in raw["samples"]
            )
        ):
            raise ValueError("Invalid browser run")
        if raw["summary"] != run["summary"]:
            raise ValueError("Summary does not match the raw run")
    return report


def plot(directory):
    report = load_matrix(directory)
    config = report["configuration"]
    users = sorted(config["users"])
    runtimes = ["fpm", "classic", "worker"]
    labels = ["PHP-FPM", "FrankenPHP classic", "FrankenPHP worker"]
    colors = ["#577087", "#a798bd", "#5831a5"]
    plt.rcParams.update(
        {"font.family": "DejaVu Sans", "font.size": 12, "svg.fonttype": "none"}
    )
    for route, title in [
        ("homepage", "Homepage"),
        ("search", "Search results"),
        ("product", "Product detail"),
    ]:
        fig, axes = plt.subplots(1, 2, figsize=(13, 7))
        fig.patch.set_facecolor("#faf9f6")
        fig.subplots_adjust(left=0.08, right=0.97, top=0.72, bottom=0.29, wspace=0.25)
        fig.text(
            0.05,
            0.92,
            f"Shopware storefront: {title.lower()}",
            fontsize=22,
            weight="bold",
            color="#20202b",
        )
        fig.text(
            0.05,
            0.85,
            "Concurrent Chromium sessions · HTTP/2 + gzip · HTTP cache enabled",
            fontsize=13,
            color="#625d70",
        )
        for ax, field, heading in zip(
            axes,
            ["ttfbMs", "lcpObservedMs"],
            ["Time to first byte", "Observed largest contentful paint"],
        ):
            ax.set_facecolor("#faf9f6")
            for runtime, label, color in zip(runtimes, labels, colors):
                groups = [
                    [
                        run["summary"][route][field]["median"]
                        for run in report["runs"]
                        if run["runtime"] == runtime and run["users"] == user
                    ]
                    for user in users
                ]
                ax.plot(
                    users,
                    [median(group) for group in groups],
                    marker="o",
                    color=color,
                    label=label,
                    linewidth=2,
                )
                for user, group in zip(users, groups):
                    ax.scatter([user] * len(group), group, color=color, s=16, alpha=0.5)
            ax.set_title(heading, loc="left", fontsize=14, pad=15)
            ax.set_ylim(bottom=0)
            ax.set_xticks(users)
            ax.set_xlabel("Concurrent browser sessions")
            ax.set_ylabel("Milliseconds · lower is better")
            ax.grid(axis="y", color="#e3dfe8")
            for spine in ax.spines.values():
                spine.set_visible(False)
        handles, legend_labels = axes[0].get_legend_handles_labels()
        fig.legend(
            handles,
            legend_labels,
            loc="lower center",
            bbox_to_anchor=(0.5, 0.16),
            ncol=3,
            frameon=False,
        )
        fig.text(
            0.05,
            0.12,
            f"Lines: median of {config['repeats']} run medians. Small dots: individual run medians, not confidence intervals.",
            fontsize=10,
            color="#625d70",
        )
        fig.text(
            0.05,
            0.075,
            f"{config['samplesPerRoutePerUser']} loads per page/session/run after {config['warmupCycles']} warm-up cycles. Warm browser caches; {config['phpSlots']} PHP slots.",
            fontsize=10,
            color="#625d70",
        )
        fig.text(
            0.05,
            0.03,
            f"Patched trunk · local {report['host']['arch']} lab · LCP observed {config['settleMs']} ms after load/fonts · no product images",
            fontsize=10,
            color="#625d70",
        )
        for ext in ["svg", "png"]:
            fig.savefig(
                directory / f"storefront-{route}.{ext}",
                dpi=180,
                facecolor=fig.get_facecolor(),
            )
        plt.close(fig)
        svg = directory / f"storefront-{route}.svg"
        svg.write_text(
            "\n".join(line.rstrip() for line in svg.read_text().splitlines()) + "\n"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    plot(args.directory)
