import { afterAll, beforeAll, describe, expect, test } from "bun:test"

import { Schema } from "effect"
import * as Base64 from "effect/encoding/Base64"

import { ORIGIN, PNG_BASE64, startServer, UPSTREAM_KEY } from "./harness.ts"
import type { TestServer } from "./harness.ts"
import { signIn } from "./oauth-client.ts"

const ToolResult = Schema.Struct({
  isError: Schema.optional(Schema.Boolean),
  content: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      text: Schema.optional(Schema.String),
      data: Schema.optional(Schema.String),
      mimeType: Schema.optional(Schema.String),
    }),
  ),
})
const RpcResponse = Schema.Struct({
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({ code: Schema.Int, message: Schema.String })),
})
const decodeRpc = Schema.decodeUnknownSync(RpcResponse)
const decodeToolResult = Schema.decodeUnknownSync(ToolResult)

let server: TestServer
let call: (method: string, params?: unknown) => Promise<typeof RpcResponse.Type>

beforeAll(async () => {
  server = await startServer()
  const { access_token: token } = await signIn(server)
  let session = ""
  let id = 0
  call = async (method, params) => {
    id += 1
    const response = await server.request("/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...(session === ""
          ? {}
          : { "mcp-session-id": session, "mcp-protocol-version": "2025-06-18" }),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    })
    session = response.headers.get("mcp-session-id") ?? session
    return decodeRpc(await response.json())
  }
  await call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  })
})

afterAll(async () => {
  await server.dispose()
})

const generate = async (args: unknown) =>
  decodeToolResult((await call("tools/call", { name: "generate_image", arguments: args })).result)

describe("generate_image", () => {
  test("is listed with a prompt-only input schema", async () => {
    const { result } = await call("tools/list")
    expect(result).toMatchObject({
      tools: [
        {
          name: "generate_image",
          inputSchema: { type: "object", required: ["prompt"], additionalProperties: false },
        },
      ],
    })
  })

  test("returns a JPEG preview and a link to the original PNG", async () => {
    const requests: Array<{ authorization: string | null; body: unknown }> = []
    server.setUpstream(async (request) => {
      requests.push({
        authorization: request.headers.get("authorization"),
        body: await request.json(),
      })
      return Response.json({ created: 1, data: [{ b64_json: PNG_BASE64 }] })
    })

    const result = await generate({ prompt: "a red apple" })
    const [image, description] = result.content
    expect(requests).toEqual([
      { authorization: `Bearer ${UPSTREAM_KEY}`, body: { prompt: "a red apple" } },
    ])
    expect(result.isError).toBeUndefined()
    expect(image).toMatchObject({ type: "image", mimeType: "image/jpeg" })

    const link = /\/images\/[\w-]{43}\.png/u.exec(description?.text ?? "")?.[0] ?? ""
    expect(description?.text).toContain(`${ORIGIN}${link}`)
    const download = await server.request(link)
    expect(download.headers.get("content-type")).toBe("image/png")
    expect(Base64.encode(await download.bytes())).toBe(PNG_BASE64)
  })

  test("reports OpenCodex failures to Claude as a tool error", async () => {
    server.setUpstream(() =>
      Response.json(
        { error: { message: "Selected Codex account needs reauthentication" } },
        { status: 401 },
      ),
    )
    const result = await generate({ prompt: "a red apple" })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toBe(
      "OpenCodex returned HTTP 401: Selected Codex account needs reauthentication",
    )
  })

  test("rejects an empty prompt without calling OpenCodex", async () => {
    let called = false
    server.setUpstream(() => {
      called = true
      return new Response(null, { status: 500 })
    })
    const response = await call("tools/call", { name: "generate_image", arguments: { prompt: "" } })
    expect(response.error?.code).toBe(-32_602)
    expect(called).toBe(false)
  })
})

test("unknown image links return 404", async () => {
  expect((await server.request(`/images/${"A".repeat(43)}.png`)).status).toBe(404)
  expect((await server.request("/images/..%2F..%2Fetc%2Fpasswd")).status).toBe(404)
})
