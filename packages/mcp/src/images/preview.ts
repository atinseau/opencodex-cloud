import { Effect, Schema } from "effect"

/**
 * Claude rejects tool results above about 150,000 characters: the JPEG previews of one result,
 * once in base64, must stay well below.
 */
export const PREVIEW_BUDGET_BYTES = 90_000
const ATTEMPTS = [
  { size: 1024, quality: 75 },
  { size: 896, quality: 65 },
  { size: 768, quality: 60 },
  { size: 768, quality: 45 },
  { size: 640, quality: 45 },
  { size: 512, quality: 45 },
  { size: 384, quality: 45 },
  { size: 256, quality: 45 },
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

/**
 * Largest JPEG rendition of an image within `maxBytes`, falling back to the smallest attempt.
 * Several previews in one tool result share `PREVIEW_BUDGET_BYTES`.
 */
export const previewOf = Effect.fn("previewOf")(function* (
  png: Uint8Array,
  maxBytes: number = PREVIEW_BUDGET_BYTES,
) {
  let preview: Preview | undefined
  for (const { size, quality } of ATTEMPTS) {
    preview = yield* render(png, size, quality)
    if (preview.jpeg.byteLength <= maxBytes) {
      return preview
    }
  }
  return preview ?? (yield* render(png, 256, 45))
})
