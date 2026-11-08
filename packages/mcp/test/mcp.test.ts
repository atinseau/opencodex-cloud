import { afterAll, beforeAll, describe, expect, test } from "bun:test"

import * as Base64 from "effect/encoding/Base64"

import { ORIGIN, PNG_BASE64, startServer, UPSTREAM_KEY } from "./harness.ts"
import type { TestServer } from "./harness.ts"
import { linkIn, openSession } from "./mcp-session.ts"
import type { McpSession } from "./mcp-session.ts"

let server: TestServer
let session: McpSession

beforeAll(async () => {
  server = await startServer()
  session = await openSession(server)
})

afterAll(async () => {
  await server.dispose()
})

const strict = (...required: Array<string>) => ({
  type: "object",
  required,
  additionalProperties: false,
})

test("lists the image tools with strict input schemas", async () => {
  const { result } = await session.call("tools/list")
  expect(result).toMatchObject({
    tools: [
      { name: "generate_image", inputSchema: strict("prompt") },
      { name: "edit_image", inputSchema: strict("image_url", "prompt") },
      { name: "request_image_upload", annotations: { readOnlyHint: true } },
    ],
  })
})

describe("generate_image", () => {
  test("returns a JPEG preview and a link to the original PNG", async () => {
    const requests: Array<{ authorization: string | null; body: unknown }> = []
    server.setUpstream(async (request) => {
      requests.push({
        authorization: request.headers.get("authorization"),
        body: await request.json(),
      })
      return Response.json({ created: 1, data: [{ b64_json: PNG_BASE64 }] })
    })

    const result = await session.callTool("generate_image", { prompt: "a red apple" })
    expect(requests).toEqual([
      { authorization: `Bearer ${UPSTREAM_KEY}`, body: { prompt: "a red apple" } },
    ])
    expect(result.isError).toBeUndefined()
    expect(result.content[0]).toMatchObject({ type: "image", mimeType: "image/jpeg" })

    const link = linkIn(result)
    expect(link.startsWith(`${ORIGIN}/mcp/images/`)).toBe(true)
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
    const result = await session.callTool("generate_image", { prompt: "a red apple" })
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
    const response = await session.call("tools/call", {
      name: "generate_image",
      arguments: { prompt: "" },
    })
    expect(response.error?.code).toBe(-32_602)
    expect(called).toBe(false)
  })
})

test("unknown image links return 404", async () => {
  expect((await server.request(`/mcp/images/${"A".repeat(43)}.png`)).status).toBe(404)
  expect((await server.request("/mcp/images/..%2F..%2Fetc%2Fpasswd")).status).toBe(404)
})
