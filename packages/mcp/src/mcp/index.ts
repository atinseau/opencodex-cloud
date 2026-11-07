import { Effect, Layer } from "effect"
import { McpProtocol, McpServer } from "effect/ai"

import { publicEndpoint } from "../config.ts"
import { GenerateImageTool } from "./generate-image.ts"
import { McpRequestLog } from "./request-log.ts"

/**
 * Streamable HTTP MCP endpoint served at the path of `MCP_PUBLIC_URL`. Claude opens with the
 * sessionless 2026-07-28 `server/discover` handshake and falls back to a session-based
 * `initialize`, so both kinds of protocol are offered.
 */
const Server = GenerateImageTool.pipe(
  Layer.provide(
    Layer.unwrap(
      Effect.gen(function* () {
        const { path } = yield* publicEndpoint
        return McpServer.layerHttp({
          name: "opencodex-cloud",
          version: "0.1.0",
          description: "Image generation through a self-hosted OpenCodex hub",
          path,
          protocols: [
            McpProtocol.v2026_07_28,
            McpProtocol.v2025_11_25,
            McpProtocol.v2025_06_18,
            McpProtocol.v2025_03_26,
          ],
        })
      }),
    ),
  ),
)

export const Mcp = Layer.mergeAll(Server, McpRequestLog)
