# Recorded runtime comparison

Measured 2026-10-01 against a populated test shop, **not the empty catalog created
by this repository**. All runtimes used the same Shopware code/database, five PHP
execution slots, prod/debug off and HTTP cache disabled. Classic and worker mode
shared PHP 8.4.26 ZTS, FrankenPHP 1.12.7 and Caddy 2.11.4. The FPM control used
PHP 8.4.17 NTS, so it is not a perfectly isolated runtime comparison.

Each virtual session issued four parallel read-only Admin searches: products,
categories, customers and media. Separate tokens used the same administrator
account. HTTP/2 cleartext, gzip, persistent connections, no think time, 2 seconds
warm-up and 8 seconds measured per run. Targets ran sequentially with reversed
order across repeats/load levels. Three repeats per load/runtime produced 36 runs.

Worker recycling: 500 requests. Classic mode had no worker script. Previous
unrecycled workers slowed over time; these short runs do not prove stability.

| Sessions | FPM req/s | Classic req/s | Worker req/s | FPM p95 | Classic p95 | Worker p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 235.8 | 218.4 | 462.9 | 18.4 ms | 18.1 ms | 8.6 ms |
| 5 | 408.0 | 320.3 | 824.6 | 55.5 ms | 70.5 ms | 26.6 ms |
| 10 | 418.8 | 333.4 | 856.4 | 105.8 ms | 130.3 ms | 48.9 ms |
| 20 | 415.8 | 330.4 | 851.3 | 199.5 ms | 255.5 ms | 100.8 ms |

Each cell is a median of three run-level results (p95 values are not pooled).
137,384 measured responses passed status, protocol and entity ID/total validation.
Those checks do not validate every response field or the complete Admin UI.

Classic was about 21% slower than FPM at 20 sessions; workers were about 2.05× FPM
and 2.58× classic. This does not imply every shop will improve, or that a server
change alone is faster. Local machine activity, PHP build differences, short runs,
fixture sizes and the absence of mutations limit generalization. Production TLS,
real user capacity, full checkout and long-term behavior were not measured.

The source tool is [admin-benchmark.mjs](../tools/admin-benchmark.mjs). These numbers
are a recorded experiment, not expected output or performance guarantees for this
starter. The original request-level reports remain with the author's experiment;
only the aggregate summary is included here. Use your own representative synthetic
data and save new reports when evaluating a deployment.
