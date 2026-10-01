# Corrected logging lifecycle, no worker recycling

These reports use the pinned lab source plus `plugin-init.patch` and
`monolog-reset.patch`, applied equally to FPM, classic and worker mode. Worker
request-count recycling is disabled (`FRANKENPHP_LOOP_MAX=0`). Symfony's runtime
is unmodified; no diagnostic PHP instrumentation is installed.

See [the measurement report](../../measurements.md) for results and scope, and
[the benchmark guide](../../benchmarking.md) for commands and an existing-volume
update procedure. `environment.json` records image IDs, handler checksums and patch
hashes. The previous 500-request comparison remains in the adjacent dated folder.

The worker timeline samples the read-only FrankenPHP thread endpoint every
30 seconds during the no-recycling matrix, compression control and longer run.
Its memory values are the thread endpoint's PHP memory readings, not container
RSS. The benchmark summaries separately record cgroup CPU and memory snapshots.

Raw reports are gzip-compressed JSON, with SHA-256 checksums. Summaries retain all
run-level results and omit individual response samples. No access tokens or
response bodies are saved by the benchmark harness.
