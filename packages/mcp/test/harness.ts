import { BunServices } from "@effect/platform-bun"
import { ConfigProvider, Effect, FileSystem, Layer } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"

import { App } from "../src/app.ts"

export const ORIGIN = "http://localhost:8080"
export const CLIENT_ID = "claude"
export const CLIENT_SECRET = "test-secret-with-at-least-32-characters"
export const UPSTREAM_KEY = "upstream-data-plane-key"
export const HOSTED_CALLBACK = "https://claude.ai/api/mcp/auth_callback"

/** A 1×1 PNG, enough for the preview pipeline to decode and re-encode. */
export const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

type UpstreamHandler = (request: Request) => Response | Promise<Response>

const unconfigured: UpstreamHandler = () => new Response("not configured", { status: 500 })

export interface TestServer {
  request(path: string, init?: RequestInit): Promise<Response>
  setUpstream(handler: UpstreamHandler): void
  dispose(): Promise<void>
}

const withFileSystem = <A, E>(f: (fs: FileSystem.FileSystem) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* f(yield* FileSystem.FileSystem)
    }).pipe(Effect.provide(BunServices.layer)),
  )

/** Starts the whole connector in memory against a fake OpenCodex hub on an ephemeral port. */
export const startServer = async (): Promise<TestServer> => {
  let upstreamHandler = unconfigured
  const upstream = Bun.serve({ port: 0, fetch: (request) => upstreamHandler(request) })
  const dataDirectory = await withFileSystem((fs) => fs.makeTempDirectory())
  const config = ConfigProvider.layer(
    ConfigProvider.fromUnknown({
      MCP_PUBLIC_URL: ORIGIN,
      MCP_OAUTH_CLIENT_ID: CLIENT_ID,
      MCP_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
      OPENCODEX_URL: upstream.url.origin,
      OPENCODEX_API_KEY: UPSTREAM_KEY,
      MCP_DATA_DIR: dataDirectory,
    }),
  )
  const { handler, dispose } = HttpRouter.toWebHandler(
    App.pipe(
      Layer.provide(Layer.mergeAll(FetchHttpClient.layer, BunServices.layer)),
      Layer.provide(config),
    ),
    { disableLogger: true },
  )
  return {
    request: (path, init) => handler(new Request(new URL(path, ORIGIN), init)),
    setUpstream: (next) => {
      upstreamHandler = next
    },
    dispose: async () => {
      await dispose()
      await upstream.stop(true)
      await withFileSystem((fs) => fs.remove(dataDirectory, { recursive: true }))
    },
  }
}
