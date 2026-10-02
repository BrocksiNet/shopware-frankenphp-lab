# Performance measurements

> Historical record from 2026-09-30 / 2026-10-01. Commands, findings and upstream statuses describe that experiment, not the current lab. Use the [archive overview](../README.md) and [current setup](../../../../README.md) for orientation.
[Overview](../README.md)

These are dated lab results, with methods, raw evidence and limitations. Addresses and container names identify the measured targets; they are not deployment requirements. Run command examples from the `frankenphp/` directory and substitute your targets. Read [the published article](https://brocksi.net/blog/is-frankenphp-worth-it-for-shopware/) for the decision beyond throughput.

## Populated music storefront, 2026-10-01

All 2,592 measured browser navigations and 864 warm-ups passed across 27 runs
at 1, 5 and 10 concurrent sessions, with real image loading checked. At ten
sessions, search TTFB was 184.3 ms for same-code FPM and 98.4 ms for workers;
observed image LCP was 232 and 160 ms. Homepage/product LCP did not improve.
These plain HTTP URLs negotiated HTTP/1.1 with gzip. Caching was enabled on all
targets during the run, then restored to the original values.

The existing music build lacks the public lab's logging reset patch; trunk/FPM
has different code, catalog counts and language/currency. Keep this dataset
separate from the patched synthetic HTTP/2 and Admin comparisons. The
[full report, charts and raw data](https://github.com/BrocksiNet/shopware-frankenphp-lab/blob/main/docs/music-browser-measurements.md)
records the differences and reproduction commands.

## Configuration audit, 2026-10-01

The live worker configuration has OPcache and glibc, but its Composer autoloader
is unoptimized and timestamp validation is enabled for development. Preloading is
disabled; the existing generic preload entry points to a PHPStan development
container and should not be enabled for production. No tuning was applied during
the audit. See the [full audit and ordered tuning experiments](https://github.com/BrocksiNet/shopware-frankenphp-lab/blob/main/docs/frankenphp-tuning.md).

## Public Docker lab comparison without recycling, 2026-10-01

The public lab uses Shopware's FrankenPHP and Caddy/FPM images, a synthetic
fixture, pinned runtime image references and three-runtime benchmark commands.
All targets now include the logging reset correction for
[issue #21124](https://github.com/shopware/shopware/issues/21124), alongside the
existing kernel/plugin initialization correction. Worker request-count recycling
is disabled (`FRANKENPHP_LOOP_MAX=0`); Symfony's runtime is unmodified.

At 20 sessions with HTTP/2 and gzip, median throughput was **520.1 req/s for FPM,
559.3 for classic and 911.3 for workers**. Median run p95 was 185.2, 157.2 and
95.0 ms respectively. All 224,952 measured responses across 27 runs passed the
harness checks. Each run lasted 15 seconds after 3 seconds of warm-up; there were
three repeats at 1, 5 and 20 sessions. All runtimes had five PHP execution slots.

The uncompressed control at 20 sessions measured median throughput of 505.2,
480.3 and 759.9 req/s for FPM, classic and workers. Its 78,652 responses passed,
bringing the comparison reports to **303,604 validated responses across 36 runs**.
Both reports record response encoding, wire-body size and dataset signatures.

The same workers then completed ten one-minute measurements: 546,432 valid
responses, 885.4–927.1 req/s, and end-of-run container memory of 163.6–165.7 MiB.
Each worker exceeded 140,000 requests across the full no-recycling sequence.
Separate fresh-start controls measured medians of 940.4 req/s with a 500-request
limit and 851.0 without one; their ranges overlap. Those short sequential controls
do not establish an optimal interval or show that disabling recycling is always
faster. Across all five reports, 930,604 measured responses in 52 runs passed.

The public [measurement report](https://github.com/BrocksiNet/shopware-frankenphp-lab/blob/main/docs/measurements.md)
contains all runs, raw evidence, environment details and the longer worker test.
The [earlier 500-request comparison](https://github.com/BrocksiNet/shopware-frankenphp-lab/blob/main/docs/measurements-2026-10-01-recycling.md)
remains archived. It used code without the logging correction; do not attribute
the numeric difference solely to removing recycling.

All targets use PHP 8.4.26, but FPM uses NTS/Alpine and FrankenPHP uses ZTS/Debian.
This is a different dataset and image comparison from the earlier music-shop
experiments below. Do not pool their samples. The blog leads with the corrected
public-fixture results; these read-only tests do not establish full Shopware
compatibility or a universally safe worker lifetime.

## Performance comparison — 2026-09-30

The requested URLs are **different installations with different cache settings**.
The extra FPM control provides a closer runtime comparison:

| Setting | FrankenPHP | FPM control | Trunk FPM |
| --- | --- | --- | --- |
| URL | `http://music-de.localhost:8106` | `http://music-de.localhost:8105` | `http://music-trunk.localhost:8100` |
| Code | `868f25121f76` + existing local plugin-init fix | same checkout and volume | `58cb2b6df1c6` + local composer change |
| Database | swfp music demo | same swfp database | separate trunk music demo |
| Environment | prod, debug 0 | prod | prod |
| Shopware HTTP cache | disabled | disabled | enabled |
| PHP | 8.4.26 ZTS | 8.4.17 NTS | 8.4.17 NTS |
| Server | FrankenPHP 1.12.7, Caddy 2.11.4 | Caddy + FPM | Caddy + FPM |
| Worker configuration | 5 threads, loop max 0 | dynamic, max 5 children, start 2 | not normalized |

The worker and control have OPcache enabled, timestamp validation enabled and
JIT disabled in the inspected PHP configuration. Both load the probe plugin.
No container settings, application code or databases were normalized for this
run. PHP builds, web-server paths and persistent state still differ, so the
control is closer, not a perfectly isolated runtime experiment.

**Method:** host-side curl over HTTP/1.1, sequential concurrency 1, fresh curl
process and TCP connection for each request, no cookie jar, no compression,
no redirects followed, no asset downloads. For each route: 5 warm-up requests
per target, then 30 measured requests per target. Alternate forward/reverse
target order each round. Record `time_starttransfer` (TTFB), `time_total`, status,
bytes, Age and selected probe headers. p95 is the nearest-rank 29th sample of 30.
The final run was made after browser/functional checks, without concurrent test
traffic from this audit. Other local workloads were not controlled.

| Route | Worker 8106 median / p95 | FPM control 8105 median / p95 | Median reduction | Trunk FPM 8100 median / p95 |
| --- | --- | --- | --- | --- |
| `/` | 82.2 / 99.9 ms | 101.0 / 117.9 ms | 18.6% | 11.2 / 32.0 ms |
| `/Instruments/` | 59.9 / 73.5 ms | 79.7 / 98.6 ms | 24.8% | 10.5 / 12.3 ms |
| `/search?search=guitar` | 59.5 / 88.3 ms | 76.6 / 91.5 ms | 22.4% | 62.0 / 98.7 ms |
| `/account/login` | 30.4 / 36.2 ms | 45.4 / 56.4 ms | 32.9% | 32.4 / 34.6 ms |

All 360 measured responses were HTTP 200. In this sample the worker reduced
median TTFB by about **19–33%** relative to the uncached FPM control. This is
single-request latency, not a throughput, CPU-efficiency or capacity benchmark.
No-cookie requests also include anonymous session/context work.

Trunk's cached homepage and category were much faster than either uncached
runtime. Do not turn that into a claim that FPM itself is faster. Conversely,
do not attribute the worker/control difference entirely to worker mode while
PHP builds and rendering correctness differ. Search/account are shown as
observed; the presence of an Age header alone does not establish that the
complete response was served from cache.

Raw samples, including the 60 excluded warm-ups:
[`http-samples.json`](../measurements/2026-09-30/http-samples.json).
A reproducible request primitive is:

```bash
curl --silent --show-error --max-time 20 --http1.1 \
  -D /tmp/shopware-bench-headers -o /dev/null \
  -w '%{json}' 'http://music-de.localhost:8106/search?search=guitar'
```

Repeat with the three bases and four paths above, keeping the warm-up count,
request order and cache settings identical. Do not benchmark all targets under
load concurrently on the same machine.

**Browser observations:** one Chrome DevTools reload trace per homepage,
CPU 1x, no network throttling, existing browser sessions/cache (not cold loads):

| Homepage | TTFB | LCP | CLS |
| --- | --- | --- | --- |
| Worker 8106 | 135 ms | 402 ms | 0.00 |
| FPM control 8105 | 138 ms | 295 ms | 0.00 |
| Trunk FPM 8100 | 44 ms | 149 ms | 0.00 |

These are individual lab observations, not real-user Core Web Vitals or a
statistical browser comparison. No INP measurement was made. The worker trace
contains blocked JS/font loads ([Asset URLs retain another request host in worker mode](compatibility.md#asset-urls-retain-another-request-host-in-worker-mode)); it cannot establish equivalent rendering.
Trunk also has a missing `demostore-logo.png` (404), while the FPM control had no
console errors. No frontend optimization was applied.

## Concurrent Admin API benchmark: HTTP/2 and HTTP/1.1

The earlier curl table measures one request at a time using HTTP/1.1 and a new
connection per request. It does not measure Admin capacity. An Administration
screen can issue several API requests together, while other users do the same.
This benchmark measures that pattern with persistent connections and
simultaneous authenticated requests.

HTTP/2 lets several requests share one connection. It does not create additional
PHP workers: requests can still queue when the five worker threads or five FPM
children are busy. Both transport efficiency and PHP execution need to be
measured, so the same workload runs over both protocols.

**Transport:** the two local Caddy listeners on ports 8105 and 8106 already accept
HTTP/2 prior knowledge. The HTTP/2 runs use **h2c**, HTTP/2 over cleartext. Node's
HTTP/2 client does not silently fall back to HTTP/1.1, and the report records the
protocol of every response. This exercises framing and multiplexing, but not TLS,
ALPN negotiation or a browser's HTTPS connection establishment. It is not a
measurement of HTTP/3. The HTTP/1.1 control uses keep-alive, rather than the
fresh-connection curl method from [the storefront latency experiment](performance.md#performance-comparison--2026-09-30).

### Workload and interpretation

Each virtual user has a separate OAuth token for the same existing administrator
account. It sends a burst of four read-only POST searches concurrently, waits
for all four responses, then sends the next burst with no think time:

| Search endpoint | Criteria |
| --- | --- |
| `/api/search/product` | First 25 by product number, exact total, manufacturer association |
| `/api/search/category` | First 25 by ID, exact total |
| `/api/search/customer` | First 25 by ID, exact total |
| `/api/search/media` | First 25 by ID, exact total |

These endpoints represent catalog/customer administration activity, not a
captured browser trace. Orders were excluded because this database had no orders.
The workload does not create products, change customers or place orders. OAuth
requests are outside the timed interval. Token renewal, when needed, is also
outside timing. Separate tokens simulate concurrent sessions with identical
permissions; they do not test different users' ACLs or customer ownership.

For HTTP/2, each virtual user uses one persistent connection with up to four
streams. For HTTP/1.1, each has a keep-alive pool of up to four connections.
Responses request gzip compression. Every measured response must be HTTP 200,
use the requested protocol and return the same entity IDs/total as its untimed
preflight result. The preflight also requires matching nonempty datasets across
both runtimes. This avoids counting errors or responses with the wrong data as
successful throughput. No retries mask failures.

The client tests 1, 5, 10 and 20 virtual users (4, 20, 40 and 80 maximum requests
in flight), with three repeats of each runtime/protocol/load combination. Each
run uses two seconds of warm-up on the same connections, then eight seconds of
measurement. In-flight bursts are allowed to finish; throughput divides completed
successful requests by the actual elapsed time including that drain. Runtime
and protocol order alternate across the matrix. Targets are loaded sequentially
so they do not compete with each other during a measurement.

This is a closed-loop saturation test: each user waits for its own burst to
finish. It does not maintain a fixed arrival rate and can understate latency
under an externally imposed overload. Twenty such virtual users do not mean
only twenty human administrators can use the shop; real users pause between
interactions and trigger a different mix of requests.

Both targets use the same checkout/database, prod mode and five PHP execution
slots (FrankenPHP: five workers; FPM: dynamic pool, maximum five children).
FrankenPHP uses PHP 8.4.26 ZTS / Caddy 2.11.4, while FPM uses PHP 8.4.17 NTS /
Caddy 2.10.2. Those build differences remain a confounder. The database, host and
other development containers share resources; no production traffic forecast
should be inferred from this small local dataset.

### Measured results — 2026-09-30

The full matrix completed **156,312 measured requests with zero transport,
HTTP-status, protocol or dataset-validation failures**. Warm-up and OAuth calls
are excluded from that count. Rates below are medians of three runs; latency
columns are the median of each run's nearest-rank request p95. They are not
confidence intervals. Raw individual runs are retained because performance
changed substantially as the worker stayed alive.

**HTTP/2 (h2c), five PHP execution slots per runtime:**

| Virtual users | Max requests in flight | FPM req/s | Worker req/s | Throughput difference | FPM p95 | Worker p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 4 | 250.8 | 396.0 | +57.9% | 15.8 ms | 10.9 ms |
| 5 | 20 | 411.2 | 486.7 | +18.3% | 54.9 ms | 43.8 ms |
| 10 | 40 | 405.2 | 459.0 | +13.3% | 105.1 ms | 90.8 ms |
| 20 | 80 | 402.4 | 419.0 | +4.1% | 235.3 ms | 224.4 ms |

**HTTP/1.1 keep-alive control, same workload:**

| Virtual users | FPM req/s | Worker req/s | FPM p95 | Worker p95 |
| --- | --- | --- | --- | --- |
| 1 | 257.7 | 410.1 | 15.7 ms | 10.3 ms |
| 5 | 416.6 | 477.9 | 54.4 ms | 45.3 ms |
| 10 | 410.9 | 458.8 | 104.7 ms | 91.2 ms |
| 20 | 395.0 | 380.0 | 231.7 ms | 238.7 ms |

At 20 virtual users, HTTP/2 used 20 established connections and HTTP/1.1 used
80. No measured run opened new connections after warm-up. The load generator
used at most 0.41 CPU cores averaged over a measured interval. HTTP/2 reduced
connection count, but its throughput differences here are smaller than the
worker-lifetime effect below. These local results do not quantify its benefit
over a higher-latency network.

**Worker lifetime changed the result.** The main matrix kept
`FRANKENPHP_LOOP_MAX=0` and did not restart workers between runs. At 20 virtual
users over HTTP/2:

| Run | FPM req/s | Worker req/s | Worker container memory after run |
| --- | --- | --- | --- |
| Repeat 1 | 372.6 | 490.4 | 349 MiB |
| Repeat 2 | 411.7 | 419.0 | 397 MiB |
| Repeat 3 | 402.4 | 372.3 | 458 MiB |
| Separate run after worker restart | 389.8 | 830.3 | 289 MiB |

The fresh-worker follow-up had request p95 **103.0 ms** versus
**233.7 ms** for FPM, with zero failures. Only FrankenPHP workers
were restarted; FPM and the database kept running. This is a single diagnostic
run, not a sustained-capacity estimate.

Across the main matrix, the worker container grew from about 274 to 458 MiB;
FPM stayed around 485–497 MiB at the first/last snapshots. Containers have
different process layouts, so these totals are not a claim about per-worker
memory efficiency. The throughput decline alongside growth, and its recovery
after restarting, point to a worker-lifetime cost worth investigating. They do
not identify the retained objects or prove a specific garbage-collection cause.
The third repeat was slower than FPM at high load: quoting only the fresh-worker
speedup would hide that result.

**Follow-up diagnosis (2026-10-01):** the public lab reproduced progressive
slowdown with one non-recycling worker. Shopware's three Monolog decorators
inherited an empty `reset()` and did not forward it to the buffered handler.
Retained log records grew by one per request; explicit GC rose from 0.41 to
2.85 ms per request while request handling stayed near 4.5–4.8 ms. Forwarding
reset through the decorators bounded the retained records and largely removed
the decline, without changing GC or recycling. See the
[diagnostic report and standalone reproduction](../measurements/2026-10-01/slowdown/README.md).
This controlled follow-up identifies a cause in that build; the earlier raw
runs cannot retrospectively attribute all their memory growth to it.

Raw reports:
[full matrix](../measurements/2026-09-30/admin-api-http-benchmark.json) and
[restart diagnostic](../measurements/2026-09-30/admin-api-after-worker-restart.json).
Each report contains per-request timings and validation outcomes; endpoint
indices refer to the report's `workload` array. Container resource readings are
included for each measured run.

### Recycling follow-up: bounded worker lifetime

The [operations guide](setup-and-operations.md#operating-workers) suggests worker recycling while memory growth is unresolved.
A separate experiment tested `FRANKENPHP_LOOP_MAX=500`, with five workers and
otherwise the same setup, at 20 virtual users over HTTP/2. The FrankenPHP
container was recreated to apply the setting. FPM and the database stayed up.
Three runs used the same two-second warm-up and eight-second measurement.

| Metric, median of three runs | FPM | FrankenPHP, recycle after 500 requests |
| --- | --- | --- |
| Successful requests/second | 423.1 | 891.7 |
| Request p95 | 199.1 ms | 95.6 ms |
| Four-request burst p95 | 203.8 ms | 98.7 ms |
| Web-container CPU time per completed request | 10.35 ms | 4.78 ms |

Worker throughput was 909.6, 891.7 and 871.3 req/s; FPM ranged from 417.0 to
437.7 req/s. The median worker rate was **2.11× FPM
(110.8% more requests/second)**, with about
52% lower request p95. All **32,064 measured requests**
passed response validation. Worker-container memory ended each measured run at
approximately 141, 140 and 140 MiB; this short test does not establish long-term
memory stability.

This is the strongest performance result here, but it belongs to a specific
workload and recycling policy. The unrecycled results above must accompany it.
Recycling limits accumulated state; it does not fix incorrect state reuse
between two requests. PHP/Caddy build differences and the local environment
still prevent attributing the entire difference solely to the PHP runtime.

Raw report: [recycling at 500 requests](../measurements/2026-09-30/admin-api-recycle-500.json).
The original five-worker, `FRANKENPHP_LOOP_MAX=0`, HTTP-cache-disabled
configuration was restored and checked after the experiment.

To reproduce this policy in the swfp lane, from its Shopware checkout:

```bash
FRANKENPHP_WORKERS=5 FRANKENPHP_LOOP_MAX=500 FRANKENPHP_HTTP_CACHE=0 \
  podman compose up -d --no-deps --force-recreate frankenphp
```

Run the benchmark command below with `--users 20 --protocols h2 --repeats 3`
and a new report filename. Restore your original settings afterwards; for the
baseline used in this document:

```bash
FRANKENPHP_WORKERS=5 FRANKENPHP_LOOP_MAX=0 FRANKENPHP_HTTP_CACHE=0 \
  podman compose up -d --no-deps --force-recreate frankenphp
```

### Running the benchmark again

[`bin/admin-benchmark.mjs`](../bin/admin-benchmark.mjs) uses built-in Node APIs;
tested with Node 24, with no npm dependencies. Set `ADMIN_BENCH_PASSWORD` in your
environment to the existing test administrator's password, then run:

```bash
node ./bin/admin-benchmark.mjs \
  --target fpm=http://localhost:8105 \
  --target worker=http://localhost:8106 \
  --container fpm=shopware-frankenphp-web-1 \
  --container worker=shopware-frankenphp-frankenphp-1 \
  --output /tmp/shopware-admin-benchmark.json
```

Use `--username`, `--password-env`, `--users 1,5,10,20`, `--protocols h1,h2`,
`--seconds 8`, `--warmup 2` and `--repeats 3` to change the run. The optional
`--container name=CONTAINER` arguments sample that container's cgroup CPU time
and memory before/after each measured interval, using Podman. Omit them when
benchmarking a remote environment. CPU deltas are approximate container usage,
including small sampling overhead, and exclude database CPU. Memory snapshots
are container totals, not a per-worker leak measurement.

The script never restarts services or changes pool sizes. Targets must already
support HTTP/2, which is also used for untimed authentication/preflight. HTTPS
origins are supported through the client's normal certificate validation; the
recorded local run uses plain HTTP. The output file must not exist. Reports
contain timings, counts, response validation and resource samples, but no tokens,
credentials or customer response bodies. Each completed run is saved immediately.
A failed warm-up or measured run stops the matrix with a nonzero exit code and
`completed: false`; inspect failures before comparing throughput.

Client tests verify multiplexing, HTTP/1.1 connection reuse, gzip decoding,
timeouts, response validation and percentile calculation:

```bash
node --test ./bin/test-admin-benchmark.mjs
```

References: [Node HTTP/2 API](https://nodejs.org/api/http2.html),
[Caddy protocol options](https://caddyserver.com/docs/caddyfile/options#protocols),
and [curl HTTP/2 prior knowledge](https://curl.se/docs/manpage.html#--http2-prior-knowledge).

## Three-way HTTP/2 comparison — 2026-10-01

This follow-up adds **FrankenPHP classic mode**, with no worker block. It uses
five regular PHP threads (`num_threads 5`, `max_threads 5`), confirmed through the
runtime's thread endpoint. The worker runtime uses the same FrankenPHP image and
PHP configuration, five workers and `FRANKENPHP_LOOP_MAX=500`. FPM remains the
same-code/database control with a maximum of five children. HTTP caching is off.

Classic was temporarily served on port 8107 alongside FPM 8105 and worker 8106.
The benchmark runs only one target under load at a time and reverses target order
across repeats/load levels. The existing four-search workload, separate tokens for
the same administrator, gzip, persistent h2c connections and response validation
are unchanged. Each run has 2 seconds warm-up and 8 seconds measurement, draining
in-flight bursts. Three repeats at 1, 5, 10 and 20 sessions give 36 runs.

**137,384 measured responses; zero validation failures.** Each response is checked
for status, protocol, entity IDs and total count; this is not full semantic or ACL
validation. The PHP/Caddy versions still differ between FPM and FrankenPHP. The
classic-versus-worker comparison controls those builds more closely. Both use
PHP 8.4.26 ZTS / FrankenPHP 1.12.7 / Caddy 2.11.4; FPM uses PHP 8.4.17 NTS.
Uncontrolled local activity and short runs limit generalization.

| Sessions | FPM req/s | Classic req/s | Worker req/s | FPM p95 | Classic p95 | Worker p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 235.8 | 218.4 | 462.9 | 18.4 ms | 18.1 ms | 8.6 ms |
| 5 | 408.0 | 320.3 | 824.6 | 55.5 ms | 70.5 ms | 26.6 ms |
| 10 | 418.8 | 333.4 | 856.4 | 105.8 ms | 130.3 ms | 48.9 ms |
| 20 | 415.8 | 330.4 | 851.3 | 199.5 ms | 255.5 ms | 100.8 ms |

Cells are medians of run-level rates/p95 values, not pooled percentiles.
At 20 sessions, classic throughput was about 21% below FPM; workers were about
2.05× FPM and 2.58× classic. These results do not support a speed claim from merely
switching to FrankenPHP classic mode. The worker gain in this workload depends on
application reuse and the tested recycling policy, not on enabling HTTP/2 alone.

[Raw three-runtime matrix](../measurements/2026-10-01/admin-three-runtimes.json)
and [summary](../measurements/2026-10-01/admin-three-runtimes-summary.json).
The previous no-recycling decline remains relevant; this short run does not
establish long-term stability. The original worker loop limit of zero was restored.
