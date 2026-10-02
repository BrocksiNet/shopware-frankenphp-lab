# Shopware compatibility and testing

Start in classic mode and record the source revision, PHP/FrankenPHP versions,
image digests, installed plugins and theme. Repeat the same tests after switching
to worker mode; a successful HTTP status is only the beginning.

## Automated Chromium checks with Playwright

The standalone browser harness requires Node.js 22 or newer on the test host.
It drives the running Docker lab; it does not build or execute Shopware on the host.
Start the lab and wait for `web` to be healthy, then run:

```bash
npm ci
npx playwright install chromium
npm run test:browser
```

Four smoke tests check the homepage, login page, search page and submitting the
search form. They assert rendered content, Storefront JavaScript availability,
loaded web fonts and same-origin scripts/styles/font links. Browser exceptions,
console errors, failed network requests and HTTP errors fail the checks. The
starter has no CDN; adapt the origin assertion explicitly if your shop uses one.

The guest-cart journey requires the synthetic fixture from the
[benchmark guide](benchmarking.md#seed-repeatable-synthetic-data):

```bash
export ADMIN_BENCH_PASSWORD=shopware
node tools/seed-benchmark.mjs --seed-lab
docker compose restart web
npm run test:browser:catalog
```

It opens a product, adds it through the Storefront JavaScript off-canvas cart,
alternates three rounds of cart checks between two isolated browser contexts,
and removes the item. Missing fixtures fail the test; they are not silently skipped.
It creates temporary guest carts, not orders or customer accounts. Closing browser
contexts does not delete their server-side sessions; use the disposable lab.

### Repeat against each runtime at the same storefront URL

Keep `http://localhost:8080`, the data, code, theme and cache setting unchanged.
The extra ports in `compose.benchmark.yaml` are Admin API endpoints, not configured
storefront domains. Use these commands sequentially from the lab directory:

```bash
# Classic baseline
docker compose --env-file benchmark.env up -d --no-deps --force-recreate --wait web
PW_OUTPUT_DIR=measurements/browser-classic PW_REPORT_DIR=measurements/browser-classic-html \
  npx playwright test --project=smoke --project=catalog

# Persistent HTTP workers
docker compose --env-file benchmark.env -f compose.yaml -f compose.worker.yaml \
  up -d --no-deps --force-recreate --wait web
PW_OUTPUT_DIR=measurements/browser-worker PW_REPORT_DIR=measurements/browser-worker-html \
  npx playwright test --project=smoke --project=catalog

# FPM control at the same public URL
docker compose --env-file benchmark.env -f compose.yaml -f compose.fpm.yaml \
  up -d --no-deps --force-recreate --wait web
PW_OUTPUT_DIR=measurements/browser-fpm PW_REPORT_DIR=measurements/browser-fpm-html \
  npx playwright test --project=smoke --project=catalog

# Restore the default classic service
docker compose --env-file benchmark.env up -d --no-deps --force-recreate --wait web
```

Each runtime has five PHP execution slots. The tests run serially without retries,
so failures are not hidden by a later pass. The HTML and JSON reports retain test
results and navigation timing attachments; failed tests also retain a screenshot
and a [Playwright trace](https://playwright.dev/docs/test-use-options#recording-options).
Use a new output directory for each experiment; Playwright replaces previous output
at the chosen path. `STOREFRONT_URL` overrides the default URL for another configured
lab domain. Reports/traces can contain session data, so review before sharing them.

These are correctness checks, not a storefront capacity benchmark. Navigation
TTFB, DOMContentLoaded, load time and negotiated protocol are diagnostic samples,
without controlled warm-ups or statistical comparison. Chromium uses ordinary
local HTTP here; it does not exercise the Admin harness's HTTP/2 cleartext mode.
The current run keeps Shopware HTTP caching disabled. A cached HTTPS browser
performance comparison remains separate work.

On 2026-10-01, all five tests passed in each runtime on the corrected pinned build:
**15/15 passed**, with zero retries or skips. A separate negative control blocked
font requests and confirmed the browser checker rejects the page. The compact
[result record](results/2026-10-01-browser.json) records each test outcome.
This single-domain journey does not establish multi-domain safety, authenticated
customer isolation, checkout, payment correctness or sustained performance. With
five server workers, it also cannot guarantee that every A/B pair hits the same
worker; use a one-worker diagnostic setup for deterministic state-leak reproduction.

### Navigation timings from the initial browser checks

The same [result record](results/2026-10-01-browser.json) preserves all 33 navigation
samples, including the slower first visits. For the direct search-page visit:

| Single search-page sample | FPM | Classic | Worker |
| --- | ---: | ---: | ---: |
| TTFB | 107.3 ms | 101.1 ms | 87.4 ms |
| DOMContentLoaded | 161.2 ms | 153.6 ms | 141.0 ms |
| Load event | 180.6 ms | 171.7 ms | 158.5 ms |

All values are measured from navigation start; load time is not a visual-completion
metric. The first homepage TTFB was 567.8 ms for FPM, 118.0 ms for classic and
618.9 ms for workers. A later homepage visit measured 75.8, 76.6 and 69.5 ms,
respectively. Classic was already running, whereas FPM and workers had just been
recreated. Those samples mix different warm-up states and cannot rank the runtimes.
No FCP, LCP, CLS or INP was collected in this first correctness suite. Repeated,
controlled browser measurements are needed before deriving a performance claim.

## Concurrent browser performance matrix

For repeated page timings at 1, 5 and 10 concurrent sessions, use the
[HTTP/2 browser benchmark guide](browser-benchmarking.md). It adds controlled
warm-up, three runtime-order rotations, cache-enabled HTTPS runs, FCP/observed LCP,
raw samples and reproducible charts. This is separate from the quick correctness
suite and supersedes its single-navigation timings for comparison.

## What to test in this lab

1. Open the storefront and Administration in a browser. Check JavaScript and font
   requests, console errors, CSS, login, navigation and the network responses.
2. Create a synthetic category and product with stock, price, visibility and media;
   assign them to the storefront. Test listing, search and product detail.
3. Add to a guest cart. Interleave two browser profiles and verify that changing
   one cart never changes the other. Repeat logged-in then anonymous requests.
4. With test customer data and a test payment method, exercise registration,
   addresses, discounts, shipping, checkout and order creation. These journeys have
   not been comprehensively verified by this project.
5. Add your actual theme and plugins, then repeat. Confirm HTTP plugin behavior,
   not just successful CLI activation. Restart the worker service after changes.
6. Add a second configured storefront domain/language. Alternate A → B → A, then
   reverse the order after a worker restart. Verify assets, language, prices and
   customer context. For deterministic diagnosis, temporarily use one worker.
7. Test exception paths, idle database connections, deployments and rollback. Run
   varied traffic long enough to observe memory and throughput after warm-up.

The loop limit is a mitigation, not evidence of clean state. A request can inherit
incorrect state long before recycling. Plugin services, event subscribers, Twig
extensions and decorators may all retain objects in worker mode. Pass the current
Shopware context to operations; verify that resettable services actually reset.

The [worker model](worker-model.md) explains how to review extension state. The
[historical compatibility record](archive/development-lab/docs/compatibility.md)
preserves the original reproductions and their raw evidence.

## Upstream work and limitations

Status checked 2026-10-01; these links can change after publication.

| Item | Meaning for this pinned lab |
| --- | --- |
| [Kernel reset PR #19121](https://github.com/shopware/shopware/pull/19121) | Still open; the pinned baseline includes an earlier version, plus the local plugin-init correction |
| [Twig globals PR #21031](https://github.com/shopware/shopware/pull/21031) | Merged upstream, but not included in this older pinned source; do not equate merged with installed |
| [Logging reset issue #21124](https://github.com/shopware/shopware/issues/21124) | Local patch forwards resets through three core Monolog decorators; verify with `tools/verify-log-reset.php` |
| [Asset origin issue #21063](https://github.com/shopware/shopware/issues/21063) | Open; a shared service can retain the first domain's asset origin in workers |
| [Long-running compatibility epic #13921](https://github.com/shopware/shopware/issues/13921) | Tracks broader work; this lab does not resolve it |

Previous tests found log records accumulating because core logging decorators did
not forward service resets. This lab now applies that experimental correction and
disables request-count recycling to measure worker behavior beyond 500 requests.
The [measurement report](measurements.md) records the tested duration and scope. Full checkout,
payments, failure recovery and arbitrary third-party extensions remain unverified.
Classic mode avoids persistent application objects, but that alone does not prove
complete Shopware/runtime/extension compatibility.

## Optional command-line checks

For a controlled three-runtime comparison with repeatable sample data, follow
[the benchmark guide](benchmarking.md). The single-target command below is useful
for checking an individual service.

The storefront verifier checks the homepage, search and login routes. Use
`--search-term` for a query suited to your catalog. The optional `--cart` check
requires a simple add-to-cart product on the homepage. Inspect
`python3 tools/verify.py --help` before enabling customer login checks. It can check
content markers, asset origins, guest carts and customer/anonymous isolation.

The read-only Admin benchmark supports HTTPS or local HTTP/2 prior knowledge.
Set `ADMIN_BENCH_PASSWORD` to the local administrator's password without committing
it. With synthetic data populated in all four searched entities:

```bash
node tools/admin-benchmark.mjs \
  --target classic=http://localhost:8080 \
  --protocols h2 --users 1,5,10,20 --repeats 3 \
  --output classic-results.json
```

Switch to workers and repeat with `--target worker=http://localhost:8080` and a
new output filename. Keep pool size, data and caching unchanged. These are
sequential runtime runs, not an automatically interleaved controlled experiment.
The benchmark checks response status/protocol and entity IDs/totals. It does not
verify every field, ACL combination, write operation or full Administration UI.

Harness checks need no running Shopware:

```bash
node --test tools/test-*.mjs
python3 -m unittest discover -s tools -p test_verify.py -v
```

## Health checks can trigger the asset-origin bug too

During clean-start verification, a worker first served the internal health check
with host `localhost:8000`. Subsequent public requests on `localhost:8080` emitted
assets on port 8000. The smoke verifier caught three origin failures. This is
another reproduction of [#21063](https://github.com/shopware/shopware/issues/21063).

The health check now connects to the internal port but explicitly sends
`Host: localhost:8080`, matching the public storefront. Restarting workers removes
the already captured origin. This avoids an artificial second host in the starter;
it does **not** fix the shared asset service or establish multi-domain safety.
If you change the public URL, update both `APP_URL`/the sales-channel domain and
that header. Always retest real multiple-domain setups separately.
