import { afterAll, beforeAll, expect, test } from "bun:test"

import { Effect, Layer } from "effect"
import { McpClient, McpProtocol } from "effect/ai"
import type { McpClientError } from "effect/ai"
import { FetchHttpClient } from "effect/http"

import { PNG_BASE64, startServer } from "./harness.ts"
import type { TestServer } from "./harness.ts"
import { signIn } from "./oauth-client.ts"

let server: TestServer
let token: string

beforeAll(async () => {
  server = await startServer()
  token = (await signIn(server)).access_token
  server.setUpstream(() => Response.json({ data: [{ b64_json: PNG_BASE64 }] }))
})

afterAll(async () => {
  await server.dispose()
})

/** Runs `use` with an MCP client speaking the sessionless protocol Claude tries first. */
const withModernClient = <A>(
  use: (client: McpClient.McpClient) => Effect.Effect<A, McpClientError.McpClientError>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* use(yield* McpClient.McpClient)
    }).pipe(
      Effect.provide(
        McpClient.layerHttp({
          name: "protocol-test",
          version: "0",
          protocol: McpProtocol.v2026_07_28,
          url: server.url("/mcp"),
          headers: { authorization: `Bearer ${token}` },
        }).pipe(Layer.provide(FetchHttpClient.layer)),
      ),
    ),
  )

test("accepts the sessionless 2026-07-28 discovery that Claude sends first", async () => {
  const { version, tools } = await withModernClient((client) =>
    Effect.map(client.listTools(), (listed) => ({
      version: client.protocolVersion,
      tools: listed.map((tool) => tool.name),
    })),
  )
  expect(version).toBe("2026-07-28")
  expect(tools).toEqual(["generate_image", "edit_image", "view_image", "request_image_upload"])
})

test("generates an image without a session", async () => {
  const result = await withModernClient((client) =>
    Effect.flatMap(client.listTools(), ([tool]) =>
      tool === undefined
        ? Effect.die("generate_image is not listed")
        : client.callTool({ tool, arguments: { prompt: "a red apple" } }),
    ),
  )
  expect(result.isError).toBeUndefined()
  expect(result.content.map((block) => block.type)).toEqual(["image", "text"])
})
