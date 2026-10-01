# Validation record

Date: 2026-10-01. This record concerns the starter's setup path, not full Shopware
compatibility. The lab was exercised using Docker Compose v2 on an ARM64 Linux
container engine through its Docker-compatible API. Native Docker Engine/Desktop
on each supported host platform has not been independently verified.

## Recorded images

- Runtime: `ghcr.io/shopware/docker-base@sha256:09482355e50c913214af687001a1c2a7426e9d268709e291256ad19a458bfa05`
- Initializer: `ghcr.io/shopware/docker-dev@sha256:3aa5f2aa0b6fe32effd7a2a8d5cd3007fffbea7d118de7d30556746415d863fa`
- Source: `868f25121f764f41d6490fd032d6f28507be4e43` plus `patches/plugin-init.patch`.

Image digests are evidence for this run, not a promise that mutable tags will keep
resolving to them. Architecture-specific manifests may have different digests.

## Static and harness checks

Both Compose configurations validate. ShellCheck passes for the initializer.
The benchmark's three Node tests and the verifier's eight Python tests pass.
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
