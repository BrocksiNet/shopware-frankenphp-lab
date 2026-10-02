# Verifying Shopware behavior

> Historical record from 2026-09-30 / 2026-10-01. Commands, findings and upstream statuses describe that experiment, not the current lab. Use the [archive overview](../README.md) and [current setup](../../../../README.md) for orientation.
[Overview](../README.md)

Use these checks to verify responses and session boundaries before drawing conclusions from timings. Commands below use the recorded lab targets: substitute your own domains and run from this archive's `docs/archive/development-lab/` directory. The [local lane reference](https://github.com/BrocksiNet/shopware-dev/tree/main/frankenphp) describes the original environment. These smoke tests do not cover a complete checkout or production readiness.

## Verifying: probe plugin and `probe.sh`

`FrankenPhpProbe` (dev only, never in production) adds headers to every main
response:

| Header | Meaning | FPM | worker, correct | worker, broken |
| --- | --- | --- | --- | --- |
| `X-Probe-Runtime` | `APP_RUNTIME_MODE` or SAPI | `fpm-fcgi` | `web=1&worker=1` | same |
| `X-Probe-Process-Requests` | static counter, survives in the process | always `1` | grows | grows |
| `X-Probe-Service-Resets` | resets of a `kernel.reset` service | `0` | grows by 1 per request | stays `0` |
| `X-Probe-Leaked-Path` | previous request's path, if state was not reset | `-` | `-` | previous path |
| `X-Probe-Memory` / `-Peak` | `memory_get_usage()` | per request | should plateau | grows |
| `X-Probe-Escape-Cache` | entries in `CachedEscaperRuntime::$escapeCache` | small | reset per request | grows forever |

Only measure uncached responses: a response stored in Shopware's HTTP cache
replays the headers of the request that produced it (visible as `Age: 1`).

```bash
P=./bin/probe.sh
$P http://localhost:8106 900 / '/search?search={rand}' /api/_info/version   # worker
$P http://localhost:8105 30  / '/search?search={rand}' /api/_info/version   # FPM
```

`{rand}` is replaced by a unique value per request, so per-request caches that
are never reset grow visibly.

### Results (2026-09-30, 1 worker, HTTP cache off, 900 requests)

| Variant | Service resets | Leaked state | Escape cache | Memory `/` first -> last |
| --- | --- | --- | --- | --- |
| trunk (no PR) | 0 | 900 / 900 | 58 -> 721 | 61.7 -> 76.4 MB |
| PR #19121 as-is | probe missing: **no plugin loaded at all** ([No plugin is loaded on HTTP requests (PR #19121 as-is)](compatibility.md#no-plugin-is-loaded-on-http-requests-pr-19121-as-is)) | | | |
| PR #19121 + fix | 900 | 0 | reset (max 58) | 61.7 -> 71.6 MB |
| FPM, any variant | 0 (1 request per lifecycle) | 0 | per request | n/a |

