# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

ARG BUN_VERSION=1.4.0
FROM oven/bun:${BUN_VERSION}-slim@sha256:e0ee68d16ccb9927bf02aa7dd8fd4bf3369ee6d46da04faa72b05ce8bfd135f6

ARG OPENCODEX_VERSION=2.36.0
LABEL org.opencontainers.image.title="opencodex-cloud" \
      org.opencontainers.image.description="Hardened OpenCodex container for remote cloud deployment" \
      org.opencontainers.image.source="https://github.com/lidge-jun/opencodex" \
      org.opencontainers.image.version="${OPENCODEX_VERSION}" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    BUN_INSTALL=/opt/bun-global \
    OPENCODEX_HOME=/var/lib/opencodex \
    CODEX_HOME=/var/lib/opencodex/codex \
    PORT=10100 \
    CI=true

# The versioned npm package is the official OpenCodex release and already contains the dashboard.
# Its `bun` dependency exists for Node/npm installs; this image already provides the same Bun
# runtime, so the duplicated glibc + musl binaries are removed after installation.
RUN mkdir -p /var/lib/opencodex/codex \
    && bun install --global "@bitkyc08/opencodex@${OPENCODEX_VERSION}" \
    && rm -rf /opt/bun-global/install/cache \
        /opt/bun-global/install/global/node_modules/bun \
        /opt/bun-global/install/global/node_modules/@oven \
    && bun run /opt/bun-global/install/global/node_modules/@bitkyc08/opencodex/src/cli/index.ts --version

COPY --chown=bun:bun config/config.default.json /opt/opencodex-cloud/config.default.json
COPY --chmod=0555 docker/entrypoint.sh /usr/local/bin/opencodex-cloud-entrypoint

RUN chown -R bun:bun /var/lib/opencodex

USER bun
EXPOSE 10100
VOLUME ["/var/lib/opencodex"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD ["bun", "-e", "const port=process.env.PORT||'10100'; const r=await fetch(`http://127.0.0.1:${port}/healthz`,{signal:AbortSignal.timeout(4000)}); if(!r.ok) process.exit(1); const b=await r.json(); if(b.service!=='opencodex') process.exit(1)"]

ENTRYPOINT ["/usr/local/bin/opencodex-cloud-entrypoint"]
