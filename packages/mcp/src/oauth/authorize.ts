import { Effect, Option, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"

import type { AuthorizationCodes } from "./codes.ts"
import type { OAuthSettings } from "./settings.ts"

/** Callback used by claude.ai, Claude Desktop, mobile and Cowork. */
const HOSTED_CALLBACK = "https://claude.ai/api/mcp/auth_callback"
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1"])

/** Claude Code uses an RFC 8252 loopback redirect on an ephemeral port. */
const isLoopbackCallback = (url: URL): boolean =>
  url.protocol === "http:" &&
  LOOPBACK_HOSTS.has(url.hostname) &&
  url.pathname === "/callback" &&
  url.search === "" &&
  url.hash === ""

const isAllowedRedirect = (value: string): boolean => {
  if (value === HOSTED_CALLBACK) {
    return true
  }
  const url = URL.parse(value)
  return url !== null && isLoopbackCallback(url)
}

const ClientQuery = Schema.Struct({
  client_id: Schema.String,
  redirect_uri: Schema.String,
  state: Schema.optional(Schema.String),
})

const GrantQuery = Schema.Struct({
  response_type: Schema.Literal("code"),
  code_challenge: Schema.String.check(Schema.isPattern(/^[\w~.-]{43,128}$/u)),
  code_challenge_method: Schema.Literal("S256"),
  resource: Schema.optional(Schema.String),
})

const redirectTo = (redirectUri: string, params: Readonly<Record<string, string | undefined>>) => {
  const location = new URL(redirectUri)
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) {
      location.searchParams.set(name, value)
    }
  }
  return HttpServerResponse.redirect(location, { headers: { "cache-control": "no-store" } })
}

/**
 * Authorization endpoint. The confidential client secret, checked at the token endpoint, is the
 * owner's credential, so a valid request is approved without an interactive consent page.
 */
export const authorize = (
  settings: OAuthSettings["Service"],
  codes: AuthorizationCodes["Service"],
) =>
  Effect.gen(function* () {
    const client = yield* Effect.option(HttpServerRequest.schemaSearchParams(ClientQuery))
    if (
      Option.isNone(client) ||
      client.value.client_id !== settings.clientId ||
      !isAllowedRedirect(client.value.redirect_uri)
    ) {
      return HttpServerResponse.text("Unknown OAuth client or redirect URI.", { status: 400 })
    }
    const { redirect_uri: redirectUri, state } = client.value
    const grant = yield* Effect.option(HttpServerRequest.schemaSearchParams(GrantQuery))
    if (Option.isNone(grant)) {
      return redirectTo(redirectUri, { error: "invalid_request", state })
    }
    if (grant.value.resource !== undefined && grant.value.resource !== settings.resource) {
      return redirectTo(redirectUri, { error: "invalid_target", state })
    }
    const code = yield* codes.issue({ redirectUri, codeChallenge: grant.value.code_challenge })
    return redirectTo(redirectUri, { code, state })
  })
