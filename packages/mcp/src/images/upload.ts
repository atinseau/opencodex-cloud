import { ByteSize, Clock, Context, Crypto, Effect, FileSystem, Layer, Option, Schema } from "effect"
import type { Path } from "effect"
import * as Base64Url from "effect/encoding/Base64Url"
import { HttpRouter, HttpServerRequest, Multipart } from "effect/http"

import { publicEndpoint } from "../config.ts"
import { constantTimeEqual, hmacSha256 } from "../crypto.ts"
import { imageUrl } from "./links.ts"
import { ImageStore } from "./store.ts"
import { MAX_UPLOAD_MEGABYTES, UPLOAD_LIFETIME_SECONDS, UploadPages } from "./upload-page.ts"

/** Longest side kept from an upload: enough for an edit, small enough to relay to the hub. */
const MAX_SIDE = 2048
/** Refuses decompression bombs before any pixel buffer is allocated. */
const MAX_PIXELS = 60_000_000
const UPLOAD_TOKEN = /^([\w-]{43})\.(\d{1,12})\.([\w-]{43})$/u

export interface UploadRequest {
  readonly uploadUrl: string
  /** Where the image will be once the user has uploaded it. */
  readonly imageUrl: string
  readonly expiresIn: string
}

/**
 * One-time upload links. Each link reserves the identifier of the image it will receive, so Claude
 * knows the final image link before the user uploads anything. Links are signed with a key held in
 * memory: restarting the connector invalidates the pending ones.
 */
export class ImageUploads extends Context.Service<
  ImageUploads,
  {
    readonly request: Effect.Effect<UploadRequest>
    /** The image identifier reserved by a valid, unexpired upload token. */
    reservedId(token: string): Effect.Effect<Option.Option<string>>
  }
>()("opencodex-cloud/mcp/images/ImageUploads") {
  static readonly layer = Layer.effect(
    ImageUploads,
    Effect.gen(function* () {
      const endpoint = yield* publicEndpoint
      const store = yield* ImageStore
      const key = yield* Effect.orDie((yield* Crypto.Crypto).randomBytes(32))
      const signature = (payload: string) => Base64Url.encode(hmacSha256(key, payload))
      const now = Effect.map(Clock.currentTimeMillis, (millis) => Math.floor(millis / 1000))

      return ImageUploads.of({
        request: Effect.gen(function* () {
          const id = yield* store.newId
          const payload = `${id}.${(yield* now) + UPLOAD_LIFETIME_SECONDS}`
          return {
            uploadUrl: `${endpoint.url}/upload/${payload}.${signature(payload)}`,
            imageUrl: imageUrl(endpoint, id),
            expiresIn: "1 hour",
          }
        }),
        reservedId: (token) =>
          Effect.map(now, (seconds) => {
            const [, id = "", expires = "0", tokenSignature = ""] = UPLOAD_TOKEN.exec(token) ?? []
            const valid =
              constantTimeEqual(signature(`${id}.${expires}`), tokenSignature) &&
              Number(expires) > seconds
            return valid ? Option.some(id) : Option.none()
          }),
      })
    }),
  )
}

class UploadRejected extends Schema.TaggedError<
  UploadRejected,
  { readonly brand: unique symbol }
>()("UploadRejected", { reason: Schema.Literals(["tooLarge", "unreadable", "unsupported"]) }) {}

const TOO_LARGE = new Set(["FileTooLarge", "FieldTooLarge", "BodyTooLarge", "TooManyParts"])

const limits = Multipart.limitsServices({
  maxParts: 4,
  maxFieldSize: ByteSize.kilobytes(16),
  maxFileSize: ByteSize.megabytes(MAX_UPLOAD_MEGABYTES),
  maxTotalSize: ByteSize.megabytes(MAX_UPLOAD_MEGABYTES + 1),
})

const UploadForm = Schema.Struct({ image: Multipart.SingleFileSchema })
const TokenParam = Schema.Struct({ token: Schema.String })

/** Bun's codecs for HEIC, AVIF and TIFF depend on the OS and are missing from the Linux image. */
const isUnsupportedFormat = (cause: unknown) =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  cause.code === "ERR_IMAGE_FORMAT_UNSUPPORTED"

/** Decodes the upload, applies its EXIF orientation and re-encodes it as PNG. */
const normalize = (bytes: Uint8Array) =>
  Effect.tryPromise({
    try: () =>
      new Bun.Image(bytes, { maxPixels: MAX_PIXELS })
        .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
        .png()
        .bytes(),
    catch: (cause) =>
      new UploadRejected({ reason: isUnsupportedFormat(cause) ? "unsupported" : "unreadable" }),
  })

const uploadedPng = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const { image } = yield* HttpServerRequest.schemaBodyMultipart(UploadForm)
  return yield* normalize(yield* fs.readFile(image.path))
}).pipe(
  Effect.catchTags({
    MultipartError: ({ reason }) =>
      Effect.fail(
        new UploadRejected({ reason: TOO_LARGE.has(reason._tag) ? "tooLarge" : "unreadable" }),
      ),
    SchemaError: () => Effect.fail(new UploadRejected({ reason: "unreadable" })),
    PlatformError: Effect.die,
  }),
  Effect.provideContext(limits),
  Effect.scoped,
)

type UploadPage = typeof UploadPages.form

/** Stores the uploaded image under its reserved identifier and answers with the matching page. */
const saveUpload = (store: ImageStore["Service"], id: string, link: string) =>
  Effect.gen(function* () {
    const png = yield* Effect.result(uploadedPng)
    if (png._tag === "Failure") {
      return UploadPages[png.failure.reason]
    }
    return (yield* store.put(id, png.success)) ? UploadPages.done(link) : UploadPages.used(link)
  })

/** Upload page and form target, mounted at `<endpoint>/upload/<token>`. */
export const UploadRoutes = HttpRouter.use(
  Effect.fn(function* (router) {
    const endpoint = yield* publicEndpoint
    const uploads = yield* ImageUploads
    const store = yield* ImageStore
    const platform = yield* Effect.context<FileSystem.FileSystem | Path.Path>()

    const reservation = Effect.flatMap(
      Effect.option(HttpRouter.schemaPathParams(TokenParam)),
      Option.match({
        onNone: () => Effect.succeedNone,
        onSome: ({ token }) => uploads.reservedId(token),
      }),
    )
    const open = (
      receive: (
        id: string,
      ) => Effect.Effect<UploadPage, never, HttpServerRequest.HttpServerRequest>,
    ) =>
      Effect.gen(function* () {
        const id = yield* reservation
        if (Option.isNone(id)) {
          return UploadPages.expired
        }
        if (yield* store.has(id.value)) {
          return UploadPages.used(imageUrl(endpoint, id.value))
        }
        return yield* receive(id.value)
      })

    yield* router.add(
      "GET",
      `${endpoint.path}/upload/:token`,
      open(() => Effect.succeed(UploadPages.form)),
    )
    yield* router.add(
      "POST",
      `${endpoint.path}/upload/:token`,
      open((id) =>
        saveUpload(store, id, imageUrl(endpoint, id)).pipe(Effect.provideContext(platform)),
      ),
    )
  }),
)
