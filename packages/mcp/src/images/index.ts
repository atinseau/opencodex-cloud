import { Context, Duration, Effect, Layer, Option, Schema } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"

import { publicEndpoint } from "../config.ts"
import { ImageGenerationError } from "./errors.ts"
import { imageUrl, storedIdOf } from "./links.ts"
import { OpenCodexImages } from "./opencodex.ts"
import { previewOf } from "./preview.ts"
import { ImageStore } from "./store.ts"
import { ImageUploads, UploadRoutes } from "./upload.ts"

export { ImageGenerationError } from "./errors.ts"
export { ImageUploads } from "./upload.ts"
export type { UploadRequest } from "./upload.ts"

export interface GeneratedImage {
  readonly preview: Uint8Array
  readonly width: number
  readonly height: number
  readonly downloadUrl: string
  readonly retainedFor: string
}

const retentionLabel = (retention: Duration.Duration): string => {
  const days = Duration.toDays(retention)
  return Number.isInteger(days) ? `${days} day${days === 1 ? "" : "s"}` : Duration.format(retention)
}

const unknownSource = new ImageGenerationError({
  message:
    "This image is unknown or has expired. edit_image only accepts image links returned by generate_image, edit_image or request_image_upload. A link from request_image_upload only works once the user has finished the upload.",
})

/**
 * Creates and edits images through the hub. Every result keeps its full PNG on disk and comes
 * with a preview small enough for Claude.
 */
export class ImageGeneration extends Context.Service<
  ImageGeneration,
  {
    create(prompt: string): Effect.Effect<GeneratedImage, ImageGenerationError>
    /** Edits an image this connector produced, identified by its download link. */
    edit(source: string, prompt: string): Effect.Effect<GeneratedImage, ImageGenerationError>
  }
>()("opencodex-cloud/mcp/images/ImageGeneration") {
  static readonly layer = Layer.effect(
    ImageGeneration,
    Effect.gen(function* () {
      const endpoint = yield* publicEndpoint
      const upstream = yield* OpenCodexImages
      const store = yield* ImageStore

      const publish = Effect.fn("ImageGeneration.publish")(function* (png: Uint8Array) {
        const preview = yield* previewOf(png).pipe(
          Effect.mapError(
            () => new ImageGenerationError({ message: "The generated image is unreadable." }),
          ),
        )
        const id = yield* store.save(png)
        return {
          preview: preview.jpeg,
          width: preview.width,
          height: preview.height,
          downloadUrl: imageUrl(endpoint, id),
          retainedFor: retentionLabel(store.retention),
        }
      })

      const stored = Effect.fn("ImageGeneration.stored")(function* (source: string) {
        const png = yield* Option.match(storedIdOf(endpoint, source), {
          onNone: () => Effect.succeed(Option.none<Uint8Array>()),
          onSome: (id) => store.read(id),
        })
        if (Option.isNone(png)) {
          return yield* unknownSource
        }
        return png.value
      })

      return ImageGeneration.of({
        create: Effect.fn("ImageGeneration.create")(function* (prompt: string) {
          return yield* publish(yield* upstream.generate(prompt))
        }),
        edit: Effect.fn("ImageGeneration.edit")(function* (source: string, prompt: string) {
          const original = yield* stored(source)
          return yield* publish(yield* upstream.edit(prompt, original))
        }),
      })
    }),
  )
}

const ImageFile = Schema.Struct({
  file: Schema.String.check(Schema.isPattern(/^[\w-]{43}\.png$/u)),
})

const download = (store: ImageStore["Service"]) =>
  Effect.gen(function* () {
    const params = yield* Effect.option(HttpRouter.schemaPathParams(ImageFile))
    const png = yield* Option.match(params, {
      onNone: () => Effect.succeedNone,
      onSome: ({ file }) => store.read(file.slice(0, -".png".length)),
    })
    return Option.match(png, {
      onNone: () => HttpServerResponse.text("Not found", { status: 404 }),
      onSome: (bytes) =>
        HttpServerResponse.uint8Array(bytes, {
          contentType: "image/png",
          headers: {
            "cache-control": "private, max-age=86400",
            "x-content-type-options": "nosniff",
          },
        }),
    })
  })

const DownloadRoute = HttpRouter.use(
  Effect.fn(function* (router) {
    const { path } = yield* publicEndpoint
    yield* router.add("GET", `${path}/images/:file`, download(yield* ImageStore))
  }),
)

/**
 * Image generation, editing and upload services, with the download route for full-resolution
 * files and the upload page.
 */
export const Images = Layer.mergeAll(
  DownloadRoute,
  ImageGeneration.layer,
  UploadRoutes.pipe(Layer.provideMerge(ImageUploads.layer)),
).pipe(Layer.provide(OpenCodexImages.layer), Layer.provideMerge(ImageStore.layer))
