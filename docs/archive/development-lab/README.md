# Original development-lab evidence

This archive preserves the experiments from **2026-09-30 and 2026-10-01** that
preceded the portable Docker comparison. It was moved from `shopware-dev/frankenphp`
on 2026-10-02 after the [article was published](https://brocksi.net/blog/is-frankenphp-worth-it-for-shopware/).
The article and its artwork are maintained in the website repository, not here.

**Start with the [current lab](../../../README.md) for new experiments.** These
records use different PHP builds, mutable development checkouts, local hostnames
and, in some runs, different cache/recycling settings. Do not pool their samples
with the public fixture or treat historical recommendations as current defaults.
Failed checks and unfavorable results are retained alongside successful ones.

## Find the original evidence

| Material | Location |
| --- | --- |
| Storefront latency, Admin concurrency, recycling and classic-mode comparison | [Performance record](docs/performance.md) |
| Cross-domain asset defect and other lifecycle findings | [Compatibility record](docs/compatibility.md) |
| Probe results, cart/session checks and CLI assertions | [Verification record](docs/verification.md) |
| Earlier experimental configuration, including the former recycling workaround | [Historical setup notes](docs/setup-and-operations.md) |
| Logging buffer diagnosis, instrumented runners and standalone reproduction | [Slowdown investigation](measurements/2026-10-01/slowdown/README.md) |
| Asset-origin regression-test starting point | [Reproduction patch](fallback-url-worker-reproduction.patch) |
| Original kernel/plugin initialization correction | [Historical patch](pr-19121-plugin-init-fix.patch) |

All original raw measurement files remain under `measurements/`. Their contents
are unchanged. [Source hashes](migration-source-hashes.json) record the imported
files before navigation edits to Markdown; code, raw data and chart artifacts
retain those hashes. The source application and image versions are in the reports.
No benchmark or compatibility result was newly measured during this migration.

## Tools and reproduction

Run historical commands from this directory unless the individual report says
otherwise. The preserved `bin/admin-benchmark.mjs` and its tests match the earlier
Podman-based experiment; the maintained [Admin harness](../../../tools/admin-benchmark.mjs)
has since gained additional checks. The identical storefront verifier was not
duplicated: historical instructions now point to [the maintained verifier](../../../tools/verify.py).

The [probe plugin](probe/FrankenPhpProbe) and [header summarizer](bin/probe.sh) are
optional diagnostic tools, not installed automatically by the lab. To reproduce
probe measurements, copy the plugin into a disposable Shopware application's
`custom/plugins/`, refresh and activate it, then restart workers. Its headers
expose diagnostic state; use it only in a development/test environment. Existing
copies installed in other checkouts were not removed by this migration.

The [old chart renderer](docs/assets/plot-admin-benchmark.py) reads the archived
three-runtime data. It depicts the original 500-request recycling comparison,
not the later corrected 911 req/s result. From this directory:

```bash
node --test bin/test-admin-benchmark.mjs
uv run --with matplotlib docs/assets/plot-admin-benchmark.py
```

## Current follow-ups

The [patched no-recycling measurements](../../measurements.md),
[image-aware music storefront measurements](../../music-browser-measurements.md)
and [configuration audit](../../frankenphp-tuning.md) supersede the relevant earlier
comparisons. The [worker model](../../worker-model.md) remains a reusable guide
for extension authors. Machine-specific setup notes and the unpublished editorial
iterations were not imported into the lab.
