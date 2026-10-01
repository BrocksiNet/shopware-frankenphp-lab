# Validation record

Date: 2026-10-01. This record concerns the starter's setup path, not full Shopware
compatibility. The lab was exercised using Docker Compose on an ARM64 Linux
container engine through its Docker-compatible API. Native Docker Engine/Desktop
on each supported host platform has not been independently verified.

## Recorded images

- Runtime: `ghcr.io/shopware/docker-base@sha256:09482355e50c913214af687001a1c2a7426e9d268709e291256ad19a458bfa05`
- Initializer: `ghcr.io/shopware/docker-dev@sha256:3aa5f2aa0b6fe32effd7a2a8d5cd3007fffbea7d118de7d30556746415d863fa`
- Source: `868f25121f764f41d6490fd032d6f28507be4e43` plus `patches/plugin-init.patch`.

Image digests are evidence for this run, not a promise that mutable tags will keep
resolving to them. Architecture-specific manifests may have different digests.

## Static and harness checks

The classic, worker and benchmark Compose configurations validate. ShellCheck passes for the initializer.
Five Node tests and ten Python tests pass, covering the benchmark transport,
fixture guards/relations, summary validation and storefront verifier.
Markdown lint and local documentation links pass. The image build verifies patch
applicability before applying it.

## Live starter checks

- Initialization from empty application/database volumes: successful dependency
  installation, database creation, both frontend builds and theme assignment.
- Repeated `docker compose up`: initializer recognizes the ready marker and retains
  existing data; it does not reinstall or drop the database.
- Classic mode: five regular PHP threads; six content/asset-origin smoke assertions
  pass. Storefront and Admin HTML plus referenced JS/CSS assets return HTTP 200.
- Worker override: five application workers plus one required regular PHP thread;
  six content/asset-origin assertions pass after aligning the health-check Host.
- Admin OAuth and authenticated product search succeed in both modes. The empty
  product response is expected in this unseeded starter.
- Administration login screen renders in a headless Chrome browser. Full Admin
  workflows after login were not exercised in this starter validation.
- Switching back to classic mode retains the installation.

During validation, the original copy command retained private file labels and
prevented the web container reading the shared volume. It now copies without those
extended attributes. The initial worker configuration also needed one regular PHP
thread beyond the five workers. Both setup defects were corrected before publication.
The health-check asset-origin failure remains an application compatibility issue;
see [the explanation and workaround](testing.md#health-checks-can-trigger-the-asset-origin-bug-too).

These setup checks do not validate shopping journeys, third-party extensions,
multi-domain workers, prolonged load, payment providers or production recovery.

## Public-fixture follow-up

The new three-runtime setup was tested using Compose v5.0.2. The pinned initializer
build succeeds using cached source/dependency layers. Starting the pinned Compose
configuration against the existing lab preserves the installation; recreated web
services have the same image IDs as the measured services. This follow-up did not
repeat the full frontend build from fresh volumes.

- Synthetic fixture creation succeeds; a second upsert retains the same fixture
  counts. Total searched records: 500 products, 51 categories, 100 customers and
  103 media records, including bootstrap data.
- Five classic threads, five HTTP workers plus one regular thread, and five static
  FPM children are configured. Runtime state and FPM configuration were inspected.
- HTTP/2 gzip: 27 runs, 213,744 validated responses.
- HTTP/2 identity: 9 runs, 67,504 validated responses.
- Seeded classic storefront verification: six content/asset-origin assertions
  passed; cart and customer-login checks were skipped.
- After recreating the pinned services, authenticated HTTP/2 searches were checked
  again on all three targets. These short smoke runs are excluded from the tables.

The [environment record](results/2026-10-01/environment.json) and
[measurement report](measurements.md) preserve the image/build differences and
limitations. No production compatibility conclusion is implied by these checks.

## Logging correction and no-recycling follow-up

The initializer build now checks and applies `patches/monolog-reset.patch` as well
as the existing plugin-init patch. For this follow-up, the logging patch was
checked and applied to the existing seeded application volume, then all three
runtimes were restarted. Their handler-file SHA-256 checksums match. No fixture,
Composer dependency, source revision or runtime image change was made. A full
fresh-volume frontend build was not repeated for this source-only correction.

- Standalone log-reset verification: all four cases pass with zero retained logs;
  the earlier unmodified-code control retained 1,000 in each case.
- PHP CS Fixer passes for all three patched classes and the verification script.
  Targeted PHPStan analysis passes for the three classes.
- Existing handler PHPUnit tests: 18 tests, 25 assertions pass using
  `--no-configuration --bootstrap vendor/autoload.php` and the three handler-test
  classes. The standard project bootstrap requires a separate `shopware_test`
  database which this lab user cannot create; these pure unit tests were run
  without that database bootstrap. This is not an integration-suite result.
- Both Compose worker overrides validate with loop limits 0 and 500. The live
  no-recycling matrix used five workers, loop limit zero and an unmodified runtime.
- Gzip matrix: 27 runs, 224,952 valid responses. Identity control: 9 runs, 78,652.
- Ten-minute worker follow-up: 10 runs, 546,432 valid responses. No worker restart
  between the matrix, identity control and this follow-up. Thread counters finish
  between 140,443 and 151,113 across the five workers.
- Fresh-start policy controls: 3 runs at limit 500 and 3 at limit zero, 80,568 valid
  responses in total. The policies ran sequentially; no optimal-limit claim is made.
- Combined load tests: **52 runs and 930,604 validated responses**, with zero failures.
- Five Node and ten Python harness tests pass. Python chart lint passes. Generated
  charts were visually inspected; documentation links and Markdown lint were checked
  with the line-length rule excluded for existing tables, links and commands.
- Patched classic storefront smoke check: six assertions pass; cart and customer
  login remain skipped. See the [smoke report](results/2026-10-01-no-recycling/storefront-smoke.json).

New reports, patch hashes and image IDs are in the
[no-recycling results](results/2026-10-01-no-recycling/README.md). Earlier results
remain archived. These checks do not establish full Shopware worker compatibility.
