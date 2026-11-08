import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"

import * as Base64 from "effect/encoding/Base64"

import { ORIGIN, PNG_BASE64, startServer } from "./harness.ts"
import type { TestServer } from "./harness.ts"
import { linkIn, openSession } from "./mcp-session.ts"
import type { McpSession } from "./mcp-session.ts"

/** A 2×1 PNG the fake hub returns for edits, distinct from the generated 1×1 image. */
const EDITED_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP8z8BQz8DAwAAACoUBgBfn3IcAAAAASUVORK5CYII="
/** A 1×2 PNG the fake hub generates for "a cat", to tell the images of a combination apart. */
const CAT_PNG = Base64.encode(
  await new Bun.Image(Uint8Array.fromBase64(PNG_BASE64))
    .resize(1, 2, { fit: "fill" })
    .png()
    .bytes(),
)

const dataUrl = (png: string) => ({ image_url: `data:image/png;base64,${png}` })

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
    const isCat = (await request.text()).includes('"a cat"')
    return Response.json({ data: [{ b64_json: isCat ? CAT_PNG : PNG_BASE64 }] })
  })
})

beforeEach(() => {
  edits = []
})

afterAll(async () => {
  await server.dispose()
})

const generated = async (prompt = "an apple") =>
  linkIn(await session.callTool("generate_image", { prompt }))

const edit = (imageUrls: Array<string>, prompt = "make it green") =>
  session.callTool("edit_image", { image_urls: imageUrls, prompt })

const download = async (link: string) => Base64.encode(await (await server.request(link)).bytes())

test("edits a generated image into a new file and keeps the original", async () => {
  const original = await generated()
  const result = await edit([original], "make the apple green")

  expect(edits).toEqual([{ prompt: "make the apple green", images: [dataUrl(PNG_BASE64)] }])
  expect(result.isError).toBeUndefined()
  expect(result.content[0]).toMatchObject({ type: "image", mimeType: "image/jpeg" })
  const edited = linkIn(result)
  expect(edited).not.toBe(original)
  expect(await download(edited)).toBe(EDITED_PNG)
  expect(await download(original)).toBe(PNG_BASE64)
})

test("combines several images in the order given", async () => {
  const scene = await generated()
  const cat = await generated("a cat")
  const result = await edit([scene, cat], "put the cat from the second image in the first")

  expect(edits).toEqual([
    {
      prompt: "put the cat from the second image in the first",
      images: [dataUrl(PNG_BASE64), dataUrl(CAT_PNG)],
    },
  ])
  expect(await download(linkIn(result))).toBe(EDITED_PNG)
})

test("refuses images it did not produce without calling OpenCodex", async () => {
  const known = await generated()
  const file = known.split("/").at(-1) ?? ""
  const unknown = [
    `${ORIGIN}/mcp/images/${"A".repeat(43)}.png`,
    `https://example.com/mcp/images/${file}`,
    "https://example.com/cat.png",
  ]
  const results = await Promise.all([
    ...unknown.map((imageUrl) => edit([imageUrl])),
    edit([known, "https://example.com/cat.png"]),
  ])

  expect(edits).toEqual([])
  for (const result of results) {
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("unknown or has expired")
  }
  expect(results[3]?.content[0]?.text).toContain("https://example.com/cat.png")
})

test("accepts at most four images", async () => {
  const image = await generated()
  const response = await session.call("tools/call", {
    name: "edit_image",
    arguments: { image_urls: Array.from({ length: 5 }, () => image), prompt: "combine them" },
  })
  expect(response.error?.code).toBe(-32_602)
  expect(edits).toEqual([])
})