A warm worker with the fix still grows about 7.5 KB per storefront request
(71.7 -> 82.9 MB over another 1500 requests), about 1.3 KB per Admin API
request. See [remaining memory growth](compatibility.md#remaining-memory-growth-per-storefront-request).

Functional checks with PR + fix, both runtimes: storefront (HTTP cache hits),
Store API register/login, 20 x logged-in vs. anonymous interleaved on one
worker (anonymous never sees the customer), Admin API OAuth, product search,
`/admin`, Admin API cache clear. Integration tests `KernelServiceResetTest`,
`KernelTest`, `ScriptStoreApiRouteTest`, `KernelPluginIntegrationTest` pass.

## Functional smoke test — 2026-09-30

Fresh isolated curl cookie jars were used on each of the three targets in the [performance report](performance.md).
The existing public demo account `customer@example.com` was used for login.

| Check | Worker | FPM control | Trunk FPM |
| --- | --- | --- | --- |
| Home, category, search, account login page | HTTP 200 | HTTP 200 | HTTP 200 |
| Product detail route and expected page class | pass | pass | pass |
| Add product to guest cart and read it back | pass | pass | pass |
| Interleave two guest carts, 10 pairs, product only in cart A | pass | pass | pass |
| Demo customer login and account page | pass | pass | pass |
| Interleave logged-in and anonymous account requests, 10 pairs | pass | pass | pass |
| Logout request and Admin HTML shell | HTTP 200 | HTTP 200 | HTTP 200 |
| Homepage browser asset loading | **CORS failures** | no console errors | logo 404 |

Raw assertions: [`functional.json`](../measurements/2026-09-30/functional.json).
Worker responses in the timing run reported `X-Probe-Leaked-Path: -` and
increasing reset counters. That only checks the probe's own state; it does not
prove every service is reset. Five workers also prevent a reliable per-worker
memory slope from this sample. The older single-worker memory results in the probe table
remain a separate experiment.

No orders or payments were submitted. Full checkout, registration, Admin OAuth,
Admin mutations, Store API authentication, multi-language/theme correctness,
idle DB reconnect and a long memory soak were not re-tested in this pass.
[Concurrent Admin API benchmark: HTTP/2 and HTTP/1.1](performance.md#concurrent-admin-api-benchmark-http2-and-http11) later exercises OAuth and read-only Admin API searches under load;
it does not cover the complete Admin UI or mutations. Earlier results in [Verifying: probe plugin and `probe.sh`](verification.md#verifying-probe-plugin-and-probesh) are historical, not proof that all those flows pass with today's setup. Server logs inspected during this pass contained
no recent fatal/critical PHP errors or logged HTTP 5xx responses.

## Repeatable storefront verification

[`tools/verify.py`](../../../../tools/verify.py) needs Python 3 and curl on the client machine.
It uses HTTP requests and temporary, independent cookie jars. Run it against a
development/test shop; `--cart` adds and then removes an item, and the optional
login flow uses an existing test customer. It does not create customers or orders.

Start with page-content and asset-origin checks:

```bash
python3 ../../../tools/verify.py \
  http://music-de.localhost:8105 \
  http://music-de.localhost:8106 \
  --output /tmp/shopware-smoke.json
```

For cart and account isolation, set `SHOPWARE_VERIFY_PASSWORD` in your local
environment to the test customer's password, then run:

```bash
python3 ../../../tools/verify.py \
  http://music-de.localhost:8105 \
  http://music-de.localhost:8106 \
  --cart --login-email customer@example.com --rounds 5 \
  --output /tmp/shopware-session-smoke.json
```

Use `--password-env NAME` for a different environment variable. Credentials,
cookies and response bodies are not written to the JSON report. Passwords are
passed to curl over stdin. Cookie jars are removed when the run finishes; a
server-side session can remain until its configured expiry. Cleanup attempts
remove the test cart item and log the test customer out, and cleanup failures
are reported.

| Check | Assertion |
| --- | --- |
| Homepage, search and login page | HTTP 200 and the expected Shopware route class in the body |
| Script and stylesheet origins | At least one asset reference; every checked origin matches the requested shop or an explicitly allowed CDN |
| Guest carts, with `--cart` | A contains the selected product as a cart line item; B has no cart line items |
| Customer versus anonymous, with credentials | A reaches the account page while B reaches login; request order alternates each round |
| Logout | The formerly authenticated session returns to login on the next account request |
| Probe state, when headers exist | `X-Probe-Leaked-Path` is `-`; absence of the optional probe is not evidence that resets ran |

The default theme's route classes, form fields and cart removal buttons are
used as assertions. `--cart` expects a purchasable product with an add-to-cart
form on the homepage. A heavily customized theme can need adapted selectors;
missing expected markup fails a check rather than being treated as success.
Search defaults to `guitar`; change it with `--search-term`. It checks the search
page shape, not product relevance or the expected number of results.

Use `--allow-asset-origin https://cdn.example` only for intentional asset hosts;
repeat the option for multiple hosts. This is an origin policy check, not an
actual browser CORS test. The script does not execute JavaScript, request fonts,
inspect CSS imports, or prove the referenced assets load. Browser checks remain
necessary. Cross-origin form actions and redirects are rejected to keep sessions
and credentials on the selected shop. Origins with a subdirectory path are not
supported by this first version.

**Result:** exit `0` means all requested assertions passed; `1` means at least
one failed; `2` means invalid arguments or an unusable report path. The JSON lists
individual checks, pass/fail/skip counts, configuration and untested areas. A
run without `--cart` or login credentials explicitly reports those checks as
skipped. Existing report files are never overwritten: choose a new filename
for each run. Full checkout, payments, registration, Admin/Store API behavior,
recovery and memory stability are outside this command's scope.

For multi-domain checks, list each domain served by the worker in turn, then
repeat the first domain. URLs are tested in the order supplied. Restart workers
and reverse the order in a separate run to check first-request dependence:

```bash
python3 ../../../tools/verify.py \
  http://music-de.localhost:8106 \
  http://music.localhost:8106 \
  http://music-de.localhost:8106 \
  --output /tmp/shopware-domains.json
```

The script does not change worker counts, disable caches or restart services.
Use one worker and uncached responses for a deterministic lifecycle test, then
repeat with the normal worker count. Test each runtime separately as well as
comparing their reports; this command is not a load benchmark.

Recorded run on 2026-09-30: the FPM control, FrankenPHP domain and trunk FPM
passed 144 assertions with cart/login enabled and three rounds per session pair
([JSON report](../measurements/2026-09-30/verification-current.json)). This result covers
only the listed domains and requested smoke checks.

Harness tests (local fake HTTP server, no running Shopware needed):

```bash
python3 -m unittest discover \
  -s ../../../tools -p test_verify.py -v
```

The harness tests cover wrong origins and permitted CDNs, independent cookie
jars, HTTP errors, rejected cross-origin redirects, missing route markers,
cart detection, simulated cross-session leaks, report exit codes and refusing
to overwrite reports.

## Classic mode follow-up — 2026-10-01

Classic mode (five regular PHP threads, no worker script) passed **102 assertions**
across A → B → A storefront domains with guest-cart isolation enabled and three
rounds per pair. Home, login and search content, script/stylesheet origins, cart
separation and cleanup passed. Customer login isolation was skipped. This was a
CLI smoke test, not a full browser or checkout validation.

[Successful report](../measurements/2026-10-01/classic-smoke-after-domain-cache-clear.json)
and [runtime thread state](../measurements/2026-10-01/classic-thread-state.json).
The initial attempt failed because temporary domain records inserted directly into
the database had not invalidated the domain cache; after clearing that cache all
checks passed. The failed [setup attempt](../measurements/2026-10-01/classic-smoke.json)
is retained for transparency. The temporary domains/container were removed and the
shared domain cache cleared afterwards. Admin OAuth and concurrent read-only
searches were separately validated in the [three-way benchmark](performance.md#three-way-http2-comparison--2026-10-01).
