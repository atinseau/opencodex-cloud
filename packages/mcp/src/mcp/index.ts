import { Layer } from "effect"
import { McpProtocol, McpServer } from "effect/ai"

import { GenerateImageTool } from "./generate-image.ts"

/** Streamable HTTP MCP endpoint served at `/mcp`. */
export const Mcp = GenerateImageTool.pipe(
  Layer.provide(
    McpServer.layerHttp({
      name: "opencodex-cloud",
      version: "0.1.0",
      description: "Image generation through a self-hosted OpenCodex hub",
      path: "/mcp",
      protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26],
    }),
  ),
)
