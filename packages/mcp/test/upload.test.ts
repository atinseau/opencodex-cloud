import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"

import { PNG_BASE64, startServer } from "./harness.ts"
import type { TestServer } from "./harness.ts"
import { openSession } from "./mcp-session.ts"
import type { McpSession } from "./mcp-session.ts"

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71])

let server: TestServer
let session: McpSession
/** Raw JSON bodies the fake hub received on `/v1/images/edits`. */
let edits: Array<string>

beforeAll(async () => {
  server = await startServer()
  session = await openSession(server)
  server.setUpstream(async (request) => {
    edits.push(await request.text())
    return Response.json({ data: [{ b64_json: PNG_BASE64 }] })
  })
})

beforeEach(() => {
  edits = []
})

afterAll(async () => {
  await server.dispose()
})

/** Asks for an upload link the way Claude does and returns both announced links. */
const requestUpload = async () => {
  const result = await session.callTool("request_image_upload", {})
  const text = result.content[0]?.text ?? ""
  return {
    uploadUrl: /Upload link for the user: (\S+)/u.exec(text)?.[1] ?? "",
    imageUrl: /image_url (\S+\.png)/u.exec(text)?.[1] ?? "",
  }
}

const photo = () => new Bun.Image(Uint8Array.fromBase64(PNG_BASE64)).jpeg().blob()

const upload = (url: string, file: Blob) => {
  const form = new FormData()
  form.append("image", file, "photo.jpg")
  return server.request(url, { method: "POST", body: form })
}

const editImage = (imageUrl: string) =>
  session.callTool("edit_image", { image_url: imageUrl, prompt: "make it green" })

test("an uploaded photo becomes a PNG that edit_image can modify", async () => {
  const { uploadUrl, imageUrl } = await requestUpload()
  const page = await server.request(uploadUrl)
  expect(page.status).toBe(200)
  expect(page.headers.get("referrer-policy")).toBe("no-referrer")
  expect(page.headers.get("content-security-policy")).toContain("form-action 'self'")
  expect(await page.text()).toContain('enctype="multipart/form-data"')

  const uploaded = await upload(uploadUrl, await photo())
  expect(uploaded.status).toBe(200)
  expect(await uploaded.text()).toContain(`<img src="${imageUrl}"`)
  const stored = await server.request(imageUrl)
  expect(stored.headers.get("content-type")).toBe("image/png")
  expect((await stored.bytes()).slice(0, 4)).toEqual(PNG_SIGNATURE)

  const edited = await editImage(imageUrl)
  expect(edited.isError).toBeUndefined()
  expect(edits).toHaveLength(1)
  expect(edits[0]).toContain('"image_url":"data:image/png;base64,')
})

test("an upload link works once", async () => {
  const { uploadUrl } = await requestUpload()
  expect((await upload(uploadUrl, await photo())).status).toBe(200)
  expect((await upload(uploadUrl, await photo())).status).toBe(409)
  expect((await server.request(uploadUrl)).status).toBe(409)
})

test("edit_image waits for the upload before calling OpenCodex", async () => {
  const { imageUrl } = await requestUpload()
  const result = await editImage(imageUrl)
  expect(result.isError).toBe(true)
  expect(result.content[0]?.text).toContain("finished the upload")
  expect(edits).toEqual([])
})

test("forged or tampered upload links are refused", async () => {
  const { uploadUrl } = await requestUpload()
  const [base = "", id = "", expires = "", signature = ""] =
    /^(.+\/upload\/)([\w-]{43})\.(\d+)\.([\w-]{43})$/u.exec(uploadUrl)?.slice(1) ?? []
  const forged = [
    `${base}${id}.${Number(expires) + 86_400}.${signature}`,
    `${base}${"A".repeat(43)}.${expires}.${signature}`,
    `${base}${id}.${expires}.${"A".repeat(43)}`,
    `${base}not-a-token`,
  ]
  const statuses = await Promise.all(
    forged.map(async (url) => (await upload(url, await photo())).status),
  )
  expect(statuses).toEqual([404, 404, 404, 404])
  expect((await server.request(uploadUrl)).status).toBe(200)
})

test("unreadable or oversized files are refused and the link stays usable", async () => {
  const { uploadUrl } = await requestUpload()
  const notAnImage = new Blob(["<svg xmlns='http://www.w3.org/2000/svg'/>"], {
    type: "image/svg+xml",
  })
  const oversized = new Blob([new Uint8Array(26 * 1000 * 1000)], { type: "image/png" })
  expect((await upload(uploadUrl, notAnImage)).status).toBe(400)
  expect((await upload(uploadUrl, oversized)).status).toBe(413)
  expect((await upload(uploadUrl, await photo())).status).toBe(200)
})
