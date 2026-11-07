#!/bin/sh
# Builds both images, starts them with throwaway secrets and checks the wiring between them.
set -eu

project="opencodex-cloud-smoke-$$"
export OPENCODEX_API_AUTH_TOKEN="$(openssl rand -hex 32)"
export OPENCODEX_ADMIN_AUTH_TOKEN="$(openssl rand -hex 32)"
export MCP_OAUTH_CLIENT_SECRET="$(openssl rand -hex 32)"
compose() { docker compose --project-name "$project" "$@"; }
trap 'compose down --volumes >/dev/null 2>&1 || true' EXIT INT TERM

hub_readiness() {
  compose exec -T hub bun -e '
    const deadline = Date.now() + 90_000
    let status = "pending"
    while (status === "pending" && Date.now() < deadline) {
      await Bun.sleep(2_000)
      status = (await (await fetch("http://127.0.0.1:10100/readyz")).json()).status
    }
    console.log(status)
  '
}

compose up --build --detach --wait --wait-timeout 180

# OpenCodex 2.98 can lose a startup race on a brand-new volume and stay "failed" until its first
# restart. Existing volumes start cleanly, so restart once like an operator would.
status="$(hub_readiness)"
if [ "$status" = failed ]; then
  compose restart hub
  status="$(hub_readiness)"
fi
[ "$status" = ready ] || { compose logs hub; echo "hub readiness: $status" >&2; exit 1; }

compose exec -T hub bun -e '
  const sync = await fetch("http://127.0.0.1:10100/api/sync", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENCODEX_ADMIN_AUTH_TOKEN}` },
  })
  if (!sync.ok) throw new Error(`catalog sync failed: ${sync.status}`)
  const catalog = await fetch("http://127.0.0.1:10100/v1/catalog", {
    headers: { "x-opencodex-api-key": process.env.OPENCODEX_API_AUTH_TOKEN },
  })
  const models = (await catalog.json()).models ?? []
  if (models.length === 0) throw new Error("hub catalog is empty")
  const codex = catalog.headers.get("x-opencodex-codex-version")
  console.log(`hub ready: ${models.length} models from Codex ${codex}`)
'

compose exec -T mcp bun -e '
  const hub = await fetch(`${process.env.OPENCODEX_URL}/healthz`)
  if (!hub.ok) throw new Error("mcp cannot reach the hub")
  const mcp = await fetch("http://127.0.0.1:8080/mcp", { method: "POST" })
  if (mcp.status !== 401) throw new Error(`unauthenticated /mcp returned ${mcp.status}`)
  console.log("mcp reaches the hub and protects /mcp")
'
