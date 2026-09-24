#!/bin/sh
set -eu

image="${1:-opencodex-cloud:smoke}"
expected_codex_version="${2:-0.151.0}"
container="opencodex-cloud-smoke-$$"
api_token="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
admin_token="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

cleanup() {
  docker rm --force "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run --rm --entrypoint codex "$image" --version | grep -Fx "codex-cli $expected_codex_version"

bundled_catalog="$(docker run --rm --entrypoint codex "$image" debug models --bundled)"
for model in gpt-5.6-sol gpt-5.6-terra gpt-5.6-luna; do
  printf '%s' "$bundled_catalog" | jq -e --arg model "$model" '.models | any(.slug == $model)' >/dev/null
done

docker run --detach --name "$container" \
  --env OPENCODEX_API_AUTH_TOKEN="$api_token" \
  --env OPENCODEX_ADMIN_AUTH_TOKEN="$admin_token" \
  --env OPENCODEX_PUBLIC_ORIGIN=https://ai.example.com \
  --env CATALOG_SYNC_INTERVAL_SECONDS=0 \
  "$image" >/dev/null

attempt=0
until docker exec "$container" bun -e '
  const response = await fetch("http://127.0.0.1:10100/readyz");
  if (!response.ok) process.exit(1);
  const body = await response.json();
  if (body.status !== "ready") process.exit(1);
' >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 45 ]; then
    docker logs "$container"
    echo "OpenCodex did not become ready" >&2
    exit 1
  fi
  sleep 2
done

docker exec --env EXPECTED_CODEX_VERSION="$expected_codex_version" "$container" bun -e '
  const response = await fetch("http://127.0.0.1:10100/v1/catalog", {
    headers: { "x-opencodex-api-key": process.env.OPENCODEX_API_AUTH_TOKEN },
  });
  if (!response.ok) throw new Error(`catalog HTTP ${response.status}`);
  const catalog = await response.json();
  const ids = new Set(catalog.models?.map((model) => model.slug));
  if (ids.size === 0) throw new Error("materialized catalog is empty");
  if (!ids.has("gpt-5.5")) throw new Error("native Codex catalog was not materialized");
  if (response.headers.get("x-opencodex-codex-version") !== process.env.EXPECTED_CODEX_VERSION) {
    throw new Error("persisted Codex runtime version is missing");
  }
' 
