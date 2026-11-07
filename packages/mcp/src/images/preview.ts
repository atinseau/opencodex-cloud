import { Effect, Schema } from "effect"

/** Claude rejects tool results above about 150,000 characters; keep the base64 preview well below. */
const MAX_PREVIEW_BYTES = 90_000
const ATTEMPTS = [
  { size: 1024, quality: 75 },
  { size: 896, quality: 65 },
  { size: 768, quality: 60 },
  { size: 768, quality: 45 },
  { size: 640, quality: 45 },
  { size: 512, quality: 45 },
] as const

class PreviewError extends Schema.TaggedError<PreviewError, { readonly brand: unique symbol }>()(
  "PreviewError",
  { cause: Schema.Defect() },
) {}

interface Preview {
  readonly jpeg: Uint8Array
  readonly width: number
  readonly height: number
}

const render = (source: Uint8Array, size: number, quality: number) =>
  Effect.tryPromise({
    try: async () => {
      const image = new Bun.Image(source).resize(size, size, {
        fit: "inside",
        withoutEnlargement: true,
      })
      const jpeg = await image.jpeg({ quality }).bytes()
      return { jpeg, width: image.width, height: image.height }
    },
    catch: (cause) => new PreviewError({ cause }),
  })

/** Small JPEG rendition of a generated image that fits in a Claude tool result. */
export const previewOf = Effect.fn("previewOf")(function* (png: Uint8Array) {
  let preview: Preview | undefined
  for (const { size, quality } of ATTEMPTS) {
    preview = yield* render(png, size, quality)
    if (preview.jpeg.byteLength <= MAX_PREVIEW_BYTES) {
      return preview
    }
  }
  return preview ?? (yield* render(png, 512, 50))
})
