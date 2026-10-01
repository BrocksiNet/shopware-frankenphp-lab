# Shopware + FrankenPHP lab

An unofficial, disposable Docker Compose playground for evaluating Shopware on
FrankenPHP. **Classic mode is the default. Worker mode is experimental. Shopware
has not been comprehensively tested with FrankenPHP in this project.**

This is not a production template or an official Shopware support statement.
The example intentionally uses local demo credentials, binds only to loopback,
disables HTTP caching for inspection, and sends no email.

The runtime already uses Shopware's own `ghcr.io/shopware/docker-base` images.
See the [official Shopware Docker guide](https://developer.shopware.com/docs/guides/hosting/installation-updates/docker.html)
for the production build/deployment workflow. Shopware recommends FrankenPHP for
container deployments; enabling persistent HTTP workers is a separate application
compatibility question. This lab's patched source and worker experiments do not
represent the default configuration in that guide.

## Start with classic mode

Requirements: Git, Docker Engine/Desktop and Docker Compose v2, internet access,
and enough disk and memory to install dependencies and build the Administration.
Allow several minutes for the first installation; 8 GB allocated to Docker is a
reasonable starting point for the build, not a measured minimum.

```bash
git clone https://github.com/BrocksiNet/shopware-frankenphp-lab.git
cd shopware-frankenphp-lab
docker compose up --build -d
docker compose logs -f init
```

Wait for `Lab initialized` and `init` to exit successfully. Then:

- Storefront: <http://localhost:8080>
- Administration: <http://localhost:8080/admin>
- Local demo login: `admin` / `shopware`

The first run downloads a pinned Shopware source revision, installs Composer
packages, creates the database and storefront, builds both frontends, and assigns
the Storefront theme. The web service starts only after initialization succeeds.
The catalog starts empty. No local PHP, Composer or Node installation is required.
Later starts reuse the named application/database volumes and skip installation.

## What version am I testing?

The source is pinned to Shopware commit
`868f25121f764f41d6490fd032d6f28507be4e43`, the development baseline used for our
runtime comparison. It includes the kernel reset work from
[PR #19121](https://github.com/shopware/shopware/pull/19121), plus the checked-in
[plugin initialization correction and regression test](patches/plugin-init.patch).
It is **not a released, fully worker-compatible Shopware version**.

The source pin and checked-in `composer.lock` record the tested PHP dependency
resolution. The pin intentionally does not follow a moving PR head. The patch is applied with
a failing check if the source no longer matches. PHP/Caddy image tags and package
registries can change; record image digests before benchmarking. See
[compatibility and testing](docs/testing.md) before adding extensions or data.

## Switch the same installation to worker mode

```bash
docker compose -f compose.yaml -f compose.worker.yaml up -d --no-deps --force-recreate web
```

This uses five application workers and recycles each after 500 requests.
FrankenPHP also requires one regular PHP thread; the override sets six total
threads while Shopware front-controller requests go to the five workers. It retains the same
code, database, URL and cache settings. Recycling bounds lifetime; it does not fix
cross-request state bugs. This is an opt-in compatibility experiment.

Return to classic mode:

```bash
docker compose up -d --no-deps --force-recreate web
```

Verify the mode, rather than inferring it from latency:

```bash
docker compose exec web curl -s http://localhost:2019/frankenphp/threads
```

Classic mode has regular PHP threads and no worker script. The worker configuration
registers `public/index.php`. Disabling recycling alone does not enable classic mode.

## Operate the lab

```bash
docker compose ps -a
docker compose logs --tail=100 web
docker compose exec web php bin/console about
docker compose restart web
```

Restart workers after code, plugin, configuration or container changes. Message
consumers and scheduled-task runners are not started by this small HTTP lab.
Search uses the database; OpenSearch is not included. The example does not configure
HTTPS, HTTP/3, CDN delivery or a production deployment pipeline.

Stop while keeping data with `docker compose down`. To **delete this lab's database
and application files** and reinstall from scratch:

```bash
docker compose down --volumes
docker compose up --build -d
```

Do not run the destructive reset against a shop you need to keep. Changing the
pinned source in the Dockerfile requires a fresh lab volume; this initializer is
not an upgrade system. For an interrupted first installation, inspect the `init`
logs; fix the cause and retry, or reset this disposable lab.

## Verify behavior before measuring speed

Follow [the Shopware testing guide](docs/testing.md) for browser checks, plugins,
sessions, multi-domain requests and known gaps. The scripts in `tools/` are optional
host-side Python/curl and Node tools; they do not run Shopware on the host.

The [reproducible benchmark guide](docs/benchmarking.md) adds a Shopware Caddy/FPM
control and a separate worker service alongside classic mode, with frozen runtime
image references and deterministic synthetic data. It includes commands for HTTP/2
load tests, response-encoding inspection and an uncompressed control.

Seeding is opt-in: the normal starter remains empty. The public fixture makes the
workload reproducible, not the throughput of any particular machine. The older
populated-shop experiment remains a separate dataset.

See the [recorded three-runtime comparison](docs/measurements.md) for results and limitations.

The [validation record](docs/validation.md) states what was actually exercised.
