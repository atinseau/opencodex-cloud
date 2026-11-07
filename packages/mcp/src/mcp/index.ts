import { Effect, Layer } from "effect"
import { McpProtocol, McpServer } from "effect/ai"

import { publicEndpoint } from "../config.ts"
import { GenerateImageTool } from "./generate-image.ts"

/** Streamable HTTP MCP endpoint served at the path of `MCP_PUBLIC_URL`. */
export const Mcp = GenerateImageTool.pipe(
  Layer.provide(
    Layer.unwrap(
      Effect.gen(function* () {
        const { path } = yield* publicEndpoint
        return McpServer.layerHttp({
          name: "opencodex-cloud",
          version: "0.1.0",
          description: "Image generation through a self-hosted OpenCodex hub",
          path,
          protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26],
        })
      }),
    ),
  ),
)
