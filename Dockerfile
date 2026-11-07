# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

# OpenCodex hub built from the official npm releases. OpenCodex materializes its model catalog with
# `codex debug models --bundled`, so the image keeps the native Codex binary and nothing else from
# the Codex package. Upgrade by changing the three versions below.
ARG BUN_IMAGE=oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4
FROM ${BUN_IMAGE}

ARG OPENCODEX_VERSION=2.98.0
ARG CODEX_VERSION=0.167.0

LABEL org.opencontainers.image.title="opencodex-cloud" \
      org.opencontainers.image.description="OpenCodex hub for Coolify" \
      org.opencontainers.image.source="https://github.com/atinseau/opencodex-cloud" \
      org.opencontainers.image.licenses="MIT AND Apache-2.0" \
      io.opencodex-cloud.opencodex-version="${OPENCODEX_VERSION}" \
      io.opencodex-cloud.codex-version="${CODEX_VERSION}"

# OpenCodex mirrors part of its service state under $HOME/.opencodex, so HOME lives in the volume
# too: the root filesystem can stay read-only and nothing is lost when the container is replaced.
ENV NODE_ENV=production \
    OCX_SERVICE=1 \
    BUN_INSTALL=/opt/bun-global \
    OPENCODEX_HOME=/var/lib/opencodex \
    CODEX_HOME=/var/lib/opencodex/codex \
    CODEX_CLI_PATH=/usr/local/bin/codex \
    HOME=/var/lib/opencodex/home

# The base image digest is immutable; Debian security fixes are applied at build time.
RUN apt-get update \
    && apt-get upgrade --yes --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

RUN bun install --global "@bitkyc08/opencodex@${OPENCODEX_VERSION}" "@openai/codex@${CODEX_VERSION}" \
    && codex_native="$(find /opt/bun-global/install/global/node_modules/@openai -type f -path '*/bin/codex' -print -quit)" \
    && test -n "$codex_native" \
    && install -m 0555 "$codex_native" "$CODEX_CLI_PATH" \
    && rm -rf /opt/bun-global/install/cache \
        /opt/bun-global/install/global/node_modules/@openai \
        /opt/bun-global/install/global/node_modules/@oven \
        /opt/bun-global/install/global/node_modules/bun \
    && bun /opt/bun-global/install/global/node_modules/@bitkyc08/opencodex/src/cli/index.ts --version \
    && "$CODEX_CLI_PATH" debug models --bundled \
      | bun -e 'const catalog = await Bun.stdin.json(); if (!(catalog.models?.length > 0)) throw new Error("empty Codex catalog")'

RUN install -d -m 0700 -o bun -g bun /var/lib/opencodex /var/lib/opencodex/codex /var/lib/opencodex/home
COPY --chown=bun:bun --chmod=0600 docker/config.json /var/lib/opencodex/config.json

USER bun
EXPOSE 10100
VOLUME ["/var/lib/opencodex"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD ["bun", "-e", "const r = await fetch('http://127.0.0.1:10100/healthz'); if (!r.ok) process.exit(1)"]

CMD ["bun", "/opt/bun-global/install/global/node_modules/@bitkyc08/opencodex/src/cli/index.ts", "start", "--port", "10100"]
