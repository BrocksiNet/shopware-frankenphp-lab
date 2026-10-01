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
    runtimes = [t["name"] for t in report.get("targets", [])] or [
        "fpm",
        "classic",
        "worker",
    ]
    expected = len(runtimes) * config["repeats"] * len(config["users"])
    keys = {(run["runtime"], run["users"], run["repeat"]) for run in runs}
    expected_keys = {
        (runtime, users, repeat)
        for runtime in runtimes
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
                or s["protocol"] != config.get("expectedProtocol", "h2")
                or s["contentEncoding"] != "gzip"
                or (
                    config.get("requireImages")
                    and (
                        not s.get("visibleImages")
                        or any(not image["loaded"] for image in s["visibleImages"])
                    )
                )
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
    runtimes = [t["name"] for t in report.get("targets", [])] or [
        "fpm",
        "classic",
        "worker",
    ]
    labels = [t.get("label", t["name"]) for t in report.get("targets", [])] or [
        "PHP-FPM",
        "FrankenPHP classic",
        "FrankenPHP worker",
    ]
    palette = {
        "fpm": "#577087",
        "fpm-control": "#577087",
        "classic": "#a798bd",
        "worker": "#5831a5",
        "trunk-fpm": "#aa7547",
    }
    colors = [palette.get(runtime, "#577087") for runtime in runtimes]
    protocol = {"h2": "HTTP/2", "http/1.1": "HTTP/1.1"}.get(
        config.get("expectedProtocol", "h2"), "unknown protocol"
    )
    cache = "enabled" if config.get("httpCacheEnabled") else "disabled or unspecified"
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
            f"{report.get('title', 'Shopware storefront')}: {title.lower()}",
            fontsize=22,
            weight="bold",
            color="#20202b",
        )
        fig.text(
            0.05,
            0.85,
            f"Concurrent Chromium sessions · {protocol} + gzip · HTTP cache {cache}",
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
            f"{config['samplesPerRoutePerUser']} loads per page/session/run after {config['warmupCycles']} warm-up cycles. Warm browser caches.",
            fontsize=10,
            color="#625d70",
        )
        fig.text(
            0.05,
            0.03,
            (
                f"Existing storefronts · images checked · LCP cutoff {config['settleMs']} ms after load/fonts/images"
                if report.get("targets")
                else f"Patched trunk · local {report['host']['arch']} lab · LCP observed {config['settleMs']} ms after load/fonts · no product images"
            ),
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
