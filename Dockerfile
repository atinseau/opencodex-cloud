# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

ARG BUN_VERSION=1.4.2
FROM oven/bun:${BUN_VERSION}-slim@sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61

ARG OPENCODEX_VERSION=2.46.0
ARG CODEX_VERSION=0.151.0
LABEL org.opencontainers.image.title="opencodex-cloud" \
      org.opencontainers.image.description="Hardened OpenCodex container for remote cloud deployment" \
      org.opencontainers.image.source="https://github.com/atinseau/opencodex-cloud" \
      io.opencodex-cloud.upstream="https://github.com/lidge-jun/opencodex" \
      org.opencontainers.image.version="${OPENCODEX_VERSION}" \
      io.opencodex-cloud.opencodex-version="${OPENCODEX_VERSION}" \
      io.opencodex-cloud.codex-version="${CODEX_VERSION}" \
      org.opencontainers.image.licenses="MIT AND Apache-2.0"

ENV NODE_ENV=production \
    BUN_INSTALL=/opt/bun-global \
    OPENCODEX_HOME=/var/lib/opencodex \
    CODEX_HOME=/var/lib/opencodex/codex \
    CODEX_CLI_PATH=/usr/local/bin/codex \
    CATALOG_SYNC_INTERVAL_SECONDS=300 \
    PORT=10100 \
    CI=true

# The Bun base digest is immutable, but Debian security updates are not. Apply the
# currently available fixes during every release build, then remove apt metadata.
RUN apt-get update \
    && apt-get upgrade --yes --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# OpenCodex builds its materialized catalog from `codex debug models --bundled`, then merges live
# provider discovery into it. Pin both packages so every image is reproducible without carrying a
# second, hand-maintained catalog seed.
RUN mkdir -p /var/lib/opencodex/codex \
    && bun install --global \
        "@bitkyc08/opencodex@${OPENCODEX_VERSION}" \
        "@openai/codex@${CODEX_VERSION}" \
    && codex_native="$(find /opt/bun-global/install/global/node_modules/@openai -type f -path '*/bin/codex' -print -quit)" \
    && test -n "$codex_native" \
    && cp "$codex_native" /tmp/codex-native \
    && rm -rf /opt/bun-global/install/cache \
        /opt/bun-global/install/global/node_modules/bun \
        /opt/bun-global/install/global/node_modules/@oven \
        /opt/bun-global/install/global/node_modules/@openai \
    && rm -f /usr/local/bin/codex \
    && mv /tmp/codex-native "$CODEX_CLI_PATH" \
    && chmod 0555 "$CODEX_CLI_PATH" \
    && bun run /opt/bun-global/install/global/node_modules/@bitkyc08/opencodex/src/cli/index.ts --version \
    && "$CODEX_CLI_PATH" --version \
    && "$CODEX_CLI_PATH" debug models --bundled \
      | bun -e 'const catalog=await Bun.stdin.json();const slugs=new Set(catalog.models?.map((model)=>model.slug));for(const required of ["gpt-5.6-sol","gpt-5.6-terra","gpt-5.6-luna"]){if(!slugs.has(required))throw new Error(`Codex ${required} catalog entry is missing`)}'

COPY --chown=bun:bun config/config.default.json /opt/opencodex-cloud/config.default.json
COPY --chmod=0444 docker/supervisor.ts /opt/opencodex-cloud/supervisor.ts
COPY --chmod=0555 docker/entrypoint.sh /usr/local/bin/opencodex-cloud-entrypoint

RUN chown -R bun:bun /var/lib/opencodex

USER bun
EXPOSE 10100
VOLUME ["/var/lib/opencodex"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD ["bun", "-e", "const port=process.env.PORT||'10100'; const r=await fetch(`http://127.0.0.1:${port}/healthz`,{signal:AbortSignal.timeout(4000)}); if(!r.ok) process.exit(1); const b=await r.json(); if(b.service!=='opencodex') process.exit(1)"]

ENTRYPOINT ["/usr/local/bin/opencodex-cloud-entrypoint"]
