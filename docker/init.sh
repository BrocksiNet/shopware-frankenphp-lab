#!/bin/sh
set -eu
cd /var/www/html
if [ "$#" -gt 0 ]; then
    exec "$@"
fi
if [ -f .lab-ready ]; then
    echo "Lab already initialized. Existing database and files kept."
    exit 0
fi
if [ ! -f LAB_SOURCE_REVISION ]; then
    cp -R /opt/shopware-source/. .
fi
export COMPOSER_ALLOW_SUPERUSER=1
composer install --no-interaction --prefer-dist --no-scripts
if [ ! -f install.lock ]; then
    php bin/console system:install --create-database --basic-setup --force --no-assign-theme
fi
php bin/console bundle:dump
php bin/console feature:dump
(
    cd src/Administration/Resources/app/administration
    npm ci --no-audit --no-fund
    npm run build
)
(
    cd src/Storefront/Resources/app/storefront
    npm ci --no-audit --no-fund
    npm run production
    node copy-to-vendor.js
)
php bin/console assets:install
php bin/console theme:change Storefront --all --sync
# The docker-base web image runs as uid/gid 82.
chown -R 82:82 /var/www/html
# Written last: a failed dependency install or asset build never reports ready.
touch .lab-ready
chown 82:82 .lab-ready
echo "Lab initialized. Open http://localhost:8080 or /admin (admin / shopware)."
