# Project conventions

## Repository

- This repository packages a self-hosted OpenCodex hub for Coolify and the companion MCP server that
  exposes hub features to Claude as a custom connector.
- `Dockerfile` builds the hub image from the pinned npm releases of OpenCodex and the Codex CLI.
  Keep it thin: upstream owns proxy behavior, catalog refresh and client pairing. Do not add
  supervisors, wrappers or client tooling that duplicate upstream features.
- `packages/mcp` is the only application code. It runs in its own container
  (`packages/mcp/Dockerfile`) and reaches the hub over the private Docker network.
- To upgrade OpenCodex, Codex or Bun, change the `ARG` values in the Dockerfiles, run the image
  smoke test (`docker/smoke.sh`) and `bun run check`.

## Code

- Use Bun, TypeScript and Effect. Keep dependency versions exact and commit `bun.lock`.
- Organize code by cohesive capability. Each feature exposes a small public interface through its
  `index.ts`; keep internals private and compose layers at the application entry point. Keep
  dependency graphs acyclic. A workspace may not import another workspace unless its lint override
  explicitly allows it.
- Use Effect services and layers for I/O and dependencies, Schema at untrusted boundaries, typed
  errors and Config for configuration. Wrap third-party Promise APIs, including Bun APIs, at their
  adapter boundary. Use Effect platform services or Bun APIs instead of direct Node imports and
  restricted globals.
- Test observable behavior through public interfaces with `bun:test`. Use temporary resources and
  scoped cleanup. Keep real network calls and external mutations out of the default test suite.
- Use the checked-in TypeScript, Oxlint, Oxfmt and Knip configuration. Fix violations at their
  source and document a narrowly scoped exception when one is necessary. Avoid homegrown
  source-reading architecture checks.
- Run `bun run check` and applicable platform-specific checks before declaring work complete. The
  targeted pre-push hook does not replace the full check.
