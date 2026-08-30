#!/bin/sh
set -eu

umask 077

OPENCODEX_HOME="${OPENCODEX_HOME:-/var/lib/opencodex}"
CODEX_HOME="${CODEX_HOME:-${OPENCODEX_HOME}/codex}"
PORT="${PORT:-10100}"
export OPENCODEX_HOME CODEX_HOME PORT

if [ -z "${OPENCODEX_API_AUTH_TOKEN:-}" ]; then
  echo "OPENCODEX_API_AUTH_TOKEN is required for the remote listener" >&2
  exit 78
fi

if [ -z "${OPENCODEX_ADMIN_AUTH_TOKEN:-}" ]; then
  echo "OPENCODEX_ADMIN_AUTH_TOKEN is required for remote administration" >&2
  exit 78
fi

if [ "${#OPENCODEX_API_AUTH_TOKEN}" -lt 32 ]; then
  echo "OPENCODEX_API_AUTH_TOKEN must contain at least 32 characters" >&2
  exit 78
fi

if [ "${#OPENCODEX_ADMIN_AUTH_TOKEN}" -lt 32 ]; then
  echo "OPENCODEX_ADMIN_AUTH_TOKEN must contain at least 32 characters" >&2
  exit 78
fi

if [ "$OPENCODEX_API_AUTH_TOKEN" = "$OPENCODEX_ADMIN_AUTH_TOKEN" ]; then
  echo "Data-plane and administration tokens must be different" >&2
  exit 78
fi

mkdir -p "$OPENCODEX_HOME" "$CODEX_HOME"
chmod 0700 "$OPENCODEX_HOME" "$CODEX_HOME"

# Stable OpenCodex releases still perform a local Codex sync during startup. Give that sync an
# isolated, valid profile owned by this volume; it never touches a host machine's real CODEX_HOME.
codex_config_path="${CODEX_HOME}/config.toml"
if [ ! -e "$codex_config_path" ]; then
  OPENCODEX_BOOTSTRAP_CODEX_CONFIG="$codex_config_path" \
    bun -e '
      import { writeFileSync } from "node:fs";
      writeFileSync(process.env.OPENCODEX_BOOTSTRAP_CODEX_CONFIG, "# OpenCodex Cloud isolated profile\n", { mode: 0o600 });
    '
fi
chmod 0600 "$codex_config_path"

config_path="${OPENCODEX_HOME}/config.json"
if [ ! -e "$config_path" ]; then
  OPENCODEX_BOOTSTRAP_CONFIG="$config_path" \
  OPENCODEX_BOOTSTRAP_ORIGIN="${OPENCODEX_PUBLIC_ORIGIN:-}" \
    bun -e '
      import { readFileSync, writeFileSync } from "node:fs";
      const template = JSON.parse(readFileSync("/opt/opencodex-cloud/config.default.json", "utf8"));
      const origin = process.env.OPENCODEX_BOOTSTRAP_ORIGIN?.trim();
      if (origin) {
        const parsed = new URL(origin);
        if (parsed.protocol !== "https:" || parsed.origin !== origin) {
          throw new Error("OPENCODEX_PUBLIC_ORIGIN must be an exact HTTPS origin without a trailing slash");
        }
        template.corsAllowOrigins = [origin];
      }
      writeFileSync(process.env.OPENCODEX_BOOTSTRAP_CONFIG, JSON.stringify(template, null, 2) + "\n", { mode: 0o600 });
    '
fi

chmod 0600 "$config_path"

exec bun run /opt/bun-global/install/global/node_modules/@bitkyc08/opencodex/src/cli/index.ts start --port "$PORT"
