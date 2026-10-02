# Worker slowdown: buffered logs survive request resets

Investigation date: 2026-10-01.

**A reproducible cause was identified in the public Shopware lab:** three Shopware
Monolog decorators do not forward `reset()` to their wrapped handler. The production
`FingersCrossedHandler` therefore retains log records across successful requests.
The growing reachable object graph makes the runtime's per-request garbage
collection progressively more expensive. Forwarding reset through the decorators
removed the progressive growth and most of the throughput decline in this experiment.

This identifies an application lifecycle defect, not a demonstrated defect in
PHP's garbage collector or FrankenPHP. The objects are still reachable, so garbage
collection cannot simply free them.

## Where the reset stops

Shopware's production logging configuration uses a `fingers_crossed` handler with
an error activation threshold and no explicit buffer-size limit. Successful
requests produce lower-level records which remain buffered until activation,
closure, or reset.

The compiled container's `services_resetter` maps `monolog.handler.main` to the
outer `ExcludeFlowEventHandler`. Its handler chain is:

```text
Symfony service reset
  -> ExcludeFlowEventHandler
  -> ErrorCodeLogLevelHandler
  -> ExcludeExceptionHandler
  -> Monolog FingersCrossedHandler
```

All three Shopware wrappers extend `Monolog\Handler\AbstractHandler`. They inherit
its empty `reset()` implementation and do not delegate it. Consequently, the
reset stops at the first wrapper. Fixing only that wrapper would expose the same
problem at the next one. This remains reproducible with the lab's existing kernel
service-reset correction already applied.

The diagnostic correction adds a `reset()` override to each wrapper. It calls
`parent::reset()` and forwards to the inner handler when it implements
`Monolog\ResettableInterface`. The [patch](reset-forwarding.patch) is an experimental
starting point, not a merged or released Shopware fix.

## Controlled experiment

One persistent PHP worker, one regular PHP thread, `FRANKENPHP_LOOP_MAX=0`,
production mode, debug and HTTP cache off. Five synthetic Admin sessions issue four
parallel read-only searches each over h2c with gzip. Each repeat has a one-second
warm-up and ten measured seconds; the same worker survives all repeats.

The data, database, image and application are the public lab fixture. At that point the lab
used five workers and recycled them after 500 requests; these diagnostic
numbers deliberately use a different configuration and must not replace the
published capacity comparison.

Pinned source: `868f25121f764f41d6490fd032d6f28507be4e43`, with the lab's existing
kernel/plugin initialization correction. Lab revision:
`05c0f4e55b81517cda0b159d7dcd26d58934f7bf`.
PHP 8.4.26, FrankenPHP 1.12.7, Symfony Runtime 7.4.14, HttpKernel 7.4.20,
Monolog 3.12.1, MonologBundle 3.11.2. See [environment.json](environment.json).

| Variant | Repeats | First run req/s | Last run req/s | Request failures |
| --- | ---: | ---: | ---: | ---: |
| Original, uninstrumented | 8 | 225.2 | 128.5 | 0 |
| Original, phase timing | 8 | 196.0 | 129.1 | 0 |
| Original, timing and object inspection | 6 | 194.1 | 131.5 | 0 |
| Reset forwarding, same timing and object inspection | 8 | 205.9 | 195.3 | 0 |

All four reports completed; 51,716 measured responses passed validation. Warm-up
and authentication traffic are additional requests, so worker counters exceed
measured response counts.

### Time spent per request

The original phase-timing run compares requests 101–1,100 with 13,301–14,300.
Values below are averages across ten 100-request windows, excluding cold startup.

| Measurement | Early | Late |
| --- | ---: | ---: |
| Handle request and send response | 4.48 ms | 4.83 ms |
| Terminate | 0.008 ms | 0.008 ms |
| Explicit `gc_collect_cycles()` | 0.41 ms | 2.85 ms |
| PHP used memory at window end | 11.65 MiB | 33.94 MiB |

The added GC time accounts for most of the increasing instrumented service time.
GC happens after response sending but occupies the worker before it can handle
the next request, which affects throughput and queued-request latency.

With reset forwarding, explicit GC averaged 0.31 ms early and 0.41 ms late
(requests 16,901–17,900). PHP used memory was 9.73 and 10.96 MiB respectively.
It fluctuated around the warmed level rather than growing by a record per request.
Neither GC frequency nor worker recycling was changed by the correction.

### Retained objects

