# Reproduce the three-runtime comparison

The lab already uses images maintained in [shopware/docker](https://github.com/shopware/docker).
Shopware's [Docker deployment guide](https://developer.shopware.com/docs/guides/hosting/installation-updates/docker.html)
explains their production build and deployment workflow. This repository adds a
disposable source-based compatibility experiment; its patched development baseline
and HTTP worker override are not a production recommendation.

## Start the three runtimes

Use Docker Compose 2.24.4 or newer (`!override` support), or Compose v5.
For a new lab, use the pinned images from the first build onward. Wait for the
initializer to finish before seeding. An existing lab can also use this command,
but its volumes keep their original installation; record how they were built.

```bash
docker compose --env-file benchmark.env -f compose.yaml -f compose.benchmark.yaml up --build -d
```

| Service | Admin API origin | Image | PHP execution slots |
| --- | --- | --- | --- |
| `web` | `http://localhost:8080` | Shopware docker-base FrankenPHP, classic | 5 regular threads |
| `worker` | `http://localhost:8081` | Same FrankenPHP image | 5 HTTP workers, recycling at 500 requests; 1 extra regular thread |
| `fpm` | `http://localhost:8082` | Shopware docker-base Caddy + PHP-FPM | 5 static FPM children |

All services share the application volume, database and application configuration.
Only one runtime receives benchmark traffic at a time. Do not combine this override
with `compose.worker.yaml`: `web` must remain the classic baseline.

The extra origins are for Admin API comparison. The configured storefront domain
remains `http://localhost:8080`; they are not three independent storefront domains.
Health checks retain that public Host to avoid introducing a second asset origin.
This does not fix the known multi-domain worker issue.

`benchmark.env` freezes the runtime and initializer image indexes used
in the published run. Runtime indexes include AMD64 and ARM64. Without it, normal Compose commands use moving PHP 8.4
tags. Record resolved images for every new run; do not mix reports from different
builds. The source revision and Composer lock are checked in; frontend dependency
locks come from that source revision. Existing volumes are never automatically
upgraded or reinstalled by changing an image reference.
MariaDB retains its `10.11` tag; the environment record includes the exact resolved
database image used for the published run. A future pull may change that build,
so this is not a bit-for-bit lock of the entire stack.

## Seed repeatable synthetic data

Requires Node.js 22 or newer on the load-generator host. These standalone tools
do not execute Shopware PHP or frontend builds on the host.

```bash
export ADMIN_BENCH_PASSWORD=shopware
node tools/seed-benchmark.mjs --seed-lab
docker compose --env-file benchmark.env -f compose.yaml -f compose.benchmark.yaml restart web worker fpm
```

Use this only against the disposable lab. The explicit flag and loopback-only URL
guard prevent accidental remote seeding; loopback alone does not guarantee that a
different shop is disposable. The script uses Admin API upserts with stable IDs,
so a second run updates the same fixtures rather than adding duplicates:

- 500 simple products with prices, stock, categories and storefront visibility.
- 10 manufacturers and 50 categories below the existing navigation root.
- 100 synthetic guest customers using `example.invalid` addresses.
- 100 media metadata records. No image bytes, uploads or thumbnails are generated.

The script verifies fixture counts. The installed shop also has system categories
and potentially other bootstrap data. Start from a fresh lab for comparable totals;
do not merge real customer data into this workload. Record the full endpoint totals.

## Run HTTP/2 searches

```bash
mkdir -p measurements
node tools/admin-benchmark.mjs \
  --target fpm=http://localhost:8082 \
  --target classic=http://localhost:8080 \
  --target worker=http://localhost:8081 \
  --container fpm=shopware-frankenphp-lab-fpm-1 \
  --container classic=shopware-frankenphp-lab-web-1 \
  --container worker=shopware-frankenphp-lab-worker-1 \
  --users 1,5,20 --protocols h2 \
  --seconds 15 --warmup 3 --repeats 3 \
  --output measurements/lab-h2-gzip.json
```

The optional `--container` arguments capture cgroup CPU time and memory snapshots
through the Docker CLI. Adapt container names if your Compose project name differs,
or omit these arguments. Memory includes the container's charged memory, including
cache; it is not PHP heap usage or a peak measurement. Database CPU is excluded.

Each virtual session has its own token for the same administrator. It repeatedly
issues four parallel reads: product, category, customer and media searches, each
limited to 25 rows. There is no think time. Twenty sessions can have 80 requests
in flight; this is saturation traffic, not a count of supported human users.

The harness alternates runtime order, verifies HTTP/2 and compares nonempty entity
IDs/totals with its preflight baseline. Every response records status, latency,
wire-body byte count and actual Content-Encoding. Tokens and response bodies are
not written to reports. HTTP/2 uses cleartext prior knowledge, not browser TLS.

For an uncompressed control, repeat the command with `--encoding identity`,
`--users 20` and a new output path. To inspect longer behavior, use `--seconds 60`
and a new output path. Run these sequentially, never alongside another benchmark.
Successful HTTP/2 negotiation does not establish the performance of HTTPS/HTTP/3.

## Interpret and share results

Keep all runs, including failures. An invalid response stops the harness with a
nonzero exit status. A partial JSON file is not a completed result. Compare medians
and the individual runs, latency percentiles, failures, encoding and payload size.

Create a shareable summary retaining every run but omitting response samples:

```bash
python3 tools/summarize-benchmark.py measurements/lab-h2-gzip.json measurements/lab-h2-gzip-summary.json
```

The summarizer rejects incomplete or failed reports. Keep the original JSON as
evidence too; the published run includes a compressed copy.

The dated chart can be regenerated from its checked-in summary with
`uv run --with matplotlib tools/plot-benchmark.py`. Its bars start at zero and the
dots show individual runs, not confidence intervals.

This compares the shipped application stacks. Even with the same PHP patch version,
ZTS versus NTS, operating-system images, PHP extensions and server configuration can
differ. Compression controls narrow one variable; they do not isolate every cause.
Record host/VM resources and background load, and repeat on deployment-like hardware.

The [measurement report](measurements.md) separates this synthetic fixture from the
earlier private dataset. Neither validates checkout, arbitrary extensions, ACL
isolation, write throughput, browser rendering or sustained production capacity.

Stop only the additional services when finished:

```bash
docker compose -f compose.yaml -f compose.benchmark.yaml stop worker fpm
```
