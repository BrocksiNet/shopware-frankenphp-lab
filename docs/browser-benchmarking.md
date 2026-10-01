# Concurrent storefront browser measurements

This experiment complements the read-only Admin API benchmark. Real Chromium pages
load HTML, JavaScript, CSS and fonts at 1, 5 and 10 concurrent browser sessions.
It measures the homepage, search results and a seeded product detail page. It does
not perform checkout or create orders; guest-cart isolation remains a separate
[Playwright correctness test](testing.md#automated-chromium-checks-with-playwright).

The [published browser results](browser-measurements.md) include all page charts
and raw measurements from the 2026-10-01 matrix.

For a catalog with actual photography, see [music catalog setup and existing-shop
measurements](music-catalog.md). That separate runner accepts local origins and
checks visible images without recreating services or seeding data.

## Prepare the disposable lab

Requirements: Docker Compose 2.24.4 or newer, Node.js 22 or newer, and Chromium
installed through the pinned Playwright dependency. Run from the repository root.
The matrix temporarily recreates the `web` service; do not run another benchmark
or use the lab interactively at the same time.

```bash
docker compose --env-file benchmark.env up --build -d
# Wait for init to complete and web to become healthy.
npm ci
npx playwright install chromium
export ADMIN_BENCH_PASSWORD=shopware
node tools/seed-benchmark.mjs --seed-lab
node tools/seed-browser-domain.mjs --seed-lab
```

The second seeder adds `https://localhost:8443` to the existing storefront sales
channel with the same language, currency and snippet set. It preserves the HTTP
domain and uses a stable ID, so rerunning updates the same fixture. These fixed
loopback URLs and demo credentials are only for this disposable lab.

`compose.browser.yaml` mounts the browser-test Caddy configuration and exposes TLS
on loopback port 8443. The configurations retain the Shopware images' PHP routing, add local TLS,
disable HTTP/3 and use gzip on every runtime. The shipped defaults choose gzip
on FPM and Zstandard on FrankenPHP for Chromium; normalization removes that
compression difference from this comparison.
Caddy creates a local certificate; Playwright ignores its untrusted issuer. No CA
is installed on the host. Every measured navigation must report `h2` and gzip; an HTTP/1.1
fallback or different compression fails the experiment. No request interception is used, preserving normal
[Playwright browser-context caching](https://playwright.dev/docs/api/class-browsercontext).

## Run the matrix

```bash
node tools/browser-matrix.mjs --output measurements/browser-h2-cache-on
```

Use a new output directory for each experiment. Existing directories and raw
reports are never overwritten. The default matrix runs:

- PHP-FPM, FrankenPHP classic and FrankenPHP worker, using `benchmark.env` pins.
- Three repeats, rotating runtime order and concurrency order between repeats.
- 1, 5 and 10 isolated browser sessions, one tab per session, viewport 1280 × 720.
- Two excluded warm-up cycles per session, each visiting all three routes.
- Six measured cycles per session, with the same routes in homepage/search/product order.
- Shopware HTTP caching enabled, five PHP execution slots, and worker recycling off.

All sessions navigate the same route together. The next round waits for every
session to finish. Browser contexts, cookies, connections and asset caches persist
through warm-up and measurement at a given load level. New contexts/browser
processes are created for the next level. The server restarts once per runtime per
repeat, not between concurrency levels. Shared Shopware caches are retained and
warmed; this is not a cold-start comparison. Enabling HTTP caching does not imply
every route is a hit: raw samples include `Cache-Control` and `Age` headers.

The default produces **2,592 measured navigations and 864 warm-up navigations**:
3 runtimes × 3 repeats × (1 + 5 + 10) sessions × 3 pages × 6 measured cycles.
The report records source revision, relevant source-file hashes, PHP version,
image pins, browser version and host hardware. The matrix also verifies that
FrankenPHP has the intended classic/worker thread configuration.

Options allow changing the repeat count, session counts, cycles and observation
window. For example, a small setup check (not a publishable comparison):

```bash
node tools/browser-matrix.mjs --output measurements/browser-pilot \
  --repeats 1 --users 1 --samples 1 --warmup 1 --settle-ms 250
```

The runner restores classic mode on the original HTTP URL after completion or an
ordinary failure. On Ctrl+C it waits for the active bounded run, then restores.
A forced termination can bypass cleanup; restore explicitly if needed:

```bash
docker compose --env-file benchmark.env up -d --no-deps --force-recreate --wait web
```

The matrix owns the disposable lab's `web` configuration. It restores the standard
classic configuration, not an arbitrary override that happened to be active before
it started. The added HTTPS database domain remains available for another run.

## Metrics and correctness gates

Each navigation must return HTTP 200 over HTTP/2, render the expected route and
seeded product content where applicable, initialize Storefront JavaScript and load
web fonts. Wrong asset origins, HTTP failures, browser exceptions and console errors
fail the run. Failures are kept with a screenshot, the report stays incomplete and
the process exits unsuccessfully. There are no retries or filtered-out slow pages.

| Recorded metric | Meaning |
| --- | --- |
| TTFB | Navigation start to first response byte, including transport and server work |
| DOMContentLoaded | Navigation start to completion of the DOMContentLoaded event |
| Load | Navigation start to completion of the load event; not visual completion |
| FCP | Browser first-contentful-paint entry |
| Observed LCP | Latest largest-contentful-paint entry at the observation cutoff |
| Navigations per second | Completed measured pages divided by the whole measurement phase |

Run summaries use nearest-rank p50 and p95. The chart takes the median of the
three run p50 values, retaining the individual repeats as dots.

A `PerformanceObserver` starts before application scripts. The harness waits for
load and font readiness, then observes for a fixed 250 ms before reading the
[largest-contentful-paint entries](https://www.w3.org/TR/largest-contentful-paint/).
This is an explicitly bounded lab LCP observation, not field Core Web Vitals or a
full-visit LCP guarantee. It does not measure INP or CLS. All timings are in
milliseconds relative to the navigation's start.

The fixed observation pause, synchronization barriers, validation and browser work
are included in navigations/second. That rate is **not HTTP requests/second or a
server saturation ceiling**. It must not be compared numerically with the Admin
API's 911 req/s. Node driver CPU excludes Chromium subprocesses; it cannot rule
out browser CPU contention. Concurrent headless browsers and the server VM share
one development machine, without network/CPU throttling or a CDN.

The PHP patch version matches, but FPM uses NTS PHP on Alpine and FrankenPHP
uses ZTS PHP on Debian. This compares application stacks, not an isolated change
to the PHP request lifecycle.

Synthetic products have no uploaded product photography, and the starter theme
has little homepage content. These pages are reproducible fixtures, not a typical
production storefront. Add representative images/themes before drawing conclusions
about a real shop. A passing matrix does not establish multi-domain or checkout
correctness, extension compatibility, long-term stability or production capacity.

## Make the charts

```bash
uv run --with matplotlib tools/plot-browser-benchmark.py measurements/browser-h2-cache-on
```

The script requires a complete matrix and all successful raw reports. It produces
SVG and PNG charts for each page, showing TTFB and observed LCP against concurrent
sessions. Lines show the median of the run medians; small dots show each repeat's
median. These are not confidence intervals. Each raw report also contains per-page p95, FCP, DOMContentLoaded and load measurements; tails at the smallest sample size
are exploratory.

Keep the matrix and every referenced raw JSON report together. Failed/pilot runs
should be retained separately, not merged into a successful matrix. Browser traces
or screenshots can contain session information, so inspect artifacts before sharing.