Original object snapshots show 2,031 log records after 2,000 requests and 10,031
after 10,000 requests. Each record also retains a
`Monolog\JsonSerializableDateTimeImmutable`. The total reachable object count grew
from 7,684 to 23,684, exactly 16,000 additional objects over 8,000 requests.

With reset forwarding, snapshots retained one log record at each sampled point
from request 2,000 through 16,000. Symfony resets services before the next request,
so seeing the current request's record after termination is expected.

Object inspection traverses accessible properties of the kernel/container and
loaded userland static properties. It is diagnostic sampling, not a complete PHP
heap dump; internal storage and some references are not visible. It writes class
names and counts, not log messages, request contents or tokens.

## Small reproduction without FrankenPHP

[reproduce-handler-reset.php](reproduce-handler-reset.php) sends 1,000 info records
through each decorator and the full chain, invoking reset after each simulated
request. It expects the inner buffer to be empty. This isolates the defect from
HTTP, the database, the worker runtime and the benchmark client.

Copy it into a container with the pinned Shopware dependencies:

```sh
docker cp reproduce-handler-reset.php CONTAINER:/tmp/reproduce-handler-reset.php
docker exec CONTAINER php /tmp/reproduce-handler-reset.php
```

The script assumes the application is at `/var/www/html`. On the original code,
all four cases retain 1,000 records and exit 1. With the three corrected classes,
all retain zero and exit 0. Saved results:
[original](reproduction-original.txt), [corrected](reproduction-reset-forwarding.txt).
The optional `--original` switch loads the three adjacent `original-*Handler.php`
copies, allowing the failing control to run even in the corrected container.

This standalone check is a regression-test starting point. A production fix should
add the assertions to Shopware's existing handler PHPUnit tests, including support
for inner handlers that do not implement the reset interface. The correction was
used only through container-specific read-only file mounts; shared application
files and the working Shopware checkout were not modified.

## Repeat the load experiment

Use a separate lab container with one worker, no recycling, and port 8084. Mount
[instrumented-runner.php](instrumented-runner.php), or
[graph-runner.php](graph-runner.php), over
`vendor/symfony/runtime/Runner/FrankenPhpWorkerRunner.php`. The originals are saved
alongside them. Start a fresh container for each variant. For the correction,
also mount the three corrected handler files over their matching source paths.

From the public lab repository:

```sh
ADMIN_BENCH_PASSWORD=shopware node tools/admin-benchmark.mjs \
  --target worker=http://localhost:8084 \
  --container worker=frankenphp-slowdown-diag \
  --users 5 --protocols h2 --seconds 10 --warmup 1 --repeats 8 \
  --output /tmp/new-slowdown-result.json
```

Copy `/tmp/diag-metrics.jsonl` and, for graph runs,
`/tmp/diag-objects.jsonl` out before removing the diagnostic container.
The runner preserves Symfony's per-request GC call and records phase totals every
100 requests. Object inspection runs every 2,000 requests. Its overhead means
instrumented results are diagnostic evidence, not headline benchmark numbers.

## Evidence and limits

- [Summary with all repeats and measurement windows](summary.json)
- Raw client reports: [original](uninstrumented.json),
  [timed](instrumented-v2.json), [object inspection](graph.json),
  [reset forwarding](reset-forwarding.json)
- Server-side phase samples: [original](instrumented-metrics.jsonl),
  [object inspection](graph-diag-metrics.jsonl),
  [reset forwarding](reset-forwarding-metrics.jsonl)
- Object snapshots: [original](graph-diag-objects.jsonl),
  [reset forwarding](reset-forwarding-objects.jsonl)

This is a short controlled diagnosis, not a long-duration stability certification.
It demonstrates a cause in the pinned public lab. The older populated-shop runs
did not capture these objects or phase timings, so this result does not prove
that every byte of their container growth or every slowdown had the same cause.
Container memory also includes Go, OPcache and allocator state; the memory numbers
above specifically use `memory_get_usage(false)` inside the PHP worker.

This initial diagnosis used isolated mounts and left the normal services unchanged.
A subsequent [public-lab comparison](https://github.com/BrocksiNet/shopware-frankenphp-lab/blob/main/docs/measurements.md)
applies the logging patch to all three runtimes and tests workers without recycling.
The finding is tracked in [Shopware issue #21124](https://github.com/shopware/shopware/issues/21124).
A search for “monolog reset” in Shopware issues and PRs returned no matches at the
time of investigation; that narrow search does not rule out an existing report.
