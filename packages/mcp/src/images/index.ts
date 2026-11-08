import { Effect, Layer, Option, Schema } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"

import { publicEndpoint } from "../config.ts"
import { ImageGeneration } from "./generation.ts"
import { OpenCodexImages } from "./opencodex.ts"
import { ImageStore } from "./store.ts"
import { ImageUploads, UploadRoutes } from "./upload.ts"

export { ImageGenerationError } from "./errors.ts"
export { ImageGeneration, MAX_IMAGES_PER_CALL } from "./generation.ts"
export type { GeneratedImage, ImagePreview } from "./generation.ts"
export { ImageUploads } from "./upload.ts"
export type { UploadRequest } from "./upload.ts"

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
 * Image generation, editing, preview and upload services, with the download route for
 * full-resolution files and the upload page.
 */
export const Images = Layer.mergeAll(
  DownloadRoute,
  ImageGeneration.layer,
  UploadRoutes.pipe(Layer.provideMerge(ImageUploads.layer)),
).pipe(Layer.provide(OpenCodexImages.layer), Layer.provideMerge(ImageStore.layer))
