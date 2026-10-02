# Experimental setup and worker operations

> Historical record from 2026-09-30 / 2026-10-01. Commands, findings and upstream statuses describe that experiment, not the current lab. Use the [archive overview](../README.md) and [current setup](../../../../README.md) for orientation.
[Overview](../README.md)

This is an experimental starting point for an existing Shopware installation, not a production recipe. The requirements below describe the tested baseline as of 2026-09-30. Read [compatibility](compatibility.md) before trying it; machine-specific commands belong in the [local lane reference](https://github.com/BrocksiNet/shopware-dev/tree/main/frankenphp).

## Requirements

| What | Version / value | Why |
| --- | --- | --- |
| Shopware | trunk with PR #19121 **and** the plugin-init fix from [No plugin is loaded on HTTP requests (PR #19121 as-is)](compatibility.md#no-plugin-is-loaded-on-http-requests-pr-19121-as-is) | resets services between requests |
| `symfony/runtime` | >= 7.4 | ships `FrankenPhpWorkerRunner`, selected automatically when `FRANKENPHP_WORKER` is set. No `runtime/frankenphp-symfony` package needed |
| Image | `ghcr.io/shopware/docker-base:8.4-frankenphp` | official Shopware image, FrankenPHP 1.12, PHP 8.4, all Shopware extensions (intl, gd, pdo_mysql, zip, redis, amqp, apcu, opcache, ...) |
| Worker config | `FRANKENPHP_CONFIG="worker { file /var/www/html/public/index.php; num 2 }"` | the image runs classic mode unless a worker is declared |
| Database | MySQL 8 / MariaDB 10.11 | watch `wait_timeout`, see [`MySQL server has gone away` / error 4031 after idle time](compatibility.md#mysql-server-has-gone-away--error-4031-after-idle-time) |

The docker-base image routes every non-file request to `index.php` through
`/etc/caddy/Caddyfile` (listens on `:8000`). Because the worker file matches
that path, FrankenPHP hands those requests to the worker automatically. No
custom Caddyfile is needed.

## Minimal experimental setup

This starts a worker; it does not supply all compatibility fixes. Review the
readiness table and version requirements first.

Portable version (no Podman/Mutagen specifics), e.g. `compose.frankenphp.yaml`
in a Shopware project that already has `vendor/`, an installed database and
built assets:

```yaml
services:
  web:
    image: ghcr.io/shopware/docker-base:8.4-frankenphp
    ports:
      - '8000:8000'
    volumes:
      - .:/var/www/html
    environment:
      APP_ENV: prod
      APP_SECRET: change-me-to-a-long-random-value-of-at-least-32-bytes
      APP_URL: http://localhost:8000
      DATABASE_URL: mysql://root:root@database/shopware
      FRANKENPHP_CONFIG: |
        worker {
          file /var/www/html/public/index.php
          num 2
        }
      # optional: recycle a worker after N requests as a safety net for leaks
      FRANKENPHP_LOOP_MAX: 500
```

Checklist:

1. `APP_SECRET` must be at least 256 bits (32 bytes). Shorter values break the
   Admin API OAuth (`Key provided is shorter than 256 bits`).
2. The container user must be able to write `var/`, `public/theme`,
   `public/media`, `public/thumbnail`, `files/`. docker-base runs as uid 82.
3. Run `bin/console` (install, migrations, theme compile) as usual. Then
   **restart the workers** ([Operating workers](setup-and-operations.md#operating-workers)), they do not notice a new container.
4. Verify with the probe plugin ([Verifying: probe plugin and `probe.sh`](verification.md#verifying-probe-plugin-and-probesh)) that services are reset and memory
   is stable.

## Operating workers

The examples below assume a Compose service named `frankenphp`, the Podman CLI,
and the Caddy admin API reachable inside that container. Substitute your service
name (`web` in the minimal example) and container CLI as needed.

```bash
# restart all workers (new code, new container, plugin lifecycle, config change)
podman compose exec frankenphp curl -X POST http://localhost:2019/frankenphp/workers/restart

# worker/thread state
podman compose exec frankenphp curl -s http://localhost:2019/frankenphp/threads

# logs (PHP errors go to stderr)
podman compose logs -f frankenphp
```

When to restart workers:

- after deploy / `git pull` / `composer install`,
- after `bin/console cache:clear`, `plugin:install|activate|deactivate|update`,
  `app:install`, theme changes that affect the container, `.env` changes,
- after `system:update:finish` / migrations that change config.

An Admin API cache clear (`DELETE /api/_action/cache`) did not break the
running worker in tests, but the worker keeps its in-memory container.

For production: prefer immutable images (`opcache.validate_timestamps=0`, the
docker-base default) and roll new containers instead of restarting workers in
place. Keep `FRANKENPHP_LOOP_MAX` at a few hundred/thousand as a safety net
until the remaining leak ([Remaining memory growth per storefront request](compatibility.md#remaining-memory-growth-per-storefront-request)) is understood.
