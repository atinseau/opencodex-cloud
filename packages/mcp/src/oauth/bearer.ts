import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"

import { OAuthSettings } from "./settings.ts"
import { Tokens } from "./tokens.ts"

const bearerToken = (header: string | undefined): string | undefined => {
  const match = /^Bearer ([\w~+/.=-]+)$/iu.exec(header ?? "")
  return match?.[1]
}

/**
 * Requires a valid access token on the MCP endpoint itself. Unauthenticated calls receive the
 * `401` and `WWW-Authenticate` pointer that starts Claude's OAuth discovery; the OAuth and image
 * routes mounted below the endpoint path stay reachable.
 */
export const BearerAuth = HttpRouter.middleware(
  Effect.gen(function* () {
    const settings = yield* OAuthSettings
    const tokens = yield* Tokens
    const challenge = (error?: string) =>
      HttpServerResponse.jsonUnsafe(
        { error: error ?? "unauthorized" },
        {
          status: 401,
          headers: {
            "www-authenticate": [
              "Bearer",
              error === undefined ? "" : ` error="${error}",`,
              ` resource_metadata="${settings.resourceMetadataUrl}"`,
            ].join(""),
          },
        },
      )
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        if (request.url.split("?", 1)[0] !== settings.path) {
          return yield* httpEffect
        }
        const token = bearerToken(request.headers["authorization"])
        if (token === undefined) {
          return challenge()
        }
        if (!(yield* tokens.verify(token, "access"))) {
          return challenge("invalid_token")
        }
        return yield* httpEffect
      })
  }),
  { global: true },
)
