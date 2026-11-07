import { Context, Duration, Effect, Layer, Option, Schema } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"

import { publicOrigin } from "../config.ts"
import { ImageGenerationError } from "./errors.ts"
import { OpenCodexImages } from "./opencodex.ts"
import { previewOf } from "./preview.ts"
import { ImageStore } from "./store.ts"

export { ImageGenerationError } from "./errors.ts"

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

/** Generates an image through the hub, keeps the full PNG and prepares a preview for Claude. */
export class ImageGeneration extends Context.Service<
  ImageGeneration,
  { create(prompt: string): Effect.Effect<GeneratedImage, ImageGenerationError> }
>()("opencodex-cloud/mcp/images/ImageGeneration") {
  static readonly layer = Layer.effect(
    ImageGeneration,
    Effect.gen(function* () {
      const origin = yield* publicOrigin
      const upstream = yield* OpenCodexImages
      const store = yield* ImageStore
      const create = Effect.fn("ImageGeneration.create")(function* (prompt: string) {
        const png = yield* upstream.generate(prompt)
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
          downloadUrl: `${origin}/images/${id}.png`,
          retainedFor: retentionLabel(store.retention),
        }
      })
      return ImageGeneration.of({ create })
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
    yield* router.add("GET", "/images/:file", download(yield* ImageStore))
  }),
)

/** Image generation service and the download route for full-resolution files. */
export const Images = Layer.mergeAll(DownloadRoute, ImageGeneration.layer).pipe(
  Layer.provide(OpenCodexImages.layer),
  Layer.provideMerge(ImageStore.layer),
)
