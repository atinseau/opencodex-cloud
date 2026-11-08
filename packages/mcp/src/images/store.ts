import {
  Clock,
  Config,
  Context,
  Crypto,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schedule,
} from "effect"
import * as Base64Url from "effect/encoding/Base64Url"

/** Identifiers are 256-bit random capabilities: knowing the URL is the authorization. */
const IMAGE_ID = /^[\w-]{43}$/u

/** Deletes the files of `directory` last modified longer than `retention` ago. */
const purgeExpired = (directory: string, retention: Duration.Duration) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const cutoff = (yield* Clock.currentTimeMillis) - Duration.toMillis(retention)
    for (const name of yield* fs.readDirectory(directory)) {
      const file = path.join(directory, name)
      const modified = Option.map((yield* fs.stat(file)).mtime, (date) => date.getTime())
      if (Option.exists(modified, (time) => time < cutoff)) {
        yield* fs.remove(file)
      }
    }
  }).pipe(Effect.catch((error) => Effect.logWarning("Image purge failed", error)))

/** Generated images, kept on disk for a limited time so Claude can link to the full resolution. */
export class ImageStore extends Context.Service<
  ImageStore,
  {
    readonly retention: Duration.Duration
    /** A fresh identifier, for an image that will be stored later with `put`. */
    readonly newId: Effect.Effect<string>
    save(png: Uint8Array): Effect.Effect<string>
    /** Stores an image under a reserved identifier, once. Returns `false` if one is already there. */
    put(id: string, png: Uint8Array): Effect.Effect<boolean>
    has(id: string): Effect.Effect<boolean>
    read(id: string): Effect.Effect<Option.Option<Uint8Array>>
  }
>()("opencodex-cloud/mcp/images/ImageStore") {
  static readonly layer = Layer.effect(
    ImageStore,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const crypto = yield* Crypto.Crypto
      const dataDirectory = yield* Config.String("MCP_DATA_DIR").pipe(Config.withDefault("/data"))
      const retention = yield* Config.Duration("MCP_IMAGE_RETENTION").pipe(
        Config.withDefault(Duration.days(7)),
      )
      const directory = path.join(dataDirectory, "images")
      const fileOf = (id: string) => path.join(directory, `${id}.png`)
      yield* Effect.orDie(fs.makeDirectory(directory, { recursive: true }))
      yield* Effect.forkScoped(
        Effect.repeat(purgeExpired(directory, retention), Schedule.spaced("1 hour")),
      )

      const newId = Effect.orDie(Effect.map(crypto.randomBytes(32), Base64Url.encode))
      const put = Effect.fn("ImageStore.put")(
        function* (id: string, png: Uint8Array) {
          if (!IMAGE_ID.test(id)) {
            return false
          }
          yield* fs.writeFile(fileOf(id), png, { mode: 0o600, flag: "wx" })
          return true
        },
        Effect.catchIf(
          (error) => error.reason._tag === "AlreadyExists",
          () => Effect.succeed(false),
        ),
        Effect.orDie,
      )

      return ImageStore.of({
        retention,
        newId,
        save: Effect.fn("ImageStore.save")(function* (png: Uint8Array) {
          const id = yield* newId
          yield* put(id, png)
          return id
        }),
        put,
        has: (id) =>
          IMAGE_ID.test(id)
            ? Effect.orElseSucceed(fs.exists(fileOf(id)), () => false)
            : Effect.succeed(false),
        read: (id) =>
          IMAGE_ID.test(id) ? Effect.option(fs.readFile(fileOf(id))) : Effect.succeedNone,
      })
    }),
  )
}
