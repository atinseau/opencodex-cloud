import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"

import * as Base64 from "effect/encoding/Base64"

import { ORIGIN, PNG_BASE64, startServer } from "./harness.ts"
import type { TestServer } from "./harness.ts"
import { linkIn, openSession } from "./mcp-session.ts"
import type { McpSession } from "./mcp-session.ts"

/** A 2×1 PNG the fake hub returns for edits, distinct from the generated 1×1 image. */
const EDITED_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP8z8BQz8DAwAAACoUBgBfn3IcAAAAASUVORK5CYII="

let server: TestServer
let session: McpSession
let edits: Array<unknown>

beforeAll(async () => {
  server = await startServer()
  session = await openSession(server)
  server.setUpstream(async (request) => {
    if (new URL(request.url).pathname === "/v1/images/edits") {
      edits.push(await request.json())
      return Response.json({ data: [{ b64_json: EDITED_PNG }] })
    }
    return Response.json({ data: [{ b64_json: PNG_BASE64 }] })
  })
})

beforeEach(() => {
  edits = []
})

afterAll(async () => {
  await server.dispose()
})

const generated = async () =>
  linkIn(await session.callTool("generate_image", { prompt: "an apple" }))

const download = async (link: string) => Base64.encode(await (await server.request(link)).bytes())

test("edits a generated image into a new file and keeps the original", async () => {
  const original = await generated()
  const result = await session.callTool("edit_image", {
    image_url: original,
    prompt: "make the apple green",
  })

  expect(edits).toEqual([
    {
      prompt: "make the apple green",
      images: [{ image_url: `data:image/png;base64,${PNG_BASE64}` }],
    },
  ])
  expect(result.isError).toBeUndefined()
  expect(result.content[0]).toMatchObject({ type: "image", mimeType: "image/jpeg" })
  const edited = linkIn(result)
  expect(edited).not.toBe(original)
  expect(await download(edited)).toBe(EDITED_PNG)
  expect(await download(original)).toBe(PNG_BASE64)
})

test("refuses images it did not produce without calling OpenCodex", async () => {
  const file = (await generated()).split("/").at(-1) ?? ""
  const results = await Promise.all(
    [
      `${ORIGIN}/mcp/images/${"A".repeat(43)}.png`,
      `https://example.com/mcp/images/${file}`,
      "https://example.com/cat.png",
    ].map((imageUrl) =>
      session.callTool("edit_image", { image_url: imageUrl, prompt: "make it green" }),
    ),
  )

  expect(edits).toEqual([])
  for (const result of results) {
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("unknown or has expired")
  }
})
