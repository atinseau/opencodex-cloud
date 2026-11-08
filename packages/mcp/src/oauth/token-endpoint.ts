import { Effect, Option, Redacted, Result, Schema } from "effect"
import * as Base64 from "effect/encoding/Base64"
import { HttpServerRequest, HttpServerResponse } from "effect/http"

import { constantTimeEqual } from "../crypto.ts"
import type { AuthorizationCodes } from "./codes.ts"
import { pkceChallenge } from "./crypto.ts"
import type { OAuthSettings } from "./settings.ts"
import type { TokenPair, Tokens } from "./tokens.ts"

interface Dependencies {
  readonly settings: OAuthSettings["Service"]
  readonly codes: AuthorizationCodes["Service"]
  readonly tokens: Tokens["Service"]
}

const TokenRequest = Schema.Struct({
  grant_type: Schema.String,
  code: Schema.optional(Schema.String),
  redirect_uri: Schema.optional(Schema.String),
  code_verifier: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
  resource: Schema.optional(Schema.String),
  client_id: Schema.optional(Schema.String),
  client_secret: Schema.optional(Schema.String),
})
type TokenRequest = typeof TokenRequest.Type

class OAuthFailure extends Schema.TaggedError<OAuthFailure, { readonly brand: unique symbol }>()(
  "OAuthFailure",
  {
    error: Schema.Literals([
      "invalid_request",
      "invalid_client",
      "invalid_grant",
      "invalid_target",
      "unsupported_grant_type",
    ]),
  },
) {}

const fail = (error: OAuthFailure["error"]) => Effect.fail(new OAuthFailure({ error }))
const noStore = { "cache-control": "no-store", pragma: "no-cache" }

const basicCredentials = (header: string | undefined) => {
  const [scheme = "", encoded = ""] = (header ?? "").split(" ")
  const decoded =
    scheme.toLowerCase() === "basic"
      ? Result.getSuccess(Base64.decodeString(encoded))
      : Option.none()
  return Option.flatMap(decoded, (value) => {
    const separator = value.indexOf(":")
    return separator < 0
      ? Option.none()
      : Option.some({ id: value.slice(0, separator), secret: value.slice(separator + 1) })
  })
}

const authenticateClient = Effect.fn("authenticateClient")(function* (
  settings: OAuthSettings["Service"],
  form: TokenRequest,
) {
  const request = yield* HttpServerRequest.HttpServerRequest
  const fromForm =
    form.client_id === undefined || form.client_secret === undefined
      ? Option.none()
      : Option.some({ id: form.client_id, secret: form.client_secret })
  const credentials = Option.orElse(
    basicCredentials(request.headers["authorization"]),
    () => fromForm,
  )
  const valid = Option.exists(
    credentials,
    ({ id, secret }) =>
      id === settings.clientId && constantTimeEqual(secret, Redacted.value(settings.clientSecret)),
  )
  if (!valid) {
    return yield* fail("invalid_client")
  }
})

const required = (value: string | undefined) =>
  value === undefined ? fail("invalid_request") : Effect.succeed(value)

const exchangeCode = Effect.fn("exchangeCode")(function* (deps: Dependencies, form: TokenRequest) {
  const code = yield* required(form.code)
  const verifier = yield* required(form.code_verifier)
  const redirectUri = yield* required(form.redirect_uri)
  if (form.resource !== undefined && form.resource !== deps.settings.resource) {
    return yield* fail("invalid_target")
  }
  const grant = yield* deps.codes.redeem(code)
  const valid = Option.exists(
    grant,
    ({ codeChallenge, redirectUri: expected }) =>
      expected === redirectUri && constantTimeEqual(pkceChallenge(verifier), codeChallenge),
  )
  return valid ? yield* deps.tokens.issue : yield* fail("invalid_grant")
})

const refresh = Effect.fn("refresh")(function* (deps: Dependencies, form: TokenRequest) {
  const refreshToken = yield* required(form.refresh_token)
  const valid = yield* deps.tokens.verify(refreshToken, "refresh")
  return valid ? yield* deps.tokens.issue : yield* fail("invalid_grant")
})

const grantTokens = (deps: Dependencies, form: TokenRequest) => {
  switch (form.grant_type) {
    case "authorization_code": {
      return exchangeCode(deps, form)
    }
    case "refresh_token": {
      return refresh(deps, form)
    }
    default: {
      return fail("unsupported_grant_type")
    }
  }
}

const tokenResponse = (pair: TokenPair) =>
  HttpServerResponse.jsonUnsafe(
    {
      access_token: pair.accessToken,
      token_type: "Bearer",
      expires_in: pair.expiresIn,
      refresh_token: pair.refreshToken,
    },
    { headers: noStore },
  )

const failureResponse = ({ error }: OAuthFailure) =>
  HttpServerResponse.jsonUnsafe(
    { error },
    error === "invalid_client"
      ? {
          status: 401,
          headers: { ...noStore, "www-authenticate": 'Basic realm="opencodex-cloud"' },
        }
      : { status: 400, headers: noStore },
  )

/** RFC 6749 token endpoint for the authorization-code and refresh-token grants. */
export const tokenEndpoint = (deps: Dependencies) =>
  Effect.gen(function* () {
    const form = yield* HttpServerRequest.schemaBodyUrlParams(TokenRequest).pipe(
      Effect.catch(() => fail("invalid_request")),
    )
    yield* authenticateClient(deps.settings, form)
    return tokenResponse(yield* grantTokens(deps, form))
  }).pipe(Effect.catchTag("OAuthFailure", (failure) => Effect.succeed(failureResponse(failure))))
