# FrankenPHP configuration audit

## Verdict, 2026-10-01

The existing music worker installation is a reasonable **development baseline**,
not a fully tuned production deployment. These findings describe that installation,
not every default in the public Docker lab. No performance tuning was applied for
this audit; the populated browser comparison preserves these settings.

| Area | Observed setting | Assessment |
| --- | --- | --- |
| Runtime | FrankenPHP 1.12.7, PHP 8.4.26 ZTS, Debian 13 / glibc 2.41 | Matches the upstream preference for glibc |
| Environment | `APP_ENV=prod`, `APP_DEBUG=0` | Appropriate for timing production code paths |
| OPcache | Enabled; 256 MiB; 20 MiB interned strings; 20,000 script slots | Plausible starting sizes; occupancy has not been measured |
| File checks | `validate_timestamps=1`, `revalidate_freq=0` | Intentional for synchronized development files; adds checks |
| Composer | 1,322 classmap entries; Shopware and Symfony kernels absent; no authoritative map or APCu prefix | Autoloader is not optimized for this application |
| Realpath cache | 4 MiB, TTL 3,600 seconds | Configured, but adequacy requires runtime occupancy evidence |
| Preloading | Disabled | Optional experiment, not a verified improvement |
| JIT | Disabled | No evidence here justifies enabling it |
| PHP pool | Five workers plus eleven regular threads | Worker requests have five slots; sixteen threads are not sixteen application workers |
| Lifetime | No request-count recycling | Existing music build lacks the public lab's logging reset patch |
| Memory | PHP limit 512 MiB; no explicit container memory limit; `GOMEMLIMIT` unset | No explicit per-container resource budget |
| Go runtime | `GODEBUG=cgocheck=0` | Already matches the guide |
| Routing | Literal document root; separate static asset paths; `php` handler | Retains direct image/CSS/JS delivery |

The [FrankenPHP performance guide](https://frankenphp.dev/docs/performance/)
recommends OPcache, optimized autoloading, sufficient realpath cache and preloading.
Configuration values alone do not prove a bottleneck or quantify a speedup.

## Public Docker lab cross-check

The running public lab also has 1,322 Composer classmap entries, with
`Shopware\Core\Kernel` absent and authoritative mode off. It uses PHP 8.4.26,
OPcache enabled with 256 MiB, a 4 MiB realpath cache and no preload. Unlike the
editable music installation, it already has `opcache.validate_timestamps=0`.
These are inspected settings, not measured cache occupancy. The shared application
volume means the public runtime comparisons use the same unoptimized loader;
those results should not be presented as a fully tuned production comparison.

## Changes worth testing, in order

1. **Build an optimized Composer autoloader for a production comparison.** Use
   `composer dump-autoload --optimize` after installing the intended dependencies
   and plugins, then restart the web runtime. Apply the same optimization to FPM
   before comparing. Do not automatically add `--classmap-authoritative`: it
   disables fallback discovery and can affect generated or dynamically added
   classes. See [Composer's optimization guidance](https://getcomposer.org/doc/articles/autoloader-optimization.md).
2. **Use an immutable production profile.** Timestamp validation can be disabled
   for an image whose code never changes in place. Deployments must replace the
   workers and their OPcache. Keep validation enabled for editable development
   volumes; a cached worker class still requires a restart after an edit.
3. **Budget threads and memory explicitly.** Sweep worker counts with representative
   traffic, record latency, errors, CPU and process memory, and choose container
   limits with room for native allocations, OPcache and the Go runtime. PHP's
   per-request limit is not a total-process memory cap. `GOMEMLIMIT` does not cap
   all PHP/native memory either. Five workers are the benchmark control, not a
   demonstrated production optimum.
4. **Measure live cache usage before increasing sizes.** Read OPcache hit/miss,
   free/wasted memory, cached-script counts and interned-string usage from the
   web process; inspect realpath cache use there too. CLI cache statistics are
   separate and cannot establish web-cache pressure. This audit inspected INI
   values and the Composer loader, not live web-cache occupancy.
5. **Test preloading as a separate variant.** Generate and inspect a production
   preload after warming the intended production container. Restart and verify
   plugins, routes and deployment behavior before measuring.

The existing `var/cache/opcache-preload.php` points to a
`static_phpstan_dev` debug container. **Do not enable that file as the production
preload.** It is currently inactive. This illustrates why finding a file named
“preload” is insufficient. The [Symfony performance guide](https://symfony.com/doc/current/performance.html)
explains generated preload files and OPcache deployment considerations.

## Match advice to the installed version

The current website describes `num_threads` as regular threads with workers added
on top. The installed 1.12.7 has different pool accounting: its observed sixteen
threads comprise five workers and eleven regular threads. The public lab's pinned
configuration uses six total threads for five workers and one regular thread.
Consult the [1.12.7 configuration reference](https://github.com/php/frankenphp/blob/v1.12.7/docs/config.md)
and inspect `/frankenphp/threads` on Caddy's local admin endpoint before changing
pool limits. Recheck this when upgrading instead of copying version-dependent
numbers unchanged.

Do not disable the static file server for a Shopware storefront unless another
server/CDN serves those files. Product photography, theme assets and fonts still
need a delivery path. Likewise, this audit does not establish that access logging
is a meaningful bottleneck; keep useful observability while measuring its cost.

## Separate tuning from compatibility

Optimizing the autoloader or OPcache does not repair retained request state.
The existing music build does not contain the logging reset forwarding correction
used by the public lab. Its short browser run therefore cannot replace the
[patched worker lifetime experiment](measurements.md). Resolve known lifecycle
problems and validate representative journeys before calling a tuned worker setup
production-ready.
