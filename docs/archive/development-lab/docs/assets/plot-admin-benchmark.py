"""Render the article chart from the recorded three-runtime benchmark.

Run: uv run --with matplotlib docs/assets/plot-admin-benchmark.py
"""

import json
from pathlib import Path
from statistics import median

import matplotlib.pyplot as plt

plt.switch_backend("Agg")

ASSETS = Path(__file__).resolve().parent
SOURCE = ASSETS.parents[1] / "measurements/2026-10-01/admin-three-runtimes.json"
report = json.loads(SOURCE.read_text())
assert report["completed"]
runtimes = ["fpm", "classic", "worker"]
labels = ["PHP-FPM", "FrankenPHP\nclassic", "FrankenPHP\nworker*"]
colors = ["#577087", "#a798bd", "#5831a5"]
rows = {
    name: [r for r in report["runs"] if r["target"] == name and r["users"] == 20]
    for name in runtimes
}
assert all(
    len(runs) == 3 and all(r["failures"] == 0 for r in runs) for runs in rows.values()
)
plt.rcParams.update(
    {"font.family": "DejaVu Sans", "font.size": 13, "svg.fonttype": "none"}
)
fig, axes = plt.subplots(1, 2, figsize=(14, 7.5))
fig.patch.set_facecolor("#faf9f6")
fig.subplots_adjust(left=0.165, right=0.94, top=0.69, bottom=0.29, wspace=0.51)
fig.text(
    0.045,
    0.92,
    "Shopware Admin: classic mode vs workers",
    fontsize=23,
    weight="bold",
    color="#20202b",
)
fig.text(
    0.045,
    0.855,
    "20 concurrent sessions  ·  5 PHP execution slots  ·  HTTP/2 cleartext",
    fontsize=14,
    color="#625d70",
)
for ax, field, title, unit, limit in zip(
    axes,
    ["successfulRps", "requestP95Ms"],
    ["Throughput: higher is better", "Request p95: lower is better"],
    ["requests / second", "milliseconds"],
    [1050, 350],
):
    ax.set_facecolor("#faf9f6")
    values = [median(r[field] for r in rows[name]) for name in runtimes]
    ax.barh(range(3), values, height=0.48, color=colors, zorder=2)
    for y, (name, value) in enumerate(zip(runtimes, values)):
        for offset, r in zip([-0.13, 0, 0.13], rows[name]):
            ax.scatter(
                r[field],
                y + offset,
                s=27,
                facecolor="white",
                edgecolor="#20202b",
                linewidth=1,
                zorder=3,
            )
        label_x = max(r[field] for r in rows[name]) + limit * 0.04
        ax.text(
            label_x,
            y,
            f"{value:.0f}",
            va="center",
            fontsize=15,
            weight="bold",
            color="#20202b",
        )
    ax.set_yticks(range(3), labels)
    ax.invert_yaxis()
    ax.set_xlim(0, limit)
    ax.set_xlabel(unit, fontsize=12, color="#625d70", labelpad=12)
    ax.set_title(title, loc="left", fontsize=15, weight="bold", pad=20, color="#20202b")
    ax.tick_params(axis="both", length=0, pad=10, labelcolor="#625d70")
    ax.grid(axis="x", color="#e3dfe8", zorder=0)
    for spine in ax.spines.values():
        spine.set_visible(False)
fig.text(
    0.045,
    0.17,
    "Bars and bold numbers: median of 3 runs. Dots: individual runs, not confidence intervals.",
    fontsize=12,
    color="#625d70",
)
fig.text(
    0.045,
    0.12,
    "* Workers recycled every 500 requests. Short local tests; FPM and FrankenPHP use different PHP builds.",
    fontsize=12,
    color="#625d70",
)
fig.text(
    0.045,
    0.065,
    "Measured 2026-10-01. Read-only Admin API searches. Results do not establish production compatibility.",
    fontsize=12,
    color="#625d70",
)
for extension in ["svg", "png"]:
    fig.savefig(
        ASSETS / f"admin-benchmark-comparison.{extension}",
        dpi=180,
        facecolor=fig.get_facecolor(),
    )
plt.close(fig)
