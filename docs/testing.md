# Shopware compatibility and testing

Start in classic mode and record the source revision, PHP/FrankenPHP versions,
image digests, installed plugins and theme. Repeat the same tests after switching
to worker mode; a successful HTTP status is only the beginning.

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
