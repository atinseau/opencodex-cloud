import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"

import * as Base64 from "effect/encoding/Base64"

import { PNG_BASE64, startServer } from "./harness.ts"
import type { TestServer } from "./harness.ts"
import { linkIn, openSession } from "./mcp-session.ts"
import type { McpSession } from "./mcp-session.ts"
import { noisyPng } from "./noisy-png.ts"

/** Claude rejects tool results above about 150,000 characters of base64. */
const PREVIEW_BUDGET_BYTES = 90_000
const NOISE = Base64.encode(noisyPng(1024, 1024))

let server: TestServer
let session: McpSession
let hubCalls: Array<string>

beforeAll(async () => {
  server = await startServer()
  session = await openSession(server)
  server.setUpstream(async (request) => {
    hubCalls.push(new URL(request.url).pathname)
    const noisy = (await request.text()).includes('"noise"')
    return Response.json({ data: [{ b64_json: noisy ? NOISE : PNG_BASE64 }] })
  })
})

beforeEach(() => {
  hubCalls = []
})

afterAll(async () => {
  await server.dispose()
})

const generated = async (prompt: string) =>
  linkIn(await session.callTool("generate_image", { prompt }))

const view = (imageUrls: Array<string>) => session.callTool("view_image", { image_urls: imageUrls })

test("shows each image after its link, in order, without calling the image model", async () => {
  const apple = await generated("an apple")
  const noise = await generated("noise")
  hubCalls = []
  const result = await view([apple, noise])

  expect(hubCalls).toEqual([])
  expect(result.isError).toBeUndefined()
  expect(result.content.map(({ type }) => type)).toEqual(["text", "image", "text", "image"])
  expect(result.content[0]?.text).toContain(`Image 1: ${apple}`)
  expect(result.content[2]?.text).toContain(`Image 2: ${noise}`)
  expect(result.content[3]?.mimeType).toBe("image/jpeg")
})

test("four previews of an incompressible image fit in one tool result", async () => {
  const noise = await generated("noise")
  const result = await view([noise, noise, noise, noise])
  const sizes = result.content.flatMap(({ type, data }) =>
    type === "image" ? [Uint8Array.fromBase64(data ?? "").length] : [],
  )

  expect(sizes).toHaveLength(4)
  expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThanOrEqual(PREVIEW_BUDGET_BYTES)
})

test("refuses links it did not produce", async () => {
  const result = await view(["https://example.com/cat.png"])
  expect(result.isError).toBe(true)
  expect(result.content[0]?.text).toContain("unknown or has expired")
  expect(hubCalls).toEqual([])
})
