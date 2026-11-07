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

/** Generated images, kept on disk for a limited time so Claude can link to the full resolution. */
export class ImageStore extends Context.Service<
  ImageStore,
  {
    readonly retention: Duration.Duration
    save(png: Uint8Array): Effect.Effect<string>
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

      const purgeExpired = Effect.gen(function* () {
        const cutoff = (yield* Clock.currentTimeMillis) - Duration.toMillis(retention)
        for (const name of yield* fs.readDirectory(directory)) {
          const file = path.join(directory, name)
          const modified = Option.map((yield* fs.stat(file)).mtime, (date) => date.getTime())
          if (Option.exists(modified, (time) => time < cutoff)) {
            yield* fs.remove(file)
          }
        }
      }).pipe(Effect.catch((error) => Effect.logWarning("Image purge failed", error)))
      yield* Effect.forkScoped(Effect.repeat(purgeExpired, Schedule.spaced("1 hour")))

      return ImageStore.of({
        retention,
        save: Effect.fn("ImageStore.save")(function* (png: Uint8Array) {
          const id = Base64Url.encode(yield* crypto.randomBytes(32))
          yield* fs.writeFile(fileOf(id), png, { mode: 0o600 })
          return id
        }, Effect.orDie),
        read: (id) =>
          IMAGE_ID.test(id) ? Effect.option(fs.readFile(fileOf(id))) : Effect.succeedNone,
      })
    }),
  )
}
