import { Context, Duration, Effect, Layer, Option } from "effect"

import { publicEndpoint } from "../config.ts"
import type { PublicEndpoint } from "../config.ts"
import { ImageGenerationError } from "./errors.ts"
import { imageUrl, storedIdOf } from "./links.ts"
import { OpenCodexImages } from "./opencodex.ts"
import { PREVIEW_BUDGET_BYTES, previewOf } from "./preview.ts"
import { ImageStore } from "./store.ts"

export interface GeneratedImage {
  readonly preview: Uint8Array
  readonly width: number
  readonly height: number
  readonly downloadUrl: string
  readonly retainedFor: string
}

export interface ImagePreview {
  readonly url: string
  readonly preview: Uint8Array
  readonly width: number
  readonly height: number
}

/** Images one call can take. Each travels to the hub as a base64 PNG of up to a few MB. */
export const MAX_IMAGES_PER_CALL = 4

const retentionLabel = (retention: Duration.Duration): string => {
  const days = Duration.toDays(retention)
  return Number.isInteger(days) ? `${days} day${days === 1 ? "" : "s"}` : Duration.format(retention)
}

const unknownSource = (source: string) =>
  new ImageGenerationError({
    message: `This image is unknown or has expired: ${source.slice(0, 200)}. Only image links returned by generate_image, edit_image or request_image_upload work. A link from request_image_upload only works once the user has finished the upload.`,
  })

const wrongCount = new ImageGenerationError({
  message: `Pass between 1 and ${MAX_IMAGES_PER_CALL} image links.`,
})

const unreadable = new ImageGenerationError({ message: "The image is unreadable." })

const checkCount = (sources: ReadonlyArray<string>) =>
  sources.length === 0 || sources.length > MAX_IMAGES_PER_CALL ? wrongCount : Effect.void

interface StoredImage {
  readonly url: string
  readonly png: Uint8Array
}

/** Reads the image behind a link this connector produced, or fails with a message for Claude. */
const storedImage = (endpoint: PublicEndpoint, store: ImageStore["Service"]) =>
  Effect.fn("ImageGeneration.stored")(function* (source: string) {
    const id = storedIdOf(endpoint, source)
    const png = Option.isSome(id) ? yield* store.read(id.value) : Option.none<Uint8Array>()
    if (Option.isNone(id) || Option.isNone(png)) {
      return yield* unknownSource(source)
    }
    return { url: imageUrl(endpoint, id.value), png: png.value } satisfies StoredImage
  })

/** Previews of several images that together fit in one tool result. */
const previewsOf = (images: ReadonlyArray<StoredImage>) => {
  const budget = Math.floor(PREVIEW_BUDGET_BYTES / images.length)
  return Effect.forEach(images, ({ url, png }) =>
    previewOf(png, budget).pipe(
      Effect.mapError(() => unreadable),
      Effect.map((preview): ImagePreview => ({
        url,
        preview: preview.jpeg,
        width: preview.width,
        height: preview.height,
      })),
    ),
  )
}

/**
 * Creates, edits and shows images through the hub. Every new image keeps its full PNG on disk
 * and comes with a preview small enough for Claude.
 */
export class ImageGeneration extends Context.Service<
  ImageGeneration,
  {
    create(prompt: string): Effect.Effect<GeneratedImage, ImageGenerationError>
    /**
     * Edits the first stored image, identified by its download link, using the others as
     * references.
     */
    edit(
      sources: ReadonlyArray<string>,
      prompt: string,
    ): Effect.Effect<GeneratedImage, ImageGenerationError>
    /** Previews of stored images, sharing one tool result budget, without calling the hub. */
    view(
      sources: ReadonlyArray<string>,
    ): Effect.Effect<ReadonlyArray<ImagePreview>, ImageGenerationError>
  }
>()("opencodex-cloud/mcp/images/ImageGeneration") {
  static readonly layer = Layer.effect(
    ImageGeneration,
    Effect.gen(function* () {
      const endpoint = yield* publicEndpoint
      const upstream = yield* OpenCodexImages
      const store = yield* ImageStore

      const publish = Effect.fn("ImageGeneration.publish")(function* (png: Uint8Array) {
        const preview = yield* Effect.mapError(previewOf(png), () => unreadable)
        const id = yield* store.save(png)
        return {
          preview: preview.jpeg,
          width: preview.width,
          height: preview.height,
          downloadUrl: imageUrl(endpoint, id),
          retainedFor: retentionLabel(store.retention),
        }
      })

      const stored = storedImage(endpoint, store)

      return ImageGeneration.of({
        create: Effect.fn("ImageGeneration.create")(function* (prompt: string) {
          return yield* publish(yield* upstream.generate(prompt))
        }),
        edit: Effect.fn("ImageGeneration.edit")(function* (
          sources: ReadonlyArray<string>,
          prompt: string,
        ) {
          yield* checkCount(sources)
          const originals = yield* Effect.forEach(sources, stored)
          return yield* publish(
            yield* upstream.edit(
              prompt,
              originals.map(({ png }) => png),
            ),
          )
        }),
        view: Effect.fn("ImageGeneration.view")(function* (sources: ReadonlyArray<string>) {
          yield* checkCount(sources)
          return yield* previewsOf(yield* Effect.forEach(sources, stored))
        }),
      })
    }),
  )
}
