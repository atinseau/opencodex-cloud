# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

# Claude connector for the OpenCodex hub. Build from the repository root:
#   docker build -f packages/mcp/Dockerfile .
ARG BUN_IMAGE=oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4

FROM ${BUN_IMAGE} AS dependencies
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages/mcp/package.json packages/mcp/
RUN bun install --frozen-lockfile --production --ignore-scripts --filter @opencodex-cloud/mcp

FROM ${BUN_IMAGE}

LABEL org.opencontainers.image.title="opencodex-cloud-mcp" \
      org.opencontainers.image.description="Claude custom connector for an OpenCodex hub" \
      org.opencontainers.image.source="https://github.com/atinseau/opencodex-cloud" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    PORT=8080 \
    MCP_DATA_DIR=/data

RUN apt-get update \
    && apt-get upgrade --yes --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -m 0700 -o bun -g bun /data

WORKDIR /app
COPY --from=dependencies /app/node_modules node_modules
COPY --from=dependencies /app/packages/mcp/node_modules packages/mcp/node_modules
COPY packages/mcp/package.json packages/mcp/
COPY packages/mcp/src packages/mcp/src

USER bun
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const r = await fetch('http://127.0.0.1:8080/healthz'); if (!r.ok) process.exit(1)"]

CMD ["bun", "packages/mcp/src/main.ts"]
