import { Config, Context, Effect, flow, Layer, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

import { ImageGenerationError } from "./errors.ts"

const GENERATION_TIMEOUT = "200 seconds"

const GenerationResponse = Schema.Struct({
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

/** Client for the hub's `/v1/images/generations` relay to the connected ChatGPT account. */
export class OpenCodexImages extends Context.Service<
  OpenCodexImages,
  { generate(prompt: string): Effect.Effect<Uint8Array, ImageGenerationError> }
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

      const generate = Effect.fn("OpenCodexImages.generate")(function* (prompt: string) {
        const response = yield* HttpClientRequest.post("/v1/images/generations").pipe(
          HttpClientRequest.bodyJsonUnsafe({ prompt }),
          client.execute,
          Effect.timeoutOrElse({
            duration: GENERATION_TIMEOUT,
            orElse: () => Effect.fail(failure("OpenCodex did not answer in time.")),
          }),
          Effect.catchTag("HttpClientError", () =>
            Effect.fail(failure("OpenCodex is unreachable.")),
          ),
        )
        if (response.status >= 400) {
          return yield* upstreamFailure(response)
        }
        const body = yield* HttpClientResponse.schemaBodyJson(GenerationResponse)(response).pipe(
          Effect.mapError(() => failure("OpenCodex returned an unexpected image payload.")),
        )
        return body.data[0].b64_json
      })

      return OpenCodexImages.of({ generate })
    }),
  )
}
