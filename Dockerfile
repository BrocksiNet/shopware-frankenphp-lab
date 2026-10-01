# This image only prepares the isolated lab volume; it is not the web runtime.
FROM ghcr.io/shopware/docker-dev:php8.4-node24-caddy
USER root
ARG SHOPWARE_REF=868f25121f764f41d6490fd032d6f28507be4e43
WORKDIR /opt/shopware-source
RUN git init && git remote add origin https://github.com/shopware/shopware.git \
    && git fetch --depth 1 origin "$SHOPWARE_REF" && git checkout --detach FETCH_HEAD
COPY composer.lock /opt/shopware-source/composer.lock
COPY patches/plugin-init.patch /tmp/plugin-init.patch
RUN git apply --check /tmp/plugin-init.patch && git apply /tmp/plugin-init.patch \
    && printf '%s\n' "$SHOPWARE_REF" > /opt/shopware-source/LAB_SOURCE_REVISION
COPY docker/init.sh /usr/local/bin/lab-init
WORKDIR /var/www/html
ENTRYPOINT ["/bin/sh", "/usr/local/bin/lab-init"]
