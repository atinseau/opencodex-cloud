import { Config, Context, Effect, flow, Layer, Option, Schema } from "effect"
import * as Base64 from "effect/encoding/Base64"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

import { ImageGenerationError } from "./errors.ts"

const GENERATION_TIMEOUT = "200 seconds"

const ImageResponse = Schema.Struct({
  data: Schema.NonEmptyArray(Schema.Struct({ b64_json: Schema.Uint8ArrayFromBase64 })),
})

const UpstreamError = Schema.Struct({ error: Schema.Struct({ message: Schema.String }) })
const decodeUpstreamError = Schema.decodeUnknownOption(UpstreamError)

const failure = (message: string) => new ImageGenerationError({ message })

const upstreamFailure = (response: HttpClientResponse.HttpClientResponse) =>
  Effect.flatMap(
    Effect.orElseSucceed(response.json, () => null),
    (body) =>
      Effect.fail(
        failure(
          Option.match(decodeUpstreamError(body), {
            onNone: () => `OpenCodex returned HTTP ${response.status}.`,
            onSome: ({ error }) => `OpenCodex returned HTTP ${response.status}: ${error.message}`,
          }),
        ),
      ),
  )

/** Posts an OpenAI Images request to the hub and returns the PNG it produced. */
const relay = Effect.fn("OpenCodexImages.relay")(function* (
  client: HttpClient.HttpClient,
  path: string,
  body: object,
) {
  const response = yield* HttpClientRequest.post(path).pipe(
    HttpClientRequest.bodyJsonUnsafe(body),
    client.execute,
    Effect.timeoutOrElse({
      duration: GENERATION_TIMEOUT,
      orElse: () => Effect.fail(failure("OpenCodex did not answer in time.")),
    }),
    Effect.catchTag("HttpClientError", () => Effect.fail(failure("OpenCodex is unreachable."))),
  )
  if (response.status >= 400) {
    return yield* upstreamFailure(response)
  }
  const decoded = yield* HttpClientResponse.schemaBodyJson(ImageResponse)(response).pipe(
    Effect.mapError(() => failure("OpenCodex returned an unexpected image payload.")),
  )
  return decoded.data[0].b64_json
})

/** Client for the hub's `/v1/images` relay to the connected ChatGPT account. */
export class OpenCodexImages extends Context.Service<
  OpenCodexImages,
  {
    generate(prompt: string): Effect.Effect<Uint8Array, ImageGenerationError>
    /**
     * Applies the prompt to the first PNG, which keeps its dimensions; the other PNGs are
     * references the prompt can draw from.
     */
    edit(
      prompt: string,
      pngs: ReadonlyArray<Uint8Array>,
    ): Effect.Effect<Uint8Array, ImageGenerationError>
  }
>()("opencodex-cloud/mcp/images/OpenCodexImages") {
  static readonly layer = Layer.effect(
    OpenCodexImages,
    Effect.gen(function* () {
      const baseUrl = yield* Config.URL("OPENCODEX_URL")
      const apiKey = yield* Config.Redacted("OPENCODEX_API_KEY")
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(
          flow(HttpClientRequest.prependUrl(baseUrl.origin), HttpClientRequest.bearerToken(apiKey)),
        ),
      )

      return OpenCodexImages.of({
        generate: (prompt) => relay(client, "/v1/images/generations", { prompt }),
        edit: (prompt, pngs) =>
          relay(client, "/v1/images/edits", {
            prompt,
            images: pngs.map((png) => ({
              image_url: `data:image/png;base64,${Base64.encode(png)}`,
            })),
          }),
      })
    }),
  )
}
