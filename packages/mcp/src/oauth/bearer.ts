import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"

import { OAuthSettings } from "./settings.ts"
import { Tokens } from "./tokens.ts"

const PROTECTED_PATH = /^\/mcp(?:[/?]|$)/u

const bearerToken = (header: string | undefined): string | undefined => {
  const match = /^Bearer ([\w~+/.=-]+)$/iu.exec(header ?? "")
  return match?.[1]
}

/**
 * Requires a valid access token on `/mcp`. Unauthenticated calls receive the `401` and
 * `WWW-Authenticate` pointer that starts Claude's OAuth discovery.
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
        if (!PROTECTED_PATH.test(request.url)) {
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
